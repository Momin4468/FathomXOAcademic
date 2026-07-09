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
 * PF investments (§11, 0047) — BLACK-BOX HTTP vs the COMPILED app. Proves:
 *   • current value & P/L are DERIVED at read, never stored (latest valuation vs.
 *     cost basis); a reversal drops the reversed mark from the "latest" pick;
 *   • the new tables are account-isolated (B sees zero of A's) and plane-isolated
 *     (a business token → 401; a PF token → 401 on a business endpoint).
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
if (existsSync(resolve(repoRoot, ".env"))) config({ path: resolve(repoRoot, ".env") });

const PORT = 3243;
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
  const email = `pfinv+${randomUUID()}@pf.test`;
  const res = await api(BASE, "/pf/auth/register", { method: "POST", body: { email, password: DEV_PASSWORD, displayName: "Inv Tester", baseCurrency } });
  assert.equal(res.status, 201, `register (${res.status}: ${JSON.stringify(res.body)})`);
  const me = await api(BASE, "/pf/auth/me", { token: res.body.accessToken });
  acctIds.push(me.body.id as string);
  return { token: res.body.accessToken as string, id: me.body.id as string };
}

/** The derived investment row from GET /pf/investments. */
async function findInvestment(token: string, id: string) {
  const list = (await api(BASE, "/pf/investments", { token })).body as Array<Record<string, unknown>>;
  return list.find((r) => r.id === id);
}

before(async () => {
  await admin.connect();
  pgToday = (await admin.query("select current_date::text as d")).rows[0].d as string;
  await startServer();
  const m = await api(BASE, "/auth/login", { method: "POST", body: { email: "momin@fathomxo.local", password: DEV_PASSWORD } });
  mominToken = m.body.accessToken;
});

after(async () => {
  for (const id of acctIds) {
    await admin.query("delete from pf_investment_event where pf_account_id=$1", [id]);
    await admin.query("delete from pf_investment where pf_account_id=$1", [id]);
    await admin.query("delete from pf_category where pf_account_id=$1", [id]);
    await admin.query("delete from pf_audit_log where pf_account_id=$1", [id]);
    await admin.query("delete from pf_refresh_token where pf_account_id=$1", [id]);
    await admin.query("delete from pf_account where id=$1", [id]);
  }
  await admin.end();
  if (server && !server.killed) server.kill();
});

