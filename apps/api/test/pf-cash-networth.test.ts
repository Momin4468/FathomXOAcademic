import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { config } from "dotenv";
import pg from "pg";
import { api, waitForHealth } from "./helpers.js";

/**
 * PF net-worth + cash check-in (§11, 0047) — BLACK-BOX HTTP vs the COMPILED app.
 *   • net worth = savings + investments + receivable − owed + cash-on-hand, DERIVED
 *     (reversing an event moves it); base-currency only (§11 no forced FX);
 *   • cash reconcile: discrepancy = declared − (prior + netLiquidFlow), and the
 *     suggested adjustment is NOT persisted (no ledger side effect);
 *   • plane isolation: a business token → 401 on /pf/cash/reconcile.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
if (existsSync(resolve(repoRoot, ".env"))) config({ path: resolve(repoRoot, ".env") });

const PORT = 3244;
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
const acctIds: string[] = [];
let mominToken = "";
let pgToday = "";
function datePlus(days: number): string {
  const d = new Date(`${pgToday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — build the api first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT), FEATURE_PERSONAL_FINANCE: "true", FEATURE_EXPENSES: "true", EMAIL_ADAPTER: "dev" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (d) => { const s = String(d); if (/error/i.test(s)) process.stderr.write(`[api] ${s}`); });
  await waitForHealth(BASE);
}

async function registerPf(baseCurrency = "BDT") {
  const email = `pfcash+${randomUUID()}@pf.test`;
  const res = await api(BASE, "/pf/auth/register", { method: "POST", body: { email, password: DEV_PASSWORD, displayName: "Cash Tester", baseCurrency } });
  assert.equal(res.status, 201, `register (${res.status}: ${JSON.stringify(res.body)})`);
  const me = await api(BASE, "/pf/auth/me", { token: res.body.accessToken });
  acctIds.push(me.body.id as string);
  return { token: res.body.accessToken as string, id: me.body.id as string };
}
const post = (token: string, path: string, body: unknown) => api(BASE, path, { method: "POST", token, body });
const nw = async (token: string) => Number(((await api(BASE, "/pf/dashboard", { token })).body as { netWorth: { value: string } }).netWorth.value);

before(async () => {
  await admin.connect();
  pgToday = (await admin.query("select current_date::text as d")).rows[0].d as string;
  await startServer();
  const m = await api(BASE, "/auth/login", { method: "POST", body: { email: "momin@fathomxo.local", password: DEV_PASSWORD } });
  mominToken = m.body.accessToken;
});

after(async () => {
  for (const id of acctIds) {
    for (const t of ["pf_investment_event", "pf_investment", "pf_saving_event", "pf_saving", "pf_loan_event", "pf_loan", "pf_cash_checkin", "pf_income", "pf_expense", "pf_category", "pf_audit_log", "pf_refresh_token"]) {
      await admin.query(`delete from ${t} where pf_account_id=$1`, [id]);
    }
    await admin.query("delete from pf_account where id=$1", [id]);
  }
  await admin.end();
  if (server && !server.killed) server.kill();
});

describe("PF net worth — one derived number (stock), base currency only", () => {
  it("savings + investments + receivable − owed + cash; moves when an event reverses", async () => {
    const a = await registerPf();
    // savings 2000
    const pot = await post(a.token, "/pf/savings", { name: "Pot", currency: "BDT" });
    await post(a.token, `/pf/savings/${pot.body.id}/events`, { kind: "deposit", amount: 2000, occurredOn: datePlus(-3) });
    // loan given 1000 (receivable) + loan taken 500 (owed)
    await post(a.token, "/pf/loans", { direction: "given", counterpartyName: "Friend", principal: 1000, currency: "BDT", startedOn: datePlus(-3) });
    await post(a.token, "/pf/loans", { direction: "taken", counterpartyName: "Bank", principal: 500, currency: "BDT", startedOn: datePlus(-3) });
    // investment 3000, marked at 3500
    const inv = await post(a.token, "/pf/investments", { name: "Fund", principal: 3000, currency: "BDT", startedOn: datePlus(-3) });
    await post(a.token, `/pf/investments/${inv.body.id}/events`, { kind: "valuation", amount: 3500, occurredOn: datePlus(-1) });
    // cash on hand 400
    await post(a.token, "/pf/cash/checkins", { asOf: pgToday, declaredAmount: 400 });

    assert.equal(await nw(a.token), 6400, "2000 + 3500 + 1000 − 500 + 400 = 6400");

    // A foreign-currency pot must NOT enter the BDT net worth (§11 no forced FX).
    const usdPot = await post(a.token, "/pf/savings", { name: "USD pot", currency: "USD" });
    await post(a.token, `/pf/savings/${usdPot.body.id}/events`, { kind: "deposit", amount: 9999, occurredOn: datePlus(-1) });
    assert.equal(await nw(a.token), 6400, "the USD deposit is excluded from the BDT net worth");

    // Reversing the 3500 mark falls the holding back to its 3000 cost basis → net worth moves.
    const events = (await api(BASE, `/pf/investments/${inv.body.id}/events`, { token: a.token })).body as Array<Record<string, unknown>>;
    const mark = events.find((e) => e.kind === "valuation" && Number(e.amount) === 3500)!;
    await post(a.token, `/pf/investments/events/${mark.id}/reverse`, {});
    assert.equal(await nw(a.token), 5900, "net worth is derived — it drops to 2000 + 3000 + 1000 − 500 + 400");
  });
});

describe("PF cash check-in — reconcile discrepancy (derived; no side effect)", () => {
  it("discrepancy = declared − (prior + net liquid flow); the nudge writes nothing", async () => {
    const b = await registerPf();
    // Baseline declaration 1000 ten days ago.
    await post(b.token, "/pf/cash/checkins", { asOf: datePlus(-10), declaredAmount: 1000 });
    // Interim: +500 income, −100 expense, −200 into savings → net liquid flow = +200.
    await post(b.token, "/pf/income", { amount: 500, currency: "BDT", occurredOn: datePlus(-5) });
    await post(b.token, "/pf/expense", { amount: 100, currency: "BDT", occurredOn: datePlus(-5) });
    const pot = await post(b.token, "/pf/savings", { name: "Pot", currency: "BDT" });
    await post(b.token, `/pf/savings/${pot.body.id}/events`, { kind: "deposit", amount: 200, occurredOn: datePlus(-5) });
    // Today declare 1300 → expected 1200, so 100 unexplained (over → unrecorded income).
    await post(b.token, "/pf/cash/checkins", { asOf: pgToday, declaredAmount: 1300 });

    const incomeBefore = ((await api(BASE, "/pf/income", { token: b.token })).body as Array<unknown>).length;
    const rec = (await api(BASE, "/pf/cash/reconcile", { token: b.token })).body as {
      status: string; netFlow: number; expected: number; discrepancy: number; suggestedAdjustment: { kind: string; amount: number } | null;
    };
    assert.equal(rec.netFlow, 200, "net liquid flow = 500 − 100 − 200");
    assert.equal(rec.expected, 1200, "expected = 1000 + 200");
    assert.equal(rec.discrepancy, 100, "declared 1300 − expected 1200 = 100");
    assert.equal(rec.status, "over");
    assert.equal(rec.suggestedAdjustment?.kind, "income");
    assert.equal(rec.suggestedAdjustment?.amount, 100);

    const incomeAfter = ((await api(BASE, "/pf/income", { token: b.token })).body as Array<unknown>).length;
    assert.equal(incomeAfter, incomeBefore, "🔴 the suggested adjustment must NOT be auto-created");
  });

  it("a business token cannot reach /pf/cash/reconcile (plane isolation)", async () => {
    assert.equal((await api(BASE, "/pf/cash/reconcile", { token: mominToken })).status, 401);
  });
});
