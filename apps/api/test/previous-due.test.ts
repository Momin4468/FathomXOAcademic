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
 * P0 item 4 — previous-due carryforward on invoices. DERIVED, not stored:
 * getInvoice returns `previousDue` = the client's outstanding across all PRIOR
 * real (non-estimate, non-void, non-paid) invoices. Proves: a prior unpaid
 * invoice carries forward onto a new one; a partial payment on the prior invoice
 * reduces it (so it's derived from allocations, not stored); a void/paid prior
 * invoice is excluded. Requires FEATURE_BILLING + FEATURE_WORK.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3257;
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const ORG = "00000000-0000-4000-8000-000000000001";

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
let mominToken = "";
let clientPartyId = "";
const createdWorkItemIds: string[] = [];
const createdPaymentIds: string[] = [];

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

async function createWorkItem(): Promise<string> {
  const res = await api(BASE, "/work", { method: "POST", token: mominToken, body: { title: `PDTEST ${randomUUID().slice(0, 8)}` } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  createdWorkItemIds.push(res.body.id);
  return res.body.id;
}
async function addClientLine(workId: string, amount: number): Promise<string> {
  const res = await api(BASE, `/work/${workId}/lines`, { method: "POST", token: mominToken, body: { lineKind: "copy", consumerPartyId: clientPartyId, fixedAmount: amount } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}
async function attachLine(workLineId: string): Promise<{ invoiceLineId: string; invoiceId: string }> {
  const res = await api(BASE, "/invoices/attach-line", { method: "POST", token: mominToken, body: { workLineId } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { invoiceLineId: res.body.id, invoiceId: res.body.invoiceId };
}
async function getInvoice(id: string) {
  const res = await api(BASE, `/invoices/${id}`, { token: mominToken });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body as { previousDue: number; lines: Array<{ due: number }> };
}

// Shared across the sequential its below.
let invoiceA = "";
let invoiceB = "";
let lineA1 = "";

before(async () => {
  await admin.connect();
  await startServer();
  const m = await login("momin@fathomxo.local", DEV_PASSWORD);
  assert.equal(m.status, 200);
  mominToken = m.body.accessToken;
  clientPartyId = randomUUID();
  await admin.query("insert into party (id, org_id, display_name, party_type) values ($1,$2,'PDTEST Client','{client}')", [clientPartyId, ORG]);
});

after(async () => {
  for (const id of createdWorkItemIds) {
    await admin.query("delete from payment_allocation where invoice_line_id in (select il.id from invoice_line il join work_line wl on wl.id=il.work_line_id where wl.work_item_id=$1)", [id]);
    await admin.query("delete from invoice_line where work_line_id in (select id from work_line where work_item_id=$1)", [id]);
    await admin.query("delete from leg where work_item_id=$1", [id]);
    await admin.query("delete from work_line where work_item_id=$1", [id]);
    await admin.query("delete from work_item where id=$1", [id]);
  }
  await admin.query("delete from invoice where client_party_id=$1", [clientPartyId]);
  for (const id of createdPaymentIds) await admin.query("delete from payment where id=$1", [id]);
  await admin.query("delete from party where id=$1", [clientPartyId]);
  await admin.end();
  if (server && !server.killed) server.kill();
});

describe("previous-due carryforward (derived, not stored)", () => {
  it("a prior unpaid invoice carries forward as previousDue on a new invoice", async () => {
    const workId = await createWorkItem();
    const l1 = await addClientLine(workId, 5000);
    const a = await attachLine(l1);
    invoiceA = a.invoiceId;
    lineA1 = a.invoiceLineId;
    // Close A ('sent') so the next line opens a SEPARATE invoice B.
    await admin.query("update invoice set status='sent' where id=$1", [invoiceA]);

    const l2 = await addClientLine(workId, 3000);
    const b = await attachLine(l2);
    invoiceB = b.invoiceId;
    assert.notEqual(invoiceA, invoiceB, "B is a distinct invoice");

    const gb = await getInvoice(invoiceB);
    assert.equal(gb.previousDue, 5000, "B carries forward A's ৳5000 unpaid");
    const ga = await getInvoice(invoiceA);
    assert.equal(ga.previousDue, 0, "A itself has no prior");
  });

  it("a partial payment on the prior invoice reduces previousDue (derived from allocations)", async () => {
    const pmt = await api(BASE, "/payments", { method: "POST", token: mominToken, body: { direction: "in", amount: 2000, paidAt: "2026-06-05", counterpartyPartyId: clientPartyId } });
    assert.equal(pmt.status, 201, JSON.stringify(pmt.body));
    createdPaymentIds.push(pmt.body.id);
    const alloc = await api(BASE, `/payments/${pmt.body.id}/allocate`, { method: "POST", token: mominToken, body: { items: [{ invoiceLineId: lineA1, amount: 2000 }] } });
    assert.equal(alloc.status, 201, JSON.stringify(alloc.body));

    const gb = await getInvoice(invoiceB);
    assert.equal(gb.previousDue, 3000, "previousDue drops by the ৳2000 allocated to A");
  });

  it("a void (or paid) prior invoice is excluded from previousDue", async () => {
    await admin.query("update invoice set status='void' where id=$1", [invoiceA]);
    const gb = await getInvoice(invoiceB);
    assert.equal(gb.previousDue, 0, "a void prior invoice no longer carries forward");
  });
});
