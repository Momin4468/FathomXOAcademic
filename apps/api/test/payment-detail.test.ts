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
 * Change 2 — GET /payments/:id (payment.service.getById; billing.controller
 * @Get("payments/:id") gated billing:view). BLACK-BOX HTTP against the COMPILED
 * app (dist/main.js); mirrors billing-http.test.ts. Proves:
 *   • the detail returns {payment, allocations, proofs} (a payment with an
 *     allocation + an attached proof surfaces all three);
 *   • an unknown id → 404 (RLS / not-found);
 *   • a role without billing:view → 403 (server-side authz).
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3231; // dedicated test port for the payment-detail suite
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const STORAGE_DIR = mkdtempSync(join(tmpdir(), "bos-paydetail-"));

const ORG = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // work:view+create, NO billing

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = "";
let mominToken = "";
let writerToken = "";
let writerPartyId = "";
let clientPartyId = "";

const createdUserIds: string[] = [];
const createdPartyIds: string[] = [];
const createdWorkItemIds: string[] = [];
const createdFileIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT), FEATURE_BILLING: "true", FEATURE_WORK: "true", FEATURE_KNOWLEDGE: "true", STORAGE_DIR },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (d) => {
    const s = String(d);
    if (/error/i.test(s)) process.stderr.write(`[api] ${s}`);
  });
  await waitForHealth(BASE);
}

async function login(email: string, password: string) {
  return api(BASE, "/auth/login", { method: "POST", body: { email, password } });
}

async function makeUserWithRole(roleId: string, partyId?: string): Promise<{ token: string; userId: string }> {
  const email = `paydetail+${randomUUID()}@fathomxo.test`;
  const body: Record<string, unknown> = { email, password: DEV_PASSWORD };
  if (partyId) body.partyId = partyId;
  const created = await api(BASE, "/platform/users", { method: "POST", token: sysToken, body });
  assert.equal(created.status, 201, `user create should succeed (got ${created.status}: ${JSON.stringify(created.body)})`);
  const userId = created.body.id as string;
  createdUserIds.push(userId);
  const assigned = await api(BASE, `/platform/users/${userId}/roles`, { method: "POST", token: sysToken, body: { roleId } });
  assert.equal(assigned.status, 201, `role assign should succeed (got ${assigned.status})`);
  const li = await login(email, DEV_PASSWORD);
  assert.equal(li.status, 200, "the new user should log in");
  return { token: li.body.accessToken as string, userId };
}

async function makeParty(name: string, type: string): Promise<string> {
  const id = randomUUID();
  await admin.query("insert into party (id, org_id, display_name, party_type) values ($1,$2,$3,$4)", [id, ORG, name, `{${type}}`]);
  createdPartyIds.push(id);
  return id;
}

async function uploadFile(content: string, name: string, kind: string, token: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from(content, "utf8")], { type: "text/plain" }), name);
  fd.append("kind", kind);
  const res = await fetch(`${BASE}/files`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: fd });
  const body = JSON.parse(await res.text());
  assert.equal(res.status, 201, `upload should succeed (got ${res.status}: ${JSON.stringify(body)})`);
  createdFileIds.push(body.id);
  return body.id as string;
}

