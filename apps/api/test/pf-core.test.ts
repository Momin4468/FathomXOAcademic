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
 * Personal Finance core (DESIGN_SPEC §11) — BLACK-BOX HTTP against the COMPILED
 * app (dist/main.js) with FEATURE_PERSONAL_FINANCE on. Proves the per-account
 * money model the PF plane must never get wrong:
 *   • register seeds 5 income + 7 expense categories;
 *   • income/expense entries list back; the dashboard's monthly income/net sums
 *     the BASE currency only (a USD expense is NOT netted against a BDT base) —
 *     §11 "no forced FX";
 *   • reverse is append-only: a reversal row appears (negated), and an entry
 *     can't be reversed twice (400);
 *   • loan outstanding = principal + disbursement − repayment + adjustment
 *     (DERIVED, never stored); saving balance = deposits − withdrawals;
 *   • a budget_cap target's `current` reflects an in-window expense (derived).
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3240; // dedicated test port
const BASE = `http://localhost:${PORT}`;
const OUTBOX = mkdtempSync(join(tmpdir(), "bos-pf-core-"));

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

const createdPfAccountIds: string[] = [];
let pgToday = "";
/** A YYYY-MM-DD date N days from PG's current_date (UTC date math). */
function datePlus(days: number): string {
  const d = new Date(`${pgToday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** First day of the current month per PG. */
function monthStart(): string {
  return `${pgToday.slice(0, 7)}-01`;
}

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      FEATURE_PERSONAL_FINANCE: "true",
      FEATURE_BILLING: "true",
      FEATURE_EXPENSES: "true",
      EMAIL_ADAPTER: "dev",
      EMAIL_OUTBOX_DIR: OUTBOX,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (d) => {
    const s = String(d);
    if (/error/i.test(s)) process.stderr.write(`[api] ${s}`);
  });
  await waitForHealth(BASE);
}

/** Register a fresh PF account; return its access token + id (for cleanup). */
async function registerPf(baseCurrency = "BDT"): Promise<{ token: string; id: string; email: string }> {
  const email = `pf+${randomUUID()}@pf.test`;
  const res = await api(BASE, "/pf/auth/register", {
    method: "POST",
    body: { email, password: "Password123!", displayName: "PF Tester", baseCurrency },
  });
  assert.equal(res.status, 201, `register should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
  const token = res.body.accessToken as string;
  const me = await api(BASE, "/pf/auth/me", { token });
  assert.equal(me.status, 200);
  createdPfAccountIds.push(me.body.id as string);
  return { token, id: me.body.id as string, email };
}

before(async () => {
  await admin.connect();
  pgToday = (await admin.query("select current_date::text as d")).rows[0].d as string;
  await startServer();
});

after(async () => {
  // PF tables are append-only / FK-chained → delete children before parents.
  for (const id of createdPfAccountIds) {
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
});

describe("PF register seeds the default category catalog", () => {
  it("a new account has 5 income + 7 expense categories", async () => {
    const { token } = await registerPf();
    const inc = await api(BASE, "/pf/categories", { token, headers: {} });
    assert.equal(inc.status, 200);
    const all = inc.body as Array<{ kind: string }>;
    assert.equal(all.filter((c) => c.kind === "income").length, 5, "5 income categories seeded");
    assert.equal(all.filter((c) => c.kind === "expense").length, 7, "7 expense categories seeded");
  });
});

describe("entries list back; reverse is append-only (no edit/delete)", () => {
  it("create income (BDT) + expense (USD) → both list; reverse expense → a negated row; double-reverse → 400", async () => {
    const { token } = await registerPf("BDT");

    const inc = await api(BASE, "/pf/income", {
      method: "POST",
      token,
      body: { amount: 5000, currency: "BDT", occurredOn: datePlus(-1), note: "salary" },
    });
    assert.equal(inc.status, 201, JSON.stringify(inc.body));

    const exp = await api(BASE, "/pf/expense", {
      method: "POST",
      token,
      body: { amount: 30, currency: "USD", convertedAmount: 3600, convertedCurrency: "BDT", occurredOn: datePlus(-1), note: "tool" },
    });
    assert.equal(exp.status, 201, JSON.stringify(exp.body));
    const expId = exp.body.id as string;

    const incList = await api(BASE, "/pf/income", { token });
    assert.equal((incList.body as Array<unknown>).length, 1, "income lists back");
    const expList = await api(BASE, "/pf/expense", { token });
    assert.equal((expList.body as Array<unknown>).length, 1, "expense lists back (pre-reversal)");

    // Reverse the expense → append a negated mirror, original untouched.
    const rev = await api(BASE, `/pf/expense/${expId}/reverse`, { method: "POST", token });
    assert.equal(rev.status, 201, JSON.stringify(rev.body));
    assert.equal(Number(rev.body.amount), -30, "reversal amount is negated");
    assert.equal(rev.body.reversesId, expId, "reversal points at the original");

    const expList2 = await api(BASE, "/pf/expense", { token });
    assert.equal((expList2.body as Array<unknown>).length, 2, "original + reversal both present (append-only)");

    // Cannot reverse the same entry twice.
    const rev2 = await api(BASE, `/pf/expense/${expId}/reverse`, { method: "POST", token });
    assert.equal(rev2.status, 400, "an already-reversed entry cannot be reversed again");
  });
});

describe("dashboard sums the BASE currency only (no forced FX, §11)", () => {
  it("a BDT-base account: monthly income counts BDT income; a USD expense is NOT netted", async () => {
    const { token } = await registerPf("BDT");
    const occurred = datePlus(0) >= monthStart() ? datePlus(0) : monthStart(); // safely in current month

    await api(BASE, "/pf/income", { method: "POST", token, body: { amount: 10000, currency: "BDT", occurredOn: occurred } });
    await api(BASE, "/pf/expense", { method: "POST", token, body: { amount: 2000, currency: "BDT", occurredOn: occurred } });
    // A USD expense in the same month — must be EXCLUDED from a BDT-base sum.
    await api(BASE, "/pf/expense", { method: "POST", token, body: { amount: 500, currency: "USD", occurredOn: occurred } });

    const dash = await api(BASE, "/pf/dashboard", { token });
    assert.equal(dash.status, 200, JSON.stringify(dash.body));
    assert.equal(dash.body.baseCurrency, "BDT");
    assert.equal(Number(dash.body.month.income), 10000, "BDT income summed");
    assert.equal(Number(dash.body.month.expense), 2000, "only the BDT expense summed (USD excluded)");
    assert.equal(Number(dash.body.month.net), 8000, "net = 10000 − 2000 (USD never converted in)");
  });
});

describe("loan outstanding is DERIVED (principal + disb − repay + adj)", () => {
  it("loan given 1000 + repayment 300 → outstanding 700", async () => {
    const { token } = await registerPf("BDT");
    const loan = await api(BASE, "/pf/loans", {
      method: "POST",
      token,
      body: { direction: "given", counterpartyName: "Karim", principal: 1000, currency: "BDT", startedOn: datePlus(-10) },
    });
    assert.equal(loan.status, 201, JSON.stringify(loan.body));
    const loanId = loan.body.id as string;

    const ev = await api(BASE, `/pf/loans/${loanId}/events`, {
      method: "POST",
      token,
      body: { kind: "repayment", amount: 300, occurredOn: datePlus(-1) },
    });
    assert.equal(ev.status, 201, JSON.stringify(ev.body));

    const list = await api(BASE, "/pf/loans", { token });
    const row = (list.body as Array<any>).find((l) => l.id === loanId);
    assert.ok(row, "the loan lists back");
    assert.equal(Number(row.outstanding), 700, "1000 principal − 300 repayment = 700 outstanding (derived)");
  });
});

describe("saving balance is DERIVED (deposits − withdrawals)", () => {
  it("deposit 500 − withdraw 200 → balance 300", async () => {
    const { token } = await registerPf("BDT");
    const pot = await api(BASE, "/pf/savings", { method: "POST", token, body: { name: "Emergency", currency: "BDT" } });
    assert.equal(pot.status, 201, JSON.stringify(pot.body));
    const id = pot.body.id as string;

    await api(BASE, `/pf/savings/${id}/events`, { method: "POST", token, body: { kind: "deposit", amount: 500, occurredOn: datePlus(-3) } });
    await api(BASE, `/pf/savings/${id}/events`, { method: "POST", token, body: { kind: "withdraw", amount: 200, occurredOn: datePlus(-1) } });

    const list = await api(BASE, "/pf/savings", { token });
    const row = (list.body as Array<any>).find((s) => s.id === id);
    assert.ok(row, "the pot lists back");
    assert.equal(Number(row.balance), 300, "500 deposit − 200 withdraw = 300 (derived)");
  });
});

describe("target progress is DERIVED at read", () => {
  it("a current-month budget_cap reflects an in-window expense in `current`", async () => {
    const { token } = await registerPf("BDT");
    const occurred = datePlus(0) >= monthStart() ? datePlus(0) : monthStart();

    await api(BASE, "/pf/expense", { method: "POST", token, body: { amount: 1500, currency: "BDT", occurredOn: occurred } });
    const tgt = await api(BASE, "/pf/targets", {
      method: "POST",
      token,
      body: { kind: "budget_cap", period: "month", periodStart: monthStart(), amount: 5000, currency: "BDT" },
    });
    assert.equal(tgt.status, 201, JSON.stringify(tgt.body));

    const list = await api(BASE, "/pf/targets", { token });
    const row = (list.body as Array<any>).find((t) => t.id === tgt.body.id);
    assert.ok(row, "the target lists back");
    assert.equal(Number(row.current), 1500, "budget_cap `current` = the in-window expense (derived)");
    assert.equal(Number(row.amount), 5000, "the cap is the stored amount");
  });
});
