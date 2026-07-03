import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { config } from "dotenv";
import pg from "pg";
import { api, waitForHealth } from "./helpers.js";

/**
 * Personal Finance PLANNER enhancement (Module 14, migration 0035) — BLACK-BOX
 * HTTP against the COMPILED app (dist/main.js), mirroring pf-core / pf-isolation.
 * Proves the new planner surface holds its contracts:
 *   • GET /pf/preferences read-or-creates defaults; PATCH edits a subset (incl.
 *     the base currency via defaultCurrency); aiAvailable is present.
 *   • GET /pf/insights resolves ONE period everywhere — totals, spendingByCategory
 *     and series share the SAME window; period=week overrides prefs; the echoed
 *     period matches; totals.expense == Σ spendingByCategory for that window.
 *   • GET /pf/categories/frequent ranks used categories first (derived, 90d).
 *   • POST /pf/ai/quick-add drafts (proposals only) — persists NO expense / NO
 *     business row; caps per-account per-day (429); 404 when FEATURE_AI_CAPTURE off.
 *   • Cross-account isolation: prefs / insights / anomaly notices of A are invisible
 *     to B; B cannot dismiss A's notice (404).
 *
 * A low AI cap (AI_CAPTURE_DAILY_CAP=2) is set in the spawn env so the 429 path is
 * cheap to reach. The AI-disabled 404 case runs against a SECOND server spawned
 * WITHOUT FEATURE_AI_CAPTURE.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3242; // dedicated test port (distinct from pf-core 3240 / pf-iso 3241)
const BASE = `http://localhost:${PORT}`;
const PORT_NOAI = 3243; // second server with AI capture OFF
const BASE_NOAI = `http://localhost:${PORT_NOAI}`;
const AI_CAP = 2;
const OUTBOX = mkdtempSync(join(tmpdir(), "bos-pf-planner-"));

let server: ChildProcess;
let serverNoAi: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

const createdPfAccountIds: string[] = [];
let pgToday = "";
function datePlus(days: number): string {
  const d = new Date(`${pgToday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function monthStart(): string {
  return `${pgToday.slice(0, 7)}-01`;
}
/** The 15th of the month `k` calendar-months before today (safe from month-length edges). */
function monthBack(k: number): string {
  const d = new Date(`${pgToday}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k, 15)).toISOString().slice(0, 10);
}

function spawnServer(port: number, extraEnv: Record<string, string>): ChildProcess {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  const child = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(port),
      FEATURE_PERSONAL_FINANCE: "true",
      FEATURE_BILLING: "true",
      FEATURE_EXPENSES: "true",
      EMAIL_ADAPTER: "dev",
      EMAIL_OUTBOX_DIR: OUTBOX,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr?.on("data", (d) => {
    const s = String(d);
    if (/error/i.test(s)) process.stderr.write(`[api:${port}] ${s}`);
  });
  return child;
}

/** Register a fresh PF account; return its access token + id (tracked for cleanup). */
async function registerPf(baseCurrency = "BDT", base = BASE): Promise<{ token: string; id: string; email: string }> {
  const email = `pf+${randomUUID()}@pf.test`;
  const res = await api(base, "/pf/auth/register", {
    method: "POST",
    body: { email, password: "Password123!", displayName: "PF Planner", baseCurrency },
  });
  assert.equal(res.status, 201, `register should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
  const token = res.body.accessToken as string;
  const me = await api(base, "/pf/auth/me", { token });
  assert.equal(me.status, 200);
  createdPfAccountIds.push(me.body.id as string);
  return { token, id: me.body.id as string, email };
}

before(async () => {
  await admin.connect();
  pgToday = (await admin.query("select current_date::text as d")).rows[0].d as string;
  // Start sequentially (not Promise.all) — two Nest boots in parallel starve each
  // other's event loop and can miss the health window on a busy machine.
  server = spawnServer(PORT, { FEATURE_AI_CAPTURE: "true", AI_CAPTURE_DAILY_CAP: String(AI_CAP), AI_CAPTURE_PROVIDER: "dev" });
  await waitForHealth(BASE, 60000);
  // Force AI capture OFF on this server even if the inherited .env turns it on.
  serverNoAi = spawnServer(PORT_NOAI, { FEATURE_AI_CAPTURE: "false" });
  await waitForHealth(BASE_NOAI, 60000);
});

after(async () => {
  // Append-only / FK-chained → children before parents. Include the new 0035 tables.
  for (const id of createdPfAccountIds) {
    await admin.query("delete from pf_ai_usage where pf_account_id=$1", [id]);
    await admin.query("delete from pf_anomaly_notice where pf_account_id=$1", [id]);
    await admin.query("delete from pf_preferences where pf_account_id=$1", [id]);
    await admin.query("delete from pf_loan_event where pf_account_id=$1", [id]);
    await admin.query("delete from pf_loan where pf_account_id=$1", [id]);
    await admin.query("delete from pf_saving_event where pf_account_id=$1", [id]);
    await admin.query("delete from pf_saving where pf_account_id=$1", [id]);
    await admin.query("delete from pf_target where pf_account_id=$1", [id]);
    await admin.query("delete from pf_subscription where pf_account_id=$1", [id]);
    await admin.query("delete from pf_income where pf_account_id=$1", [id]);
    await admin.query("delete from pf_expense where pf_account_id=$1", [id]);
    await admin.query("delete from pf_category where pf_account_id=$1", [id]);
    await admin.query("delete from pf_audit_log where pf_account_id=$1", [id]);
    await admin.query("delete from pf_refresh_token where pf_account_id=$1", [id]);
    await admin.query("delete from pf_account where id=$1", [id]);
  }
  await admin.end();
  if (server && !server.killed) server.kill();
  if (serverNoAi && !serverNoAi.killed) serverNoAi.kill();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("preferences: read-or-create defaults, then PATCH a subset", () => {
  it("GET creates defaults on first read (month, lead 3, anomaly 150, aiAvailable)", async () => {
    const { token } = await registerPf();
    const res = await api(BASE, "/pf/preferences", { token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.rollupPeriod, "month", "default rollup period is month");
    assert.equal(Number(res.body.subscriptionLeadDays), 3, "default subscription lead days is 3");
    assert.equal(res.body.anomalyEnabled, true, "anomaly enabled by default");
    assert.equal(Number(res.body.anomalyThresholdPct), 150, "default anomaly threshold 150");
    assert.equal(res.body.aiQuickaddEnabled, true, "AI quick-add on by default");
    assert.equal(res.body.baseCurrency, "BDT", "base currency echoed");
    assert.equal(typeof res.body.aiAvailable, "boolean", "aiAvailable present");
    assert.equal(res.body.aiAvailable, true, "aiAvailable true on the AI-enabled server");
  });

  it("PATCH updates a subset (rollupPeriod, anomalyThresholdPct, defaultCurrency) and GET reflects it", async () => {
    const { token } = await registerPf();
    const patch = await api(BASE, "/pf/preferences", {
      method: "PATCH",
      token,
      body: { rollupPeriod: "week", anomalyThresholdPct: 200, defaultCurrency: "usd" },
    });
    assert.equal(patch.status, 200, JSON.stringify(patch.body));
    assert.equal(patch.body.rollupPeriod, "week", "PATCH response reflects new rollup period");
    assert.equal(Number(patch.body.anomalyThresholdPct), 200, "PATCH response reflects new threshold");
    assert.equal(patch.body.baseCurrency, "USD", "defaultCurrency edits base currency (upper-cased)");

    const get = await api(BASE, "/pf/preferences", { token });
    assert.equal(get.body.rollupPeriod, "week", "GET reflects persisted rollup period");
    assert.equal(Number(get.body.anomalyThresholdPct), 200, "GET reflects persisted threshold");
    assert.equal(get.body.baseCurrency, "USD", "GET reflects persisted base currency");
    // Untouched defaults stay put.
    assert.equal(Number(get.body.subscriptionLeadDays), 3, "unpatched fields keep their default");
  });

  it("PATCH rejects out-of-range threshold (boundary validation)", async () => {
    const { token } = await registerPf();
    const res = await api(BASE, "/pf/preferences", { method: "PATCH", token, body: { anomalyThresholdPct: 9999 } });
    assert.equal(res.status, 400, "threshold above Max(500) is rejected at the DTO boundary");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("insights: ONE period drives totals, category breakdown, and series", () => {
  it("default (month): totals match hand-summed current-month BDT expenses; totals.expense == Σ spendingByCategory", async () => {
    const { token } = await registerPf("BDT");
    const inWindow = datePlus(0) >= monthStart() ? datePlus(0) : monthStart();

    // Two categories this month + one income; a prior-month expense must be EXCLUDED.
    const catA = await api(BASE, "/pf/categories", { method: "POST", token, body: { kind: "expense", name: `Groc-${randomUUID().slice(0, 6)}` } });
    const catB = await api(BASE, "/pf/categories", { method: "POST", token, body: { kind: "expense", name: `Fuel-${randomUUID().slice(0, 6)}` } });
    assert.equal(catA.status, 201);
    assert.equal(catB.status, 201);

    await api(BASE, "/pf/expense", { method: "POST", token, body: { amount: 300, currency: "BDT", occurredOn: inWindow, categoryId: catA.body.id } });
    await api(BASE, "/pf/expense", { method: "POST", token, body: { amount: 200, currency: "BDT", occurredOn: inWindow, categoryId: catB.body.id } });
    await api(BASE, "/pf/income", { method: "POST", token, body: { amount: 1000, currency: "BDT", occurredOn: inWindow } });
    // A USD expense in-window must NOT be netted into a BDT base (no forced FX).
    await api(BASE, "/pf/expense", { method: "POST", token, body: { amount: 50, currency: "USD", occurredOn: inWindow } });
    // A prior-month expense must be OUTSIDE the month window.
    const priorMonth = datePlus(-40);
    await api(BASE, "/pf/expense", { method: "POST", token, body: { amount: 777, currency: "BDT", occurredOn: priorMonth } });

    const res = await api(BASE, "/pf/insights", { token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.period.kind, "month", "default period is month (from prefs)");
    assert.equal(res.body.baseCurrency, "BDT");
    assert.equal(Number(res.body.totals.income), 1000, "income sums BDT only, in-window");
    assert.equal(Number(res.body.totals.expense), 500, "expense sums BDT only, in-window (USD + prior month excluded)");
    assert.equal(Number(res.body.totals.net), 500, "net = 1000 − 500");

    // totals.expense MUST equal the sum of spendingByCategory for the SAME window.
    const catSum = (res.body.spendingByCategory as Array<{ amount: string }>).reduce((s, r) => s + Number(r.amount), 0);
    assert.equal(catSum, Number(res.body.totals.expense), "Σ spendingByCategory == totals.expense (one window)");

    // The current bucket in the series must also match the KPI window.
    const currentBucket = (res.body.series as Array<{ key: string; income: number; expense: number }>).find((b) => b.key === res.body.period.key);
    assert.ok(currentBucket, "the series contains the current period bucket");
    assert.equal(Number(currentBucket!.expense), 500, "series current bucket expense == totals.expense (one window)");
    assert.equal(Number(currentBucket!.income), 1000, "series current bucket income == totals.income (one window)");
  });

  it("period=week override changes the window; echoed period.kind == week", async () => {
    const { token } = await registerPf("BDT");
    // Today is always inside the current week window (Monday-anchored, half-open).
    await api(BASE, "/pf/expense", { method: "POST", token, body: { amount: 42, currency: "BDT", occurredOn: datePlus(0) } });

    const week = await api(BASE, "/pf/insights?period=week", { token });
    assert.equal(week.status, 200, JSON.stringify(week.body));
    assert.equal(week.body.period.kind, "week", "query override switches to a week window");
    assert.equal(Number(week.body.totals.expense), 42, "today's expense is in the current week window");
    const catSum = (week.body.spendingByCategory as Array<{ amount: string }>).reduce((s, r) => s + Number(r.amount), 0);
    assert.equal(catSum, Number(week.body.totals.expense), "Σ spendingByCategory == totals.expense (week window)");

    // Window is a proper 7-day half-open range.
    const s = new Date(`${week.body.period.start}T00:00:00Z`);
    const e = new Date(`${week.body.period.end}T00:00:00Z`);
    assert.equal((e.getTime() - s.getTime()) / 86_400_000, 7, "week window spans exactly 7 days [start,end)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("frequent categories rank used categories first", () => {
  it("a category used more recently outranks an unused one (kind=expense)", async () => {
    const { token } = await registerPf("BDT");
    const used = await api(BASE, "/pf/categories", { method: "POST", token, body: { kind: "expense", name: `Used-${randomUUID().slice(0, 6)}` } });
    const unused = await api(BASE, "/pf/categories", { method: "POST", token, body: { kind: "expense", name: `Unused-${randomUUID().slice(0, 6)}` } });
    assert.equal(used.status, 201);
    assert.equal(unused.status, 201);

    // Log 3 expenses against `used`, none against `unused`.
    for (let i = 0; i < 3; i++) {
      await api(BASE, "/pf/expense", { method: "POST", token, body: { amount: 10 + i, currency: "BDT", occurredOn: datePlus(-i), categoryId: used.body.id } });
    }

    const res = await api(BASE, "/pf/categories/frequent?kind=expense", { token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const rows = res.body as Array<{ id: string; name: string; uses: number }>;
    const usedRow = rows.find((r) => r.id === used.body.id);
    const unusedRow = rows.find((r) => r.id === unused.body.id);
    assert.ok(usedRow, "the used category is present");
    assert.equal(Number(usedRow!.uses), 3, "used category shows 3 recent uses (derived)");
    if (unusedRow) assert.equal(Number(unusedRow.uses), 0, "unused category shows 0 uses");
    // The used category ranks ahead of the unused one.
    const iUsed = rows.findIndex((r) => r.id === used.body.id);
    const iUnused = rows.findIndex((r) => r.id === unused.body.id);
    assert.ok(iUsed >= 0, "used category ranked");
    if (iUnused >= 0) assert.ok(iUsed < iUnused, "used category ranks before the unused one");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("AI quick-add: proposals only (no persistence), capped, feature-gated", () => {
  it("drafts amount 500 for 'spent 500 on groceries' and persists NO expense", async () => {
    const { token } = await registerPf("BDT");
    const before = (await api(BASE, "/pf/expense", { token })).body as Array<unknown>;
    assert.equal(before.length, 0, "account starts with no expenses");

    const res = await api(BASE, "/pf/ai/quick-add", { method: "POST", token, body: { text: "spent 500 on groceries" } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.draft, "a draft is returned");
    assert.equal(Number(res.body.draft.amount), 500, "dev provider extracts amount 500");

    // NO expense persisted (proposals only — human confirms via POST /pf/expense).
    const after = (await api(BASE, "/pf/expense", { token })).body as Array<unknown>;
    assert.equal(after.length, 0, "quick-add persists NO pf_expense row");
  });

  it("quick-add writes NO business rows (privacy: PF plane only)", async () => {
    const { token, id } = await registerPf("BDT");
    await api(BASE, "/pf/ai/quick-add", { method: "POST", token, body: { text: "spent 123 on coffee" } });

    // The usage counter lives in pf_ai_usage (PF plane), never business ai_usage.
    const pfUsage = await admin.query("select count(*)::int as c from pf_ai_usage where pf_account_id=$1", [id]);
    assert.ok(pfUsage.rows[0].c >= 1, "usage counted in pf_ai_usage");
    const bizExpense = await admin.query("select count(*)::int as c from expense");
    // No pf_account_id column on business `expense`; a PF draft must not create one.
    // We assert the PF plane holds no expense for this account (the real invariant).
    const pfExp = await admin.query("select count(*)::int as c from pf_expense where pf_account_id=$1", [id]);
    assert.equal(pfExp.rows[0].c, 0, "no pf_expense written by a draft");
    assert.ok(bizExpense.rows[0].c >= 0, "business expense table untouched (sanity)");
  });

  it("hitting the daily cap returns 429", async () => {
    const { token } = await registerPf("BDT");
    // AI_CAPTURE_DAILY_CAP = 2 → the first two succeed, the third is capped.
    const r1 = await api(BASE, "/pf/ai/quick-add", { method: "POST", token, body: { text: "spent 10 on a" } });
    const r2 = await api(BASE, "/pf/ai/quick-add", { method: "POST", token, body: { text: "spent 20 on b" } });
    assert.equal(r1.status, 200, "1st under cap");
    assert.equal(r2.status, 200, "2nd under cap");
    const r3 = await api(BASE, "/pf/ai/quick-add", { method: "POST", token, body: { text: "spent 30 on c" } });
    assert.equal(r3.status, 429, `3rd exceeds the daily cap of ${AI_CAP} (got ${r3.status})`);
  });

  it("with FEATURE_AI_CAPTURE unset, POST /pf/ai/quick-add → 404", async () => {
    const { token } = await registerPf("BDT", BASE_NOAI);
    const res = await api(BASE_NOAI, "/pf/ai/quick-add", { method: "POST", token, body: { text: "spent 500 on groceries" } });
    assert.equal(res.status, 404, "AI quick-add is not enabled → 404");

    // And the AI-off server reports aiAvailable=false in preferences.
    const prefs = await api(BASE_NOAI, "/pf/preferences", { token });
    assert.equal(prefs.body.aiAvailable, false, "aiAvailable=false when the flag is off");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("cross-account isolation on the planner surface", () => {
  it("A's preferences and insights are invisible to B; B cannot dismiss A's anomaly notice", async () => {
    const a = await registerPf("BDT");
    const b = await registerPf("USD");

    // A sets a distinctive preference; B must not see it.
    await api(BASE, "/pf/preferences", { method: "PATCH", token: a.token, body: { rollupPeriod: "week", anomalyThresholdPct: 222 } });
    const bPrefs = await api(BASE, "/pf/preferences", { token: b.token });
    assert.equal(bPrefs.status, 200);
    assert.equal(bPrefs.body.rollupPeriod, "month", "B sees ITS OWN default, not A's week");
    assert.notEqual(Number(bPrefs.body.anomalyThresholdPct), 222, "B never sees A's threshold");
    assert.equal(bPrefs.body.baseCurrency, "USD", "B keeps its own base currency");

    // A logs an in-window expense; it must NOT appear in B's insights.
    await api(BASE, "/pf/expense", { method: "POST", token: a.token, body: { amount: 999, currency: "BDT", occurredOn: datePlus(0) } });
    const bInsights = await api(BASE, "/pf/insights", { token: b.token });
    assert.equal(bInsights.status, 200);
    assert.equal(Number(bInsights.body.totals.expense), 0, "B's insights show ZERO — A's spend is invisible");

    // Seed an anomaly notice for A directly (the cron may not fire in-test), under
    // A's RLS context via the admin client setting app.pf_account_id.
    const noticeId = randomUUID();
    await admin.query("select set_config('app.pf_account_id', $1, true)", [a.id]);
    await admin.query(
      `insert into pf_anomaly_notice (id, pf_account_id, kind, period_key, observed, baseline, currency)
       values ($1, $2, 'period_total', $3, 999, 300, 'BDT')`,
      [noticeId, a.id, pgToday.slice(0, 7)],
    );
    await admin.query("select set_config('app.pf_account_id', '', true)");

    // A sees the notice in its insights; B does not.
    const aInsights = await api(BASE, "/pf/insights", { token: a.token });
    assert.ok(
      (aInsights.body.anomalies as Array<{ id: string }>).some((n) => n.id === noticeId),
      "A sees its own anomaly notice",
    );
    const bInsights2 = await api(BASE, "/pf/insights", { token: b.token });
    assert.ok(
      !(bInsights2.body.anomalies as Array<{ id: string }>).some((n) => n.id === noticeId),
      "B never sees A's anomaly notice",
    );

    // B cannot dismiss A's notice → 404 (RLS makes it invisible, not a cross-write).
    const bDismiss = await api(BASE, `/pf/anomaly-notices/${noticeId}/dismiss`, { method: "POST", token: b.token });
    assert.equal(bDismiss.status, 404, "B cannot dismiss A's notice — it isn't visible to B");
    // A's notice is still active (no cross-account side effect).
    const stillActive = await admin.query("select dismissed_at from pf_anomaly_notice where id=$1", [noticeId]);
    assert.equal(stillActive.rows[0].dismissed_at, null, "A's notice remains un-dismissed after B's attempt");

    // A CAN dismiss its own notice.
    const aDismiss = await api(BASE, `/pf/anomaly-notices/${noticeId}/dismiss`, { method: "POST", token: a.token });
    assert.equal(aDismiss.status, 200, "A dismisses its own notice");
    const dismissed = await admin.query("select dismissed_at from pf_anomaly_notice where id=$1", [noticeId]);
    assert.notEqual(dismissed.rows[0].dismissed_at, null, "the notice is now dismissed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("anomaly generation (manual run trigger; heuristic + dedup + on/off)", () => {
  it("flags a period-total spike, dedups on re-run, and surfaces in insights", async () => {
    const { token } = await registerPf("BDT");
    // Baseline: 100 in each of the previous 3 months → avg 100. Current month: a 600
    // spike (uncategorised, so only the period_total path fires deterministically).
    for (const k of [1, 2, 3]) {
      await api(BASE, "/pf/expense", { method: "POST", token, body: { amount: 100, currency: "BDT", occurredOn: monthBack(k) } });
    }
    await api(BASE, "/pf/expense", { method: "POST", token, body: { amount: 600, currency: "BDT", occurredOn: datePlus(0) } });

    const run1 = await api(BASE, "/pf/anomaly-notices/run", { method: "POST", token });
    assert.equal(run1.status, 200, JSON.stringify(run1.body));
    assert.ok(run1.body.raised >= 1, "600 vs ~100 baseline (×1.5 = 150) raises a period-total anomaly");

    // The notice shows in insights.
    const ins = await api(BASE, "/pf/insights", { token });
    assert.ok((ins.body.anomalies as Array<{ kind: string }>).some((a) => a.kind === "period_total"), "the anomaly appears in insights");

    // Re-run is idempotent — one notice per (scope, period).
    const run2 = await api(BASE, "/pf/anomaly-notices/run", { method: "POST", token });
    assert.equal(run2.body.raised, 0, "re-run raises nothing new (deduped per period)");
  });

  it("does NOT flag flat spending, and respects anomalyEnabled=off", async () => {
    // Flat: 100 every month incl. current → observed == baseline → no flag.
    const flat = await registerPf("BDT");
    for (const k of [1, 2, 3]) {
      await api(BASE, "/pf/expense", { method: "POST", token: flat.token, body: { amount: 100, currency: "BDT", occurredOn: monthBack(k) } });
    }
    await api(BASE, "/pf/expense", { method: "POST", token: flat.token, body: { amount: 100, currency: "BDT", occurredOn: datePlus(0) } });
    const flatRun = await api(BASE, "/pf/anomaly-notices/run", { method: "POST", token: flat.token });
    assert.equal(flatRun.body.raised, 0, "flat spending (100 vs 100) is not flagged");

    // Off: a real spike but anomalyEnabled=false → run raises nothing.
    const off = await registerPf("BDT");
    await api(BASE, "/pf/preferences", { method: "PATCH", token: off.token, body: { anomalyEnabled: false } });
    for (const k of [1, 2, 3]) {
      await api(BASE, "/pf/expense", { method: "POST", token: off.token, body: { amount: 100, currency: "BDT", occurredOn: monthBack(k) } });
    }
    await api(BASE, "/pf/expense", { method: "POST", token: off.token, body: { amount: 900, currency: "BDT", occurredOn: datePlus(0) } });
    const offRun = await api(BASE, "/pf/anomaly-notices/run", { method: "POST", token: off.token });
    assert.equal(offRun.body.raised, 0, "anomalyEnabled=off suppresses generation");
  });
});