before(async () => {
  await admin.connect();
  await startServer();
  sysToken = (await login("sysadmin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  mominToken = (await login("momin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  assert.ok(sysToken && mominToken, "seeded logins succeed");

  clientPartyId = await makeParty("PAYDETAIL Client", "client");
  writerPartyId = await makeParty("PAYDETAIL Writer", "writer");
  ({ token: writerToken } = await makeUserWithRole(WRITER_ROLE, writerPartyId));
});

after(async () => {
  for (const id of createdWorkItemIds) {
    await admin.query("delete from payment_allocation where invoice_line_id in (select il.id from invoice_line il join work_line wl on wl.id=il.work_line_id where wl.work_item_id=$1)", [id]);
    await admin.query("delete from invoice_line where work_line_id in (select id from work_line where work_item_id=$1)", [id]);
    await admin.query("delete from work_line where work_item_id=$1", [id]);
    await admin.query("delete from work_item where id=$1", [id]);
  }
  for (const id of createdPartyIds) {
    await admin.query("delete from payment_proof where payment_id in (select id from payment where counterparty_party_id=$1)", [id]);
    await admin.query("delete from payment_allocation where payment_id in (select id from payment where counterparty_party_id=$1)", [id]);
    await admin.query("delete from payment where counterparty_party_id=$1", [id]);
    await admin.query("delete from invoice_line where invoice_id in (select id from invoice where client_party_id=$1)", [id]);
    await admin.query("delete from invoice where client_party_id=$1", [id]);
  }
  for (const id of createdFileIds) {
    await admin.query("delete from payment_proof where file_object_id=$1", [id]);
    await admin.query("delete from audit_log where entity_id=$1", [id]);
    await admin.query("delete from file_object where id=$1", [id]);
  }
  for (const id of createdUserIds) {
    await admin.query("delete from audit_log where actor_user_id=$1", [id]);
    await admin.query("delete from auth_refresh_token where user_id=$1", [id]);
    await admin.query("delete from user_role where user_id=$1", [id]);
    await admin.query("delete from user_account where id=$1", [id]);
  }
  for (const id of createdPartyIds) {
    await admin.query("delete from party where id=$1", [id]);
  }
  await admin.end();
  if (server && !server.killed) server.kill();
});

describe("GET /payments/:id — {payment, allocations, proofs}", () => {
  let paymentId = "";

  it("returns the payment, its allocations, and its proofs", async () => {
    // A billable client line on a fresh job.
    const work = await api(BASE, "/work", { method: "POST", token: mominToken, body: { title: `PAYDETAIL Job ${randomUUID().slice(0, 8)}` } });
    assert.equal(work.status, 201);
    const workId = work.body.id as string;
    createdWorkItemIds.push(workId);

    const line = await api(BASE, `/work/${workId}/lines`, { method: "POST", token: mominToken, body: { lineKind: "copy", consumerPartyId: clientPartyId, fixedAmount: 1000 } });
    assert.equal(line.status, 201);
    const attached = await api(BASE, "/invoices/attach-line", { method: "POST", token: mominToken, body: { workLineId: line.body.id } });
    assert.equal(attached.status, 201);
    const invoiceLineId = attached.body.id as string;

    // A payment, an allocation of 600, and an attached proof file.
    const pay = await api(BASE, "/payments", { method: "POST", token: mominToken, body: { direction: "in", amount: 1000, paidAt: "2026-06-01", counterpartyPartyId: clientPartyId } });
    assert.equal(pay.status, 201);
    paymentId = pay.body.id as string;

    const alloc = await api(BASE, `/payments/${paymentId}/allocate`, { method: "POST", token: mominToken, body: { items: [{ invoiceLineId, amount: 600 }] } });
    assert.equal(alloc.status, 201);

    const fileId = await uploadFile("a payment proof receipt", "proof.txt", "proof", mominToken);
    const proof = await api(BASE, `/payments/${paymentId}/proof`, { method: "POST", token: mominToken, body: { fileObjectId: fileId, side: "payer" } });
    assert.equal(proof.status, 201, `attach proof should succeed (got ${proof.status}: ${JSON.stringify(proof.body)})`);

    const res = await api(BASE, `/payments/${paymentId}`, { token: mominToken });
    assert.equal(res.status, 200, `get payment should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.payment.id, paymentId, "the payment is returned");
    assert.equal(Number(res.body.payment.amount), 1000, "the payment amount is exposed");
    assert.equal(res.body.allocations.length, 1, "the single allocation is returned");
    assert.equal(Number(res.body.allocations[0].amount), 600, "the allocation amount is correct");
    assert.equal(res.body.allocations[0].invoiceLineId, invoiceLineId, "the allocation links to the invoice line");
    assert.equal(res.body.proofs.length, 1, "the attached proof is returned");
    assert.equal(res.body.proofs[0].fileObjectId, fileId, "the proof references the uploaded file");
    assert.equal(res.body.proofs[0].side, "payer");
  });

  it("an unknown payment id → 404", async () => {
    const res = await api(BASE, `/payments/${randomUUID()}`, { token: mominToken });
    assert.equal(res.status, 404, `an unknown id must be 404 (got ${res.status})`);
  });

  it("a non-uuid id → 400 (ParseUUIDPipe)", async () => {
    const res = await api(BASE, "/payments/not-a-uuid", { token: mominToken });
    assert.equal(res.status, 400);
  });

  it("a role without billing:view → 403", async () => {
    assert.ok(paymentId, "a payment exists from the first test");
    const res = await api(BASE, `/payments/${paymentId}`, { token: writerToken });
    assert.equal(res.status, 403, "reading a payment detail needs billing:view");
  });
});
