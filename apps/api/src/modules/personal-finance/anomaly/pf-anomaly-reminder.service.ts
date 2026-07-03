import { Injectable, Logger } from "@nestjs/common";
import { schema, sql, type Db } from "@business-os/db";
import { Cron } from "@nestjs/schedule";
import { DbService } from "../../../common/db/db.service.js";
import { EmailService } from "../../../common/email/email.service.js";
import { PfAuditService } from "../pf-audit.service.js";
import { PfPreferencesService } from "../preferences/pf-preferences.service.js";
import { currentPeriod, recentBuckets, rollupLabel, type PeriodPrefs } from "../insights/pf-period.js";

/** Baseline = average of this many prior periods; only the top-N categories are checked. */
const BASELINE_PERIODS = 3;
const TOP_CATEGORIES = 5;

/**
 * Gentle spending-anomaly reminder (§11). Mirrors PfReminderService exactly (daily
 * @Cron, per-account under RLS, reuses EmailService — no new pipeline). Heuristic
 * only (no ML): for the account's CHOSEN rollup period (same resolver as the
 * overview/charts), flag the period total and top categories that are ≥ the
 * average of the previous periods × the account's sensitivity. Non-noisy: one
 * notice per (scope, period) via the unique index, one summary email per run, and
 * respects the per-account on/off + sensitivity. Notices are dismissible in-app.
 */
@Injectable()
export class PfAnomalyReminderService {
  private readonly logger = new Logger(PfAnomalyReminderService.name);

  constructor(
    private readonly db: DbService,
    private readonly email: EmailService,
    private readonly audit: PfAuditService,
    private readonly prefs: PfPreferencesService,
  ) {}

  /** Daily at 09:45 — after the subscription/note reminders. */
  @Cron("45 9 * * *")
  async daily(): Promise<void> {
    try {
      const n = await this.runAll();
      if (n > 0) this.logger.log(`pf anomaly notices raised: ${n}`);
    } catch (e) {
      this.logger.error(`pf anomaly sweep failed: ${(e as Error).message}`);
    }
  }

  async runAll(): Promise<number> {
    const ids = await this.db.withPfAccount({ pfAccountId: "00000000-0000-0000-0000-000000000000" }, (tx) =>
      tx.execute(sql`select id from pf_reminder_account_ids()`),
    );
    let total = 0;
    for (const r of ids.rows as Array<{ id: string }>) {
      total += await this.db.withPfAccount({ pfAccountId: r.id }, (tx) => this.runForAccount(tx, r.id));
    }
    return total;
  }

  /** Sum of expenses (base currency) in [start, end) — reversals net naturally. */
  private async sumExpense(tx: Db, base: string, start: string, end: string, categoryId?: string): Promise<number> {
    const catCond = categoryId ? sql`and category_id = ${categoryId}` : sql``;
    const res = await tx.execute(sql`
      select coalesce(sum(amount), 0) as s from pf_expense
      where currency = ${base} and occurred_on >= ${start} and occurred_on < ${end} ${catCond}
    `);
    return Number((res.rows[0] as { s: string }).s);
  }

  private async baseline(tx: Db, base: string, buckets: Array<{ start: string; end: string }>, categoryId?: string): Promise<number> {
    let sum = 0;
    for (const b of buckets) sum += await this.sumExpense(tx, base, b.start, b.end, categoryId);
    return buckets.length ? sum / buckets.length : 0;
  }

  async runForAccount(tx: Db, pfAccountId: string): Promise<number> {
    const prefs = await this.prefs.ensure(tx, pfAccountId);
    if (!prefs.anomalyEnabled) return 0;
    const threshold = prefs.anomalyThresholdPct / 100;

    const acct = await tx.execute(sql`select email, base_currency as "baseCurrency" from pf_account where id = ${pfAccountId}`);
    const account = acct.rows[0] as { email: string; baseCurrency: string } | undefined;
    if (!account) return 0;
    const base = account.baseCurrency;

    const baseDate = String((await tx.execute(sql`select current_date as d`)).rows[0]!.d).slice(0, 10);
    const eff: PeriodPrefs = { rollupPeriod: prefs.rollupPeriod as PeriodPrefs["rollupPeriod"], rollupCustomDays: prefs.rollupCustomDays };
    const cur = currentPeriod(eff, baseDate);
    const prev = recentBuckets(eff, baseDate, BASELINE_PERIODS + 1).slice(0, BASELINE_PERIODS); // the periods BEFORE current

    const flagged: Array<{ kind: "period_total" | "category"; categoryId: string | null; name: string; observed: number; baseline: number }> = [];

    // Period-total anomaly.
    const observedTotal = await this.sumExpense(tx, base, cur.start, cur.end);
    const baselineTotal = await this.baseline(tx, base, prev);
    if (baselineTotal > 0 && observedTotal >= baselineTotal * threshold) {
      const [row] = await tx
        .insert(schema.pfAnomalyNotice)
        .values({ pfAccountId, kind: "period_total", periodKey: cur.key, categoryId: null, observed: String(observedTotal), baseline: String(baselineTotal.toFixed(2)), currency: base })
        .onConflictDoNothing()
        .returning({ id: schema.pfAnomalyNotice.id });
      if (row) flagged.push({ kind: "period_total", categoryId: null, name: "Total spending", observed: observedTotal, baseline: baselineTotal });
    }

    // Top-category anomalies (only categories with current-period spend).
    const candRes = await tx.execute(sql`
      select x.category_id as "categoryId", coalesce(c.name, 'Uncategorised') as name, sum(x.amount) as observed
      from pf_expense x left join pf_category c on c.id = x.category_id
      where x.currency = ${base} and x.occurred_on >= ${cur.start} and x.occurred_on < ${cur.end} and x.category_id is not null
      group by x.category_id, c.name
      having sum(x.amount) > 0
      order by sum(x.amount) desc
      limit ${TOP_CATEGORIES}
    `);
    for (const cand of candRes.rows as Array<{ categoryId: string; name: string; observed: string }>) {
      const observed = Number(cand.observed);
      const baseCat = await this.baseline(tx, base, prev, cand.categoryId);
      if (baseCat > 0 && observed >= baseCat * threshold) {
        const [row] = await tx
          .insert(schema.pfAnomalyNotice)
          .values({ pfAccountId, kind: "category", periodKey: cur.key, categoryId: cand.categoryId, observed: String(observed), baseline: String(baseCat.toFixed(2)), currency: base })
          .onConflictDoNothing()
          .returning({ id: schema.pfAnomalyNotice.id });
        if (row) flagged.push({ kind: "category", categoryId: cand.categoryId, name: cand.name, observed, baseline: baseCat });
      }
    }

    if (flagged.length === 0) return 0;

    // One gentle summary email per run.
    const period = rollupLabel(eff);
    const lines = flagged.map(
      (f) => `• ${f.name}: ${base} ${f.observed.toFixed(0)} this ${period} (usual ≈ ${base} ${f.baseline.toFixed(0)})`,
    );
    await this.email.send({
      to: account.email,
      subject: `Heads up — spending above your usual this ${period}`,
      text:
        `A quick, friendly note: some spending is running above your recent average this ${period}.\n\n` +
        `${lines.join("\n")}\n\n` +
        `Nothing to do — just a heads up. You can turn these off or adjust sensitivity in Personal Finance → Settings.`,
    });
    await this.audit.record(tx, pfAccountId, {
      action: "pf.anomaly_reminder_sent",
      entity: "pf_anomaly_notice",
      detail: { periodKey: cur.key, count: flagged.length },
    });
    return flagged.length;
  }
}
