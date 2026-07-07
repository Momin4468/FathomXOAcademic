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
 * P0 item 2 (0037) — BLACK-BOX HTTP against the COMPILED app. Proves:
 *   • business multi-currency: a payment records the BDT amount + the foreign
 *     original_currency/original_amount/fx_rate; a plain BDT payment defaults
 *     original_currency='BDT'; new mediums (MTB/USDT) are accepted.
 *   • a govt FX-incentive lands in `other_income` (business income, not a leg).
 *   • DISJOINTNESS (the hard rule): other_income can NEVER net a client's dues —
 *     an invoice line's due is unchanged after recording other_income, no
 *     payment/payment_allocation is created, and it isn't a payment.
 *   • reversal nets to zero; double-reverse is refused.
 * Requires FEATURE_BILLING + FEATURE_WORK.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3256;
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const ORG = "00000000-0000-4000-8000-000000000001";

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let mominToken = "";
let clientPartyId = "";
const createdWorkItemIds: string[] = [];
const createdPaymentIds: string[] = [];
const createdOtherIncomeIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — build the api first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT), FEATURE_BILLING: "true", FEATURE_WORK: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (d) => {
    const s = String(d);
    if (/error/i.test(s)) process.stderr.write(`[api] ${s}`);
  });
  await waitForHealth(BASE);
}

const login = (email: string, password: string) => api(BASE, "/auth/login", { method: "POST", body: { email, password } });

