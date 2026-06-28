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
 * Change 1 — kind-aware per-file ACL (files.service.assertCanRead, backed by
 * file_owner_context(), migration 0025). BLACK-BOX HTTP against the COMPILED app
 * (dist/main.js); mirrors files-http.test.ts. Proves the request-time guarantee
 * that a sensitive file can't be pulled by any org member just by id:
 *   • a brief/solution → only the work_item's doer or source party, or work:approve;
 *   • a proof → only the payment counterparty, or billing:approve;
 *   • knowledge/cover_sheet → ANY org member;
 *   • System SuperAdmin → all; a random uuid → 404.
 * Enforced on BOTH GET /files/:id (meta) and GET /files/:id/download.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3230; // dedicated test port for the files-acl suite
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const STORAGE_DIR = mkdtempSync(join(tmpdir(), "bos-files-acl-"));
// The crypto key is lazy (no seal/open on these paths) but set a fixed key
// anyway since the app is global-crypto now — matches credential-vault-http.
const VAULT_KEY = Buffer.alloc(32, 7).toString("base64");

const ORG = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // work:view+create, NO approve
const ADMIN_ROLE = "00000000-0000-4000-8000-0000000000a3"; // billing:* + work:* (approve)

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = ""; // System SuperAdmin — sees all
let mominToken = ""; // Admin: work:approve + billing:approve

let doerToken = ""; // a Writer linked to the work_item's doer party
let doerPartyId = "";
let outsiderToken = ""; // a Writer who is NOT the doer and has NO approve perms
let outsiderPartyId = "";
let counterpartyToken = ""; // a Writer linked to the payment counterparty party
let counterpartyId = "";
let sourcePartyId = ""; // the work_item's source party (no login needed)
let approveToken = ""; // an Admin (work:approve + billing:approve), not a party to anything

const createdUserIds: string[] = [];
const createdPartyIds: string[] = [];
const createdWorkItemIds: string[] = [];
const createdPaymentIds: string[] = [];
const createdFileIds: string[] = [];

let briefFileId = "";
let proofFileId = "";
let knowledgeFileId = "";

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      FEATURE_KNOWLEDGE: "true",
      FEATURE_WORK: "true",
      FEATURE_BILLING: "true",
      FEATURE_EXPENSES: "true",
      STORAGE_DIR,
      VAULT_ENCRYPTION_KEY: VAULT_KEY,
    },
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
  const email = `filesacl+${randomUUID()}@fathomxo.test`;
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

/** Upload a small text file of a given kind via momin; track for teardown. */
async function uploadFile(content: string, name: string, kind: string, token: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from(content, "utf8")], { type: "text/plain" }), name);
  fd.append("kind", kind);
  const res = await fetch(`${BASE}/files`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: fd });
  const body = JSON.parse(await res.text());
  assert.equal(res.status, 201, `upload (${kind}) should succeed (got ${res.status}: ${JSON.stringify(body)})`);
  createdFileIds.push(body.id);
  return body.id as string;
}

/** GET /files/:id/download status (manual redirect so a link 302 isn't followed). */
async function downloadStatus(fileId: string, token: string): Promise<number> {
  const res = await fetch(`${BASE}/files/${fileId}/download`, {
    headers: { authorization: `Bearer ${token}` },
    redirect: "manual",
  });
  return res.status;
}