describe("PF investments — current value & P/L are DERIVED (never stored)", () => {
  it("latest valuation vs. cost basis; a reversal falls back to the prior mark", async () => {
    const a = await registerPf();
    const created = await api(BASE, "/pf/investments", { method: "POST", token: a.token, body: { name: "Acme shares", principal: 1000, currency: "BDT", startedOn: datePlus(-30) } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const invId = created.body.id as string;

    // No valuation yet → currentValue = cost basis = principal.
    let row = await findInvestment(a.token, invId);
    assert.equal(row?.currentValue, 1000, "no mark → current value is the cost basis");
    assert.equal(row?.unrealizedPl, 0);

    // Mark 1200 → +200.
    await api(BASE, `/pf/investments/${invId}/events`, { method: "POST", token: a.token, body: { kind: "valuation", amount: 1200, occurredOn: datePlus(-20) } });
    row = await findInvestment(a.token, invId);
    assert.equal(row?.currentValue, 1200);
    assert.equal(row?.unrealizedPl, 200);

    // A later mark 900 wins (latest, not a sum) → −100.
    await api(BASE, `/pf/investments/${invId}/events`, { method: "POST", token: a.token, body: { kind: "valuation", amount: 900, occurredOn: datePlus(-10) } });
    row = await findInvestment(a.token, invId);
    assert.equal(row?.currentValue, 900, "the latest valuation wins");
    assert.equal(row?.unrealizedPl, -100);

    // Contribute 500 AFTER the mark → cost basis 1500 AND current value +500 (cash
    // added is worth its face); a post-mark contribution never swings P/L → still −100.
    await api(BASE, `/pf/investments/${invId}/events`, { method: "POST", token: a.token, body: { kind: "contribution", amount: 500, occurredOn: datePlus(-5) } });
    row = await findInvestment(a.token, invId);
    assert.equal(row?.costBasis, 1500);
    assert.equal(row?.currentValue, 1400, "900 mark + 500 post-mark contribution");
    assert.equal(row?.unrealizedPl, -100, "a contribution does not move P/L");

    // Reverse the 900 mark → the prior mark (1200) is latest; the later 500
    // contribution still adjusts it → current value 1700, P/L +200.
    const events = (await api(BASE, `/pf/investments/${invId}/events`, { token: a.token })).body as Array<Record<string, unknown>>;
    const mark900 = events.find((e) => e.kind === "valuation" && Number(e.amount) === 900);
    assert.ok(mark900, "the 900 mark exists");
    const rev = await api(BASE, `/pf/investments/events/${mark900!.id}/reverse`, { method: "POST", token: a.token });
    assert.equal(rev.status, 201, JSON.stringify(rev.body));
    row = await findInvestment(a.token, invId);
    assert.equal(row?.currentValue, 1700, "reverting to the 1200 mark + the 500 post-mark contribution");
    assert.equal(row?.unrealizedPl, 200);

    // Re-fetch is stable (nothing is stored; it's recomputed).
    const again = await findInvestment(a.token, invId);
    assert.deepEqual(again, row, "re-read is identical — derived, not stored");
  });

  it("valuation then a contribution with NO later valuation: value = mark + contribution, P/L unchanged", async () => {
    // The exact scenario worth pinning (see DECISIONS 2026-07-10): a mark is "as of
    // its date"; cash added after it raises current value 1:1, so adding money never
    // shows as a phantom loss — only a valuation moves P/L.
    const a = await registerPf();
    const c = await api(BASE, "/pf/investments", { method: "POST", token: a.token, body: { name: "Mark-then-add", principal: 1000, currency: "BDT", startedOn: datePlus(-20) } });
    const id = c.body.id as string;

    await api(BASE, `/pf/investments/${id}/events`, { method: "POST", token: a.token, body: { kind: "valuation", amount: 1200, occurredOn: datePlus(-10) } });
    let row = await findInvestment(a.token, id);
    assert.equal(row?.currentValue, 1200, "marked at 1200");
    assert.equal(row?.unrealizedPl, 200, "1200 − 1000 = +200");

    await api(BASE, `/pf/investments/${id}/events`, { method: "POST", token: a.token, body: { kind: "contribution", amount: 300, occurredOn: datePlus(-5) } });
    row = await findInvestment(a.token, id);
    // PLAINLY: current value = 1200 (mark) + 300 (post-mark contribution) = 1500;
    // cost basis = 1000 + 300 = 1300; unrealized P/L = 1500 − 1300 = +200 (UNCHANGED
    // by the contribution). This is intended: adding money is not a gain/loss.
    assert.equal(row?.costBasis, 1300, "cost basis rises by the contribution");
    assert.equal(row?.currentValue, 1500, "current value rises by the contribution (mark + post-mark cash)");
    assert.equal(row?.unrealizedPl, 200, "🔴 a contribution must NOT change P/L — only a valuation does");
  });

  it("🔴 pf_investment stores NO derived money column (no current_value/profit)", async () => {
    const cols = (await admin.query(
      "select column_name from information_schema.columns where table_name='pf_investment'",
    )).rows.map((r: { column_name: string }) => r.column_name);
    for (const forbidden of ["current_value", "profit", "pl", "unrealized_pl", "value", "margin"]) {
      assert.ok(!cols.includes(forbidden), `pf_investment must not store '${forbidden}' — it is derived`);
    }
    assert.ok(cols.includes("principal"), "pf_investment keeps the cost basis (principal)");
  });
});

describe("PF investments — isolation (account + plane)", () => {
  it("account B never sees A's investment; cross-plane tokens are rejected", async () => {
    const a = await registerPf();
    const b = await registerPf();
    const created = await api(BASE, "/pf/investments", { method: "POST", token: a.token, body: { name: "A-only holding", principal: 5000, currency: "BDT", startedOn: datePlus(-1) } });
    assert.equal(created.status, 201);

    const bList = (await api(BASE, "/pf/investments", { token: b.token })).body as Array<Record<string, unknown>>;
    assert.ok(!bList.some((r) => r.id === created.body.id), "B never sees A's holding (zero rows, not an error)");
    // B cannot add an event to A's holding (not visible → 404).
    const cross = await api(BASE, `/pf/investments/${created.body.id}/events`, { method: "POST", token: b.token, body: { kind: "valuation", amount: 1, occurredOn: datePlus(-1) } });
    assert.equal(cross.status, 404, "B cannot touch A's holding");

    assert.equal((await api(BASE, "/pf/investments", { token: mominToken })).status, 401, "a business token can't reach /pf/investments");
    assert.equal((await api(BASE, "/expenses", { token: a.token })).status, 401, "a PF token can't reach a business endpoint");
  });
});
