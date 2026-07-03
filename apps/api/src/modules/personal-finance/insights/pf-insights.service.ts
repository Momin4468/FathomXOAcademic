import { Injectable, NotFoundException } from "@nestjs/common";
import { sql, type Db } from "@business-os/db";
import { PfPreferencesService } from "../preferences/pf-preferences.service.js";
import { PfTargetService } from "../targets/pf-target.service.js";
import { currentPeriod, recentBuckets, rollupLabel, type PeriodPrefs } from "./pf-period.js";

/**
 * Period-aware "my numbers" insights (§8/§11) — everything DERIVED at read, in the
 * account's BASE currency only (no forced FX, §11). The rollup period comes from
 * the account's saved preferences (optionally overridden per-request for the UI
 * period selector) and is resolved ONCE via the shared resolver, so the KPIs, the
 * category breakdown, the trend series, and the anomaly comparison all use the
 * identical window. The old GET /pf/dashboard stays untouched.
 */
@Injectable()
export class PfInsightsService {
  constructor(
    private readonly prefs: PfPreferencesService,
    private readonly targets: PfTargetService,
  ) {}

  async overview(tx: Db, pfAccountId: string, override?: Partial<PeriodPrefs>) {
    const acctRes = await tx.execute(sql`
      select display_name as "displayName", base_currency as "baseCurrency", linked_party_id as "linkedPartyId"
      from pf_account where id = ${pfAccountId}
    `);
    const acct = acctRes.rows[0] as { displayName: string | null; baseCurrency: string; linkedPartyId: string | null } | undefined;
    if (!acct) throw new NotFoundException("Account not found");
    const base = acct.baseCurrency;

    const saved = await this.prefs.ensure(tx, pfAccountId);
    const eff: PeriodPrefs = {
      rollupPeriod: override?.rollupPeriod ?? (saved.rollupPeriod as PeriodPrefs["rollupPeriod"]),
      rollupCustomDays: override?.rollupCustomDays ?? saved.rollupCustomDays,
    };
    const baseDate = (await tx.execute(sql`select current_date as d`)).rows[0] as { d: string };
    const cur = currentPeriod(eff, String(baseDate.d).slice(0, 10));
    const buckets = recentBuckets(eff, String(baseDate.d).slice(0, 10), eff.rollupPeriod === "week" ? 8 : 6);

    // KPIs for the current period (reversals net naturally — no reverses filter).
    const kpiRes = await tx.execute(sql`
      select
        coalesce((select sum(amount) from pf_income where currency = ${base} and occurred_on >= ${cur.start} and occurred_on < ${cur.end}), 0) as income,
        coalesce((select sum(amount) from pf_expense where currency = ${base} and occurred_on >= ${cur.start} and occurred_on < ${cur.end}), 0) as expense
    `);
    const kpi = kpiRes.rows[0] as { income: string; expense: string };
    const net = Number(kpi.income) - Number(kpi.expense);

    // Savings total + loan outstanding (derived; same as the classic dashboard).
    const savingRes = await tx.execute(sql`
      select coalesce(sum(case when e.kind = 'deposit' then e.amount else -e.amount end), 0) as balance
      from pf_saving s join pf_saving_event e on e.saving_id = s.id
      where s.archived_at is null and s.currency = ${base}
    `);
    const savingsTotal = Number((savingRes.rows[0] as { balance: string }).balance);
    const loanRes = await tx.execute(sql`
      select l.direction,
        coalesce(sum(l.principal
          + coalesce((select sum(e.amount) from pf_loan_event e where e.loan_id = l.id and e.kind = 'disbursement'), 0)
          - coalesce((select sum(e.amount) from pf_loan_event e where e.loan_id = l.id and e.kind = 'repayment'), 0)
          + coalesce((select sum(e.amount) from pf_loan_event e where e.loan_id = l.id and e.kind = 'adjustment'), 0)
        ), 0) as outstanding
      from pf_loan l where l.archived_at is null and l.currency = ${base}
      group by l.direction
    `);
    let loansGivenOutstanding = 0;
    let loansTakenOutstanding = 0;
    for (const r of loanRes.rows as Array<{ direction: string; outstanding: string }>) {
      if (r.direction === "given") loansGivenOutstanding = Number(r.outstanding);
      if (r.direction === "taken") loansTakenOutstanding = Number(r.outstanding);
    }

    // Spending by category for the current period (for the donut).
    const catRes = await tx.execute(sql`
      select x.category_id as "categoryId", coalesce(c.name, 'Uncategorised') as name, sum(x.amount) as amount
      from pf_expense x left join pf_category c on c.id = x.category_id
      where x.currency = ${base} and x.occurred_on >= ${cur.start} and x.occurred_on < ${cur.end}
      group by x.category_id, c.name
      having sum(x.amount) <> 0
      order by sum(x.amount) desc
    `);

    // Income-vs-expense + net per period bucket (for the trend charts).
    const bucketVals = buckets.map((b) => sql`(${b.key}, ${b.start}::date, ${b.end}::date)`);
    const seriesRes = await tx.execute(sql`
      with b(key, s, e) as (values ${sql.join(bucketVals, sql`, `)})
      select b.key,
        coalesce((select sum(amount) from pf_income i where i.currency = ${base} and i.occurred_on >= b.s and i.occurred_on < b.e), 0) as income,
        coalesce((select sum(amount) from pf_expense x where x.currency = ${base} and x.occurred_on >= b.s and x.occurred_on < b.e), 0) as expense
      from b order by b.s
    `);
    const labelByKey = new Map(buckets.map((b) => [b.key, b.label]));
    const series = (seriesRes.rows as Array<{ key: string; income: string; expense: string }>).map((r) => ({
      key: r.key,
      label: labelByKey.get(r.key) ?? r.key,
      income: Number(r.income),
      expense: Number(r.expense),
      net: Number(r.income) - Number(r.expense),
    }));

    // Upcoming subscriptions / future expenses (next 30 days).
    const upcomingRes = await tx.execute(sql`
      select id, name, amount, currency, next_due_date as "nextDueDate"
      from pf_subscription
      where archived_at is null and next_due_date is not null
        and next_due_date >= current_date and next_due_date < (current_date + 30)
      order by next_due_date asc limit 8
    `);

    // Active (non-dismissed) anomaly notices.
    const anomalyRes = await tx.execute(sql`
      select n.id, n.kind, n.period_key as "periodKey", n.category_id as "categoryId",
             coalesce(c.name, '') as "categoryName", n.observed, n.baseline, n.currency, n.created_at as "createdAt"
      from pf_anomaly_notice n left join pf_category c on c.id = n.category_id
      where n.dismissed_at is null
      order by n.created_at desc limit 6
    `);

    // Budget/target progress (already derived at read).
    const targets = await this.targets.list(tx, pfAccountId);

    return {
      displayName: acct.displayName,
      baseCurrency: base,
      linked: acct.linkedPartyId != null,
      period: { kind: eff.rollupPeriod, key: cur.key, start: cur.start, end: cur.end, label: rollupLabel(eff) },
      totals: {
        income: kpi.income,
        expense: kpi.expense,
        net: String(net),
        savingsTotal: String(savingsTotal),
        loansGivenOutstanding: String(loansGivenOutstanding),
        loansTakenOutstanding: String(loansTakenOutstanding),
      },
      spendingByCategory: catRes.rows,
      series,
      targets,
      upcomingSubscriptions: upcomingRes.rows,
      anomalies: anomalyRes.rows,
    };
  }
}