before(async () => {
  await admin.connect();
  await startServer();

  sysToken = (await login("sysadmin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  mominToken = (await login("momin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  assert.ok(sysToken && mominToken, "seeded logins succeed");

  doerPartyId = await makeParty("FILESACL Doer", "writer");
  outsiderPartyId = await makeParty("FILESACL Outsider", "writer");
  counterpartyId = await makeParty("FILESACL Counterparty", "client");
  sourcePartyId = await makeParty("FILESACL Source", "client");

  ({ token: doerToken } = await makeUserWithRole(WRITER_ROLE, doerPartyId));
  ({ token: outsiderToken } = await makeUserWithRole(WRITER_ROLE, outsiderPartyId));
  ({ token: counterpartyToken } = await makeUserWithRole(WRITER_ROLE, counterpartyId));
  // An Admin (work:approve + billing:approve) who is NOT a party to brief/proof.
  ({ token: approveToken } = await makeUserWithRole(ADMIN_ROLE));

  // ── Fixtures (admin client; bypasses RLS/grants) ──
  // 1. A brief linked to a work_item (doer + source set).
  briefFileId = await uploadFile("the assignment brief", "brief.txt", "brief", mominToken);
  const workId = randomUUID();
  createdWorkItemIds.push(workId);
  await admin.query(
    "insert into work_item (id, org_id, title, source_party_id, doer_party_id, brief_file_id) values ($1,$2,'FILESACL Job',$3,$4,$5)",
    [workId, ORG, sourcePartyId, doerPartyId, briefFileId],
  );

  // 2. A proof linked to a payment_proof (payment counterparty = counterpartyId).
  proofFileId = await uploadFile("the payment proof", "proof.txt", "proof", mominToken);
  const paymentId = randomUUID();
  createdPaymentIds.push(paymentId);
  await admin.query(
    "insert into payment (id, org_id, direction, counterparty_party_id, amount, paid_at) values ($1,$2,'in',$3,500,'2026-06-01')",
    [paymentId, ORG, counterpartyId],
  );
  await admin.query(
    "insert into payment_proof (id, org_id, payment_id, file_object_id, side, attached_by) values ($1,$2,$3,$4,'payer',$5)",
    [randomUUID(), ORG, paymentId, proofFileId, createdUserIds[0]],
  );

  // 3. A knowledge file (org-public kind).
  knowledgeFileId = await uploadFile("a knowledge article", "kb.txt", "knowledge", mominToken);
});

after(async () => {
  for (const id of createdPaymentIds) {
    await admin.query("delete from payment_proof where payment_id=$1", [id]);
    await admin.query("delete from payment where id=$1", [id]);
  }
  for (const id of createdWorkItemIds) {
    await admin.query("update work_item set brief_file_id=null where id=$1", [id]);
    await admin.query("delete from work_item where id=$1", [id]);
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

// ─── brief: doer/source/work:approve only ────────────────────────────────────

describe("🔴 brief ACL — only the doer/source party or work:approve (meta + download)", () => {
  it("a non-involved org member (no work:approve) → 403 on meta AND download", async () => {
    const meta = await api(BASE, `/files/${briefFileId}`, { token: outsiderToken });
    assert.equal(meta.status, 403, `outsider must not read the brief meta (got ${meta.status})`);
    const dl = await downloadStatus(briefFileId, outsiderToken);
    assert.equal(dl, 403, `outsider must not download the brief (got ${dl})`);
  });

  it("the work_item's doer party → 200 on meta AND download", async () => {
    const meta = await api(BASE, `/files/${briefFileId}`, { token: doerToken });
    assert.equal(meta.status, 200, `the doer must read the brief (got ${meta.status}: ${JSON.stringify(meta.body)})`);
    const dl = await downloadStatus(briefFileId, doerToken);
    assert.equal(dl, 200, `the doer must download the brief (got ${dl})`);
  });

  it("a work:approve admin (not a party) → 200 on the brief", async () => {
    const meta = await api(BASE, `/files/${briefFileId}`, { token: approveToken });
    assert.equal(meta.status, 200, `work:approve must read the brief (got ${meta.status}: ${JSON.stringify(meta.body)})`);
    assert.equal(await downloadStatus(briefFileId, approveToken), 200);
  });
});

// ─── proof: payment counterparty / billing:approve only ──────────────────────

describe("🔴 proof ACL — only the payment counterparty or billing:approve (meta + download)", () => {
  it("a non-involved org member (no billing:approve) → 403 on meta AND download", async () => {
    const meta = await api(BASE, `/files/${proofFileId}`, { token: outsiderToken });
    assert.equal(meta.status, 403, `outsider must not read the proof meta (got ${meta.status})`);
    const dl = await downloadStatus(proofFileId, outsiderToken);
    assert.equal(dl, 403, `outsider must not download the proof (got ${dl})`);
  });

  it("the payment counterparty → 200 on the proof", async () => {
    const meta = await api(BASE, `/files/${proofFileId}`, { token: counterpartyToken });
    assert.equal(meta.status, 200, `the counterparty must read the proof (got ${meta.status}: ${JSON.stringify(meta.body)})`);
    assert.equal(await downloadStatus(proofFileId, counterpartyToken), 200);
  });

  it("a billing:approve admin (not the counterparty) → 200 on the proof", async () => {
    const meta = await api(BASE, `/files/${proofFileId}`, { token: approveToken });
    assert.equal(meta.status, 200, `billing:approve must read the proof (got ${meta.status}: ${JSON.stringify(meta.body)})`);
    assert.equal(await downloadStatus(proofFileId, approveToken), 200);
  });

  it("🔴 the brief's doer is NOT entitled to the proof (different sensitive kind) → 403", async () => {
    // Cross-check: holding the brief does not leak the proof.
    const meta = await api(BASE, `/files/${proofFileId}`, { token: doerToken });
    assert.equal(meta.status, 403, `the doer is not the payment counterparty (got ${meta.status})`);
  });
});

// ─── knowledge: any org member ───────────────────────────────────────────────

describe("knowledge ACL — any org member may read (org-public kind)", () => {
  it("the non-involved outsider → 200 on meta AND download", async () => {
    const meta = await api(BASE, `/files/${knowledgeFileId}`, { token: outsiderToken });
    assert.equal(meta.status, 200, `any member reads knowledge (got ${meta.status})`);
    assert.equal(await downloadStatus(knowledgeFileId, outsiderToken), 200);
  });

  it("the doer (any member) → 200 on knowledge", async () => {
    const meta = await api(BASE, `/files/${knowledgeFileId}`, { token: doerToken });
    assert.equal(meta.status, 200);
  });
});

// ─── SuperAdmin sees all; unknown id → 404 ───────────────────────────────────

describe("System SuperAdmin sees all sensitive files; an unknown id → 404", () => {
  it("SuperAdmin → 200 on brief, proof, and knowledge (meta + download)", async () => {
    for (const id of [briefFileId, proofFileId, knowledgeFileId]) {
      const meta = await api(BASE, `/files/${id}`, { token: sysToken });
      assert.equal(meta.status, 200, `SuperAdmin must read ${id} (got ${meta.status})`);
      assert.equal(await downloadStatus(id, sysToken), 200, `SuperAdmin must download ${id}`);
    }
  });

  it("a random (non-existent) uuid → 404", async () => {
    const meta = await api(BASE, `/files/${randomUUID()}`, { token: sysToken });
    assert.equal(meta.status, 404, `an unknown file must be 404 (got ${meta.status})`);
    assert.equal(await downloadStatus(randomUUID(), sysToken), 404);
  });
});