async function recordPayment(body: Record<string, unknown>) {
  const res = await api(BASE, "/payments", { method: "POST", token: mominToken, body: { paidAt: "2026-06-01", ...body } });
  if (res.status === 201 && res.body?.id) createdPaymentIds.push(res.body.id);
  return res;
}
async function recordOtherIncome(body: Record<string, unknown>) {
  const res = await api(BASE, "/other-income", { method: "POST", token: mominToken, body });
  if (res.status === 201 && res.body?.id) createdOtherIncomeIds.push(res.body.id);
  return res;
}
async function createWorkItem(): Promise<string> {
  const res = await api(BASE, "/work", { method: "POST", token: mominToken, body: { title: `M2TEST ${randomUUID().slice(0, 8)}` } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  createdWorkItemIds.push(res.body.id);
  return res.body.id;
}
async function addClientLine(workId: string, amount: number): Promise<string> {
  const res = await api(BASE, `/work/${workId}/lines`, {
    method: "POST",
    token: mominToken,
    body: { lineKind: "copy", consumerPartyId: clientPartyId, fixedAmount: amount },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}
async function attachLine(workLineId: string): Promise<{ invoiceLineId: string; invoiceId: string }> {
  const res = await api(BASE, "/invoices/attach-line", { method: "POST", token: mominToken, body: { workLineId } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { invoiceLineId: res.body.id, invoiceId: res.body.invoiceId };
}

before(async () => {
  await admin.connect();
  await startServer();
  const m = await login("momin@fathomxo.local", DEV_PASSWORD);
  assert.equal(m.status, 200, "momin logs in");
  mominToken = m.body.accessToken;
  clientPartyId = randomUUID();
  await admin.query("insert into party (id, org_id, display_name, party_type) values ($1,$2,'M2TEST Client','{client}')", [clientPartyId, ORG]);
});

after(async () => {
  for (const id of createdWorkItemIds) {
    await admin.query("delete from payment_allocation where invoice_line_id in (select il.id from invoice_line il join work_line wl on wl.id=il.work_line_id where wl.work_item_id=$1)", [id]);
    await admin.query("delete from invoice_line where work_line_id in (select id from work_line where work_item_id=$1)", [id]);
    await admin.query("delete from leg where work_item_id=$1", [id]);
    await admin.query("delete from work_line where work_item_id=$1", [id]);
    await admin.query("delete from work_item where id=$1", [id]);
  }
  await admin.query("delete from invoice_line where invoice_id in (select id from invoice where client_party_id=$1)", [clientPartyId]);
  await admin.query("delete from invoice where client_party_id=$1", [clientPartyId]);
  for (const id of createdOtherIncomeIds) await admin.query("delete from other_income where id=$1 or reverses_income_id=$1", [id]);
  for (const id of createdPaymentIds) {
    await admin.query("delete from payment_allocation where payment_id=$1", [id]);
    await admin.query("delete from payment where id=$1 or reverses_payment_id=$1", [id]);
  }
  await admin.query("delete from party where id=$1", [clientPartyId]);
  await admin.end();
  if (server && !server.killed) server.kill();
});

// ─── Multi-currency on the business payment ledger ─────────────────────────────

describe("business multi-currency payment (amount stays BDT; foreign provenance)", () => {
  it("a USDT receipt stores BDT amount + original currency/amount/rate", async () => {
    const res = await recordPayment({ direction: "in", counterpartyPartyId: clientPartyId, amount: 12500, medium: "USDT", originalCurrency: "USDT", originalAmount: 100, fxRate: 125 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const got = await api(BASE, `/payments/${res.body.id}`, { token: mominToken });
    assert.equal(Number(got.body.payment.amount), 12500, "BDT amount is authoritative");
    assert.equal(got.body.payment.originalCurrency, "USDT");
    assert.equal(Number(got.body.payment.originalAmount), 100);
    assert.equal(Number(got.body.payment.fxRate), 125);
  });

  it("the new MTB medium is accepted (was rejected before)", async () => {
    const res = await recordPayment({ direction: "in", amount: 3000, medium: "MTB" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });

  it("a plain BDT payment (no currency fields) defaults original_currency='BDT'", async () => {
    const res = await recordPayment({ direction: "in", amount: 1000 });
    assert.equal(res.status, 201);
    const got = await api(BASE, `/payments/${res.body.id}`, { token: mominToken });
    assert.equal(got.body.payment.originalCurrency, "BDT");
  });

  it("an unknown medium is still rejected (boundary)", async () => {
    const res = await recordPayment({ direction: "in", amount: 1, medium: "Monopoly" });
    assert.equal(res.status, 400);
  });
});

// ─── other_income + the disjointness rule ──────────────────────────────────────

describe("govt FX incentive as its own income line — never nets a client due", () => {
  it("records other_income (govt_fx_incentive) with foreign provenance", async () => {
    const res = await recordOtherIncome({ amount: 250, category: "govt_fx_incentive", occurredOn: "2026-06-02", originalCurrency: "USD", originalAmount: 2, fxRate: 125, note: "2.5% on a foreign transfer" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.category, "govt_fx_incentive");
    const list = await api(BASE, "/other-income", { token: mominToken });
    assert.equal(list.status, 200);
    assert.ok((list.body as Array<any>).some((r) => r.id === res.body.id), "it appears in GET /other-income");
  });

  it("DISJOINTNESS: an invoice line's due is unchanged after recording other_income", async () => {
    const workId = await createWorkItem();
    const line = await addClientLine(workId, 5000);
    const { invoiceId } = await attachLine(line);
    const before = await api(BASE, `/invoices/${invoiceId}`, { token: mominToken });
    const dueBefore = Number((before.body.lines as Array<any>)[0].due);
    assert.equal(dueBefore, 5000, "the line is fully due before");

    const allocBefore = (await admin.query("select count(*)::int n from payment_allocation")).rows[0].n;
    const inc = await recordOtherIncome({ amount: 1000, category: "govt_fx_incentive", occurredOn: "2026-06-03" });
    assert.equal(inc.status, 201);

    const after = await api(BASE, `/invoices/${invoiceId}`, { token: mominToken });
    const dueAfter = Number((after.body.lines as Array<any>)[0].due);
    assert.equal(dueAfter, 5000, "the client's due is UNCHANGED — other_income cannot offset it");

    // Structural: recording income created no allocation and is not a payment.
    const allocAfter = (await admin.query("select count(*)::int n from payment_allocation")).rows[0].n;
    assert.equal(allocAfter, allocBefore, "no payment_allocation was created");
    const asPayment = (await admin.query("select count(*)::int n from payment where id=$1", [inc.body.id])).rows[0].n;
    assert.equal(asPayment, 0, "other_income is not a payment");
    const inPayments = await api(BASE, "/payments", { token: mominToken });
    assert.ok(!(inPayments.body as Array<any>).some((p) => p.id === inc.body.id), "it never appears in the payments ledger");
  });

  it("reversal nets to zero; double-reverse is refused", async () => {
    const inc = await recordOtherIncome({ amount: 400, category: "other", occurredOn: "2026-06-04" });
    assert.equal(inc.status, 201);
    const rev = await api(BASE, "/other-income/reverse", { method: "POST", token: mominToken, body: { originalId: inc.body.id } });
    assert.equal(rev.status, 201, JSON.stringify(rev.body));
    if (rev.body?.id) createdOtherIncomeIds.push(rev.body.id);
    const sum = (await admin.query("select coalesce(sum(amount),0)::float n from other_income where id=$1 or reverses_income_id=$1", [inc.body.id])).rows[0].n;
    assert.equal(sum, 0, "original + reversal net to zero");
    const again = await api(BASE, "/other-income/reverse", { method: "POST", token: mominToken, body: { originalId: inc.body.id } });
    assert.equal(again.status, 400, "cannot double-reverse");
  });

  it("out-of-enum other_income category → 400 (boundary)", async () => {
    const res = await recordOtherIncome({ amount: 1, category: "bribe", occurredOn: "2026-06-04" });
    assert.equal(res.status, 400);
  });
});
