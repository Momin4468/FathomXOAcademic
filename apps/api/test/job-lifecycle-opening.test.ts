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
 * Phase 4A (per-line lifecycle) + Phase 5 (opening balance). Proves:
 *   • line_status transitions: pending→submitted, pending→cancelled; a MANUAL
 *     →billed is rejected; a billed line is frozen (correct via reprice);
 *   • the billing sync point: attaching a line to an invoice flips its line_status
 *     →billed AND the job money_state →invoiced in the same action;
 *   • the job status is a derived rollup of its lines;
 *   • an opening balance feeds the derived party balance and a reversal nets it out;
 *     a PAST as_of is accepted (backdating);
 *   • a post-billed reprice auto-writes a writer notification (module-19 surface).
 * Requires FEATURE_WORK + FEATURE_BILLING.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const rootEnv = resolve(apiRoot, "../..", ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3262;
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const ORG = "00000000-0000-4000-8000-000000000001";
const MOMIN_PARTY = "00000000-0000-4000-8000-0000000000c1";
const MOMIN_USER = "00000000-0000-4000-8000-0000000000d3";

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
let mominToken = "";
let clientPartyId = "";
let writerPartyId = "";
const createdWorkItemIds: string[] = [];
const createdPartyIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — build the api first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT), FEATURE_WORK: "true", FEATURE_BILLING: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (d) => { const s = String(d); if (/error/i.test(s)) process.stderr.write(`[api] ${s}`); });
  await waitForHealth(BASE);
}
const login = (email: string, password: string) => api(BASE, "/auth/login", { method: "POST", body: { email, password } });
async function makeParty(name: string, type: string): Promise<string> {
  const id = randomUUID();
  await admin.query("insert into party (id, org_id, display_name, party_type) values ($1,$2,$3,$4)", [id, ORG, name, `{${type}}`]);
  createdPartyIds.push(id);
  return id;
}
async function createJob(body: Record<string, unknown> = {}): Promise<string> {
  const res = await api(BASE, "/work", { method: "POST", token: mominToken, body: { title: `LC ${randomUUID().slice(0, 8)}`, ...body } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  createdWorkItemIds.push(res.body.id);
  return res.body.id;
}
const addLine = (jobId: string, body: Record<string, unknown>) => api(BASE, `/work/${jobId}/lines`, { method: "POST", token: mominToken, body });
const setStatus = (lineId: string, to: string) => api(BASE, `/work/lines/${lineId}/status`, { method: "POST", token: mominToken, body: { to } });
const detail = (jobId: string) => api(BASE, `/work/${jobId}`, { token: mominToken });

before(async () => {
  await admin.connect();
  await startServer();
  mominToken = (await login("momin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  clientPartyId = await makeParty("LC Client", "client");
  writerPartyId = await makeParty("LC Writer", "writer");
});

after(async () => {
  for (const id of createdWorkItemIds) {
    await admin.query("delete from payment_allocation where invoice_line_id in (select il.id from invoice_line il join work_line wl on wl.id=il.work_line_id where wl.work_item_id=$1)", [id]);
    await admin.query("delete from invoice_line where work_line_id in (select id from work_line where work_item_id=$1)", [id]);
    await admin.query("delete from leg where work_item_id=$1", [id]);
    await admin.query("delete from work_line where work_item_id=$1", [id]);
    await admin.query("delete from audit_log where entity_id=$1", [id]);
    await admin.query("delete from work_item where id=$1", [id]);
  }
  await admin.query("delete from invoice where client_party_id=$1", [clientPartyId]);
  for (const id of createdPartyIds) {
    await admin.query("delete from opening_balance where party_id=$1", [id]);
    await admin.query("delete from party where id=$1", [id]);
  }
  await admin.query("delete from notification where recipient_user_id=$1 and kind='fee_adjustment'", [MOMIN_USER]);
  await admin.end();
  if (server && !server.killed) server.kill();
});

describe("work_line lifecycle (Phase 4A)", () => {
  it("transitions + billing sync + rollup + frozen-when-billed", async () => {
    const jobId = await createJob({ doerPartyId: writerPartyId });
    const line = await addLine(jobId, { lineKind: "part", consumerPartyId: clientPartyId, fixedAmount: 5000 });
    assert.equal(line.status, 201, JSON.stringify(line.body));
    const lineId = line.body.id as string;

    // Default is 'pending'; a manual →billed is rejected.
    let d = await detail(jobId);
    assert.equal(d.body.lines.find((l: any) => l.id === lineId).lineStatus, "pending");
    assert.equal((await setStatus(lineId, "billed")).status, 400, "a line is billed by invoicing, not a status change");

    // pending → submitted.
    assert.equal((await setStatus(lineId, "submitted")).status, 200);
    d = await detail(jobId);
    assert.equal(d.body.lines.find((l: any) => l.id === lineId).lineStatus, "submitted");

    // Billing sync: attaching to an invoice flips line→billed AND money_state→invoiced.
    const attach = await api(BASE, "/invoices/attach-line", { method: "POST", token: mominToken, body: { workLineId: lineId } });
    assert.equal(attach.status, 201, JSON.stringify(attach.body));
    d = await detail(jobId);
    assert.equal(d.body.lines.find((l: any) => l.id === lineId).lineStatus, "billed", "invoicing sets the line billed");
    assert.equal(d.body.item.moneyState, "invoiced", "…in the same action that flips money-state");

    // A billed line is frozen (correct the amount via reprice, not a status change).
    assert.equal((await setStatus(lineId, "cancelled")).status, 400, "a billed line can't change status");

    // A second line can be cancelled from pending; rollup reflects the mix.
    const line2 = await addLine(jobId, { lineKind: "part", consumerPartyId: clientPartyId, fixedAmount: 1000 });
    assert.equal((await setStatus(line2.body.id, "cancelled")).status, 200);
    d = await detail(jobId);
    assert.ok(typeof d.body.jobStatus?.label === "string" && d.body.jobStatus.total >= 2, "job status is a derived rollup");
    assert.equal(d.body.jobStatus.counts.billed, 1);
    assert.equal(d.body.jobStatus.counts.cancelled, 1);
  });
});

describe("opening balance (Phase 5)", () => {
  it("feeds the derived party balance; a reversal nets out; a past date is accepted", async () => {
    const balOf = async () => (await api(BASE, `/billing/balance/${writerPartyId}`, { token: mominToken })).body as { openingBalance: number; net: number };
    const before = await balOf();

    const pastDate = new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10);
    const created = await api(BASE, "/opening-balances", { method: "POST", token: mominToken, body: { partyId: writerPartyId, amount: 1500, asOf: pastDate, note: "carried-over (test)" } });
    assert.equal(created.status, 201, `backdated opening balance accepted (${JSON.stringify(created.body)})`);

    const afterAdd = await balOf();
    assert.equal(afterAdd.openingBalance, before.openingBalance + 1500, "opening balance surfaces in the party balance");
    assert.equal(afterAdd.net, before.net + 1500, "…and folds into the net position");

    // Reverse → back to the starting point (append-only correction).
    const rev = await api(BASE, `/opening-balances/${created.body.id}/reverse`, { method: "POST", token: mominToken });
    assert.equal(rev.status, 201, JSON.stringify(rev.body));
    const afterRev = await balOf();
    assert.equal(afterRev.openingBalance, before.openingBalance, "a reversing entry nets the opening balance out");
  });
});

describe("post-billed reprice notifies the writer (Phase 4A)", () => {
  it("a reprice writes a fee_adjustment notification to the doer's user", async () => {
    // Doer = Momin (who has a user account), so the notify has a recipient.
    const jobId = await createJob({ doerPartyId: MOMIN_PARTY });
    await api(BASE, `/work/${jobId}/legs`, { method: "POST", token: mominToken, body: { legs: [{ seq: 3, fromPartyId: MOMIN_PARTY, toPartyId: writerPartyId, amount: 3000 }] } });

    const beforeN = Number((await admin.query("select count(*)::int n from notification where recipient_user_id=$1 and kind='fee_adjustment'", [MOMIN_USER])).rows[0].n);
    const rp = await api(BASE, `/work/${jobId}/legs/reprice`, { method: "POST", token: mominToken, body: { fromPartyId: MOMIN_PARTY, toPartyId: writerPartyId, newAmount: 4000, note: "renegotiated" } });
    assert.equal(rp.status, 200, JSON.stringify(rp.body));
    const afterN = Number((await admin.query("select count(*)::int n from notification where recipient_user_id=$1 and kind='fee_adjustment'", [MOMIN_USER])).rows[0].n);
    assert.equal(afterN, beforeN + 1, "the reprice fired exactly one writer notification via the existing surface");
  });
});
