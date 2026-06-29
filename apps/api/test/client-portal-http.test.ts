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
 * Client portal (Module 18) — BLACK-BOX HTTP tests against the COMPILED app
 * (dist/main.js). Mirrors settlement-http.test.ts. Proves the THIRD-plane
 * guarantees that must NEVER silently break:
 *   • plane isolation: a client token is rejected on a business/PF endpoint and
 *     a business token is rejected on a client endpoint (distinct token typ)
 *   • own-data-only: a client sees only their jobs/AR; the writer cost (3000) /
 *     margin / doer never appears in any response
 *   • a client request lands as a DRAFT, never priced, source forced to the
 *     client's own party, with ZERO legs
 *   • messages: client↔admin thread; no cross-client thread read
 *   • admin provision: client_portal:create only; a non-permitted role is 403
 *   • refresh rotation + reuse-detection
 * Requires FEATURE_CLIENT_PORTAL + FEATURE_WORK + FEATURE_BILLING.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3219; // dedicated test port (settlement=3218)
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const CLIENT_PASSWORD = "ClientPass123!";

const ORG = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // work:view+create, NO client_portal
const WRITER_PARTY = "00000000-0000-4000-8000-0000000000c1"; // momin's writer party (chain terminal)

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let adminToken = ""; // momin@fathomxo.local — Admin (client_portal:*)
let sysToken = "";

// Client A (the source client whose chain we verify)
let clientAParty = "";
let clientAAccountId = "";
let clientAToken = "";
let clientARefresh = "";
const clientALogin = `clientA+${randomUUID().slice(0, 8)}@cp.test`;

// Client B (a second client — cross-client opacity)
let clientBParty = "";
let clientBToken = "";
const clientBLogin = `clientB+${randomUUID().slice(0, 8)}@cp.test`;

// A pure Writer user (no client_portal) — for the 403 provision test
let writerOnlyToken = "";

// The verified chain job (admin-created so legs exist)
let chainJobId = "";

const createdUserIds: string[] = [];
const createdPartyIds: string[] = [];
const createdWorkItemIds: string[] = [];
const createdAccountIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT), FEATURE_CLIENT_PORTAL: "true", FEATURE_WORK: "true", FEATURE_BILLING: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (d) => {
    const s = String(d);
    if (/error/i.test(s)) process.stderr.write(`[api] ${s}`);
  });
  // Boot is slow (~20s: many modules/routes) — allow generous headroom.
  await waitForHealth(BASE, 90000);
}

async function login(email: string, password: string) {
  return api(BASE, "/auth/login", { method: "POST", body: { email, password } });
}

async function clientLogin(loginId: string, password: string) {
  return api(BASE, "/client/auth/login", { method: "POST", body: { loginId, password } });
}

async function makeParty(name: string, type: string): Promise<string> {
  const id = randomUUID();
  await admin.query("insert into party (id, org_id, display_name, party_type) values ($1,$2,$3,$4)", [id, ORG, name, `{${type}}`]);
  createdPartyIds.push(id);
  return id;
}

async function makeWriterOnlyUser(): Promise<string> {
  const email = `cpwriter+${randomUUID()}@fathomxo.test`;
  const created = await api(BASE, "/platform/users", { method: "POST", token: sysToken, body: { email, password: DEV_PASSWORD } });
  assert.equal(created.status, 201, `user create should succeed (got ${created.status}: ${JSON.stringify(created.body)})`);
  const userId = created.body.id as string;
  createdUserIds.push(userId);
  const assigned = await api(BASE, `/platform/users/${userId}/roles`, { method: "POST", token: sysToken, body: { roleId: WRITER_ROLE } });
  assert.equal(assigned.status, 201, `role assign should succeed (got ${assigned.status})`);
  const li = await login(email, DEV_PASSWORD);
  return li.body.accessToken as string;
}

before(async () => {
  await admin.connect();
  await startServer();

  sysToken = (await login("sysadmin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  adminToken = (await login("momin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  assert.ok(sysToken && adminToken, "seeded logins succeed");

  clientAParty = await makeParty("CPHTTP Client A", "client");
  clientBParty = await makeParty("CPHTTP Client B", "client");

  // Provision both client logins via the admin endpoint (proves the provision path).
  const provA = await api(BASE, "/client-portal/accounts", {
    method: "POST",
    token: adminToken,
    body: { partyId: clientAParty, loginId: clientALogin, password: CLIENT_PASSWORD },
  });
  assert.equal(provA.status, 201, `provision A should succeed (got ${provA.status}: ${JSON.stringify(provA.body)})`);
  clientAAccountId = provA.body.id as string;
  createdAccountIds.push(clientAAccountId);

  const provB = await api(BASE, "/client-portal/accounts", {
    method: "POST",
    token: adminToken,
    body: { partyId: clientBParty, loginId: clientBLogin, password: CLIENT_PASSWORD },
  });
  assert.equal(provB.status, 201, `provision B should succeed (got ${provB.status})`);
  createdAccountIds.push(provB.body.id as string);

  // Build client A's chain job (admin): Client A → 6000 → Writer 3000, billed via an invoice.
  chainJobId = await makeChainJob(clientAParty);

  writerOnlyToken = await makeWriterOnlyUser();
});

/**
 * Build a confirmed, partially-paid chain job for the client (admin DB inserts):
 * legs Client→6000, →Writer 3000; invoice 6000 billed, 4000 paid.
 */
async function makeChainJob(clientParty: string): Promise<string> {
  const wi = randomUUID();
  const wl = randomUUID();
  const inv = randomUUID();
  const il = randomUUID();
  const pay = randomUUID();
  createdWorkItemIds.push(wi);
  await admin.query(
    "insert into work_item (id, org_id, title, source_party_id, work_state, money_state) values ($1,$2,'CPHTTP chain job',$3,'confirmed','partial')",
    [wi, ORG, clientParty],
  );
  await admin.query(
    "insert into work_line (id, org_id, work_item_id, line_kind, consumer_party_id, client_rate, unit_count) values ($1,$2,$3,'copy',$4,6000,1)",
    [wl, ORG, wi, clientParty],
  );
  await admin.query(
    `insert into leg (id, org_id, work_item_id, work_line_id, seq, from_party_id, to_party_id, amount) values
       ($1,$3,$4,$5,1,$6,$7,6000),($2,$3,$4,$5,2,$7,$8,3000)`,
    [randomUUID(), randomUUID(), ORG, wi, wl, clientParty, "00000000-0000-4000-8000-0000000000c2", WRITER_PARTY],
  );
  await admin.query("insert into invoice (id, org_id, client_party_id, status) values ($1,$2,$3,'open')", [inv, ORG, clientParty]);
  await admin.query("insert into invoice_line (id, org_id, invoice_id, work_line_id, amount) values ($1,$2,$3,$4,6000)", [il, ORG, inv, wl]);
  await admin.query("insert into payment (id, org_id, direction, counterparty_party_id, amount, paid_at) values ($1,$2,'in',$3,4000,current_date)", [pay, ORG, clientParty]);
  await admin.query("insert into payment_allocation (id, org_id, payment_id, invoice_line_id, amount) values ($1,$2,$3,$4,4000)", [randomUUID(), ORG, pay, il]);
  // track the invoice/payment for teardown via the work line
  await admin.query("update work_item set notes = $2 where id = $1", [wi, `inv:${inv};pay:${pay}`]);
  return wi;
}

after(async () => {
  // client_message for any test party
  for (const p of [clientAParty, clientBParty, ...createdPartyIds]) {
    if (!p) continue;
    await admin.query("delete from client_message where party_id=$1", [p]);
  }
  // accounts + their refresh tokens
  for (const acct of createdAccountIds) {
    await admin.query("delete from client_refresh_token where client_account_id=$1", [acct]);
  }
  await admin.query("delete from client_refresh_token where client_account_id in (select id from client_account where party_id = any($1::uuid[]))", [createdPartyIds]);
  // work items the client created via /client/requests (source = client party, client_account_id set)
  const submitted = await admin.query(
    "select id from work_item where source_party_id = any($1::uuid[]) or client_account_id = any($2::uuid[])",
    [createdPartyIds, createdAccountIds],
  );
  for (const r of submitted.rows as Array<{ id: string }>) createdWorkItemIds.push(r.id);

  for (const id of Array.from(new Set(createdWorkItemIds))) {
    await admin.query("delete from payment_allocation where payment_id in (select id from payment where org_id=$1) and invoice_line_id in (select il.id from invoice_line il join work_line wl on wl.id=il.work_line_id where wl.work_item_id=$2)", [ORG, id]);
    await admin.query("delete from invoice_line il using work_line wl where il.work_line_id=wl.id and wl.work_item_id=$1", [id]);
    await admin.query("delete from leg where work_item_id=$1", [id]);
    await admin.query("delete from work_line where work_item_id=$1", [id]);
    await admin.query("delete from file_object where id in (select brief_file_id from work_item where id=$1)", [id]);
    await admin.query("delete from work_item where id=$1", [id]);
  }
  // orphaned invoices/payments for the test clients
  for (const p of [clientAParty, clientBParty, ...createdPartyIds]) {
    if (!p) continue;
    await admin.query("delete from payment_allocation pa using payment py where pa.payment_id=py.id and py.counterparty_party_id=$1", [p]);
    await admin.query("delete from invoice_line il using invoice i where il.invoice_id=i.id and i.client_party_id=$1", [p]);
    await admin.query("delete from invoice where client_party_id=$1", [p]);
    await admin.query("delete from payment where counterparty_party_id=$1", [p]);
  }
  await admin.query("delete from client_account where party_id = any($1::uuid[])", [createdPartyIds]);
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

// ─── 1. Plane isolation (critical) ────────────────────────────────────────────

describe("🔴 plane isolation — a token authenticates ONLY its own plane", () => {
  before(async () => {
    clientAToken = (await clientLogin(clientALogin, CLIENT_PASSWORD)).body.accessToken;
    clientBToken = (await clientLogin(clientBLogin, CLIENT_PASSWORD)).body.accessToken;
    assert.ok(clientAToken && clientBToken, "client logins succeed");
  });

  it("🔴 a client token on a BUSINESS endpoint (GET /work) → 401", async () => {
    const res = await api(BASE, "/work", { token: clientAToken });
    assert.equal(res.status, 401, "the business guard rejects a client token (wrong typ)");
  });

  it("🔴 a client token on a PF endpoint (GET /pf/income) → 401", async () => {
    const res = await api(BASE, "/pf/income", { token: clientAToken });
    assert.equal(res.status, 401, "the PF guard rejects a client token (wrong typ)");
  });

  it("🔴 a business (Admin) token on a CLIENT endpoint (GET /client/works) → 401", async () => {
    const res = await api(BASE, "/client/works", { token: adminToken });
    assert.equal(res.status, 401, "the ClientAuthGuard rejects a business token (wrong typ)");
  });

  it("a client with no token on /client/works → 401", async () => {
    const res = await api(BASE, "/client/works", {});
    assert.equal(res.status, 401);
  });
});

// ─── 2. Own-data-only; never the writer cost / margin / doer ─────────────────

describe("🔴 own-data-only — the chain (3000 writer cost) never reaches the client", () => {
  it("GET /client/works shows the client's job with billed/paid/due, NO writer cost", async () => {
    const res = await api(BASE, "/client/works", { token: clientAToken });
    assert.equal(res.status, 200, `works should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    const job = (res.body as Array<any>).find((w) => w.workItemId === chainJobId);
    assert.ok(job, "the client sees their chain job");
    assert.equal(Number(job.amountBilled), 6000, "their own bill");
    assert.equal(Number(job.amountPaid), 4000);
    assert.equal(Number(job.amountDue), 2000);
    // The crux: the 3000 writer cost / margin must not appear anywhere in the body.
    assert.ok(!JSON.stringify(res.body).includes("3000"), "the writer cost (3000) must never reach the client");
    assert.ok(!JSON.stringify(res.body).toLowerCase().includes("writer"), "no writer/doer field leaks");
  });

  it("GET /client/summary returns the client's own AR (billed 6000, paid 4000, due 2000)", async () => {
    const res = await api(BASE, "/client/summary", { token: clientAToken });
    assert.equal(res.status, 200);
    assert.equal(Number(res.body.billed), 6000);
    assert.equal(Number(res.body.paid), 4000);
    assert.equal(Number(res.body.due), 2000);
    assert.ok(!JSON.stringify(res.body).includes("3000"), "no writer cost in the AR summary");
  });

  it("GET /client/auth/me returns the client's own profile only", async () => {
    const res = await api(BASE, "/client/auth/me", { token: clientAToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.loginId, clientALogin);
  });
});

// ─── 3. Draft-not-priced ──────────────────────────────────────────────────────

describe("🔴 a client request lands as a DRAFT — never priced, source forced, ZERO legs", () => {
  let requestId = "";

  it("POST /client/requests → 201 draft", async () => {
    const res = await api(BASE, "/client/requests", { method: "POST", token: clientAToken, body: { title: "Please help with my essay" } });
    assert.equal(res.status, 201, `request should be created (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.workState, "draft", "always a draft");
    requestId = res.body.id as string;
  });

  it("the draft job is work_state=draft, source = the client's OWN party, client_account_id set, ZERO legs", async () => {
    const wi = (await admin.query("select work_state, source_party_id, client_account_id, doer_party_id from work_item where id=$1", [requestId])).rows[0];
    assert.equal(wi.work_state, "draft");
    assert.equal(wi.source_party_id, clientAParty, "source forced to the client's own party");
    assert.equal(wi.client_account_id, clientAAccountId, "provenance marker set");
    assert.equal(wi.doer_party_id, null, "no doer/writer assigned by the client");
    const legCount = Number((await admin.query("select count(*)::int as n from leg where work_item_id=$1", [requestId])).rows[0].n);
    assert.equal(legCount, 0, "a client request creates ZERO legs (never priced)");
  });

  it("🔴 the client cannot forge sourcePartyId/doer/price — the DTO rejects unknown fields at the boundary (400)", async () => {
    // The global ValidationPipe is forbidNonWhitelisted:true → hostile extra fields
    // are REJECTED at the boundary (CLAUDE.md §4), never silently accepted, so the
    // client can never smuggle a source/doer/price/work_state through the request DTO.
    const res = await api(BASE, "/client/requests", {
      method: "POST",
      token: clientAToken,
      body: { title: "Forged", sourcePartyId: clientBParty, doerPartyId: WRITER_PARTY, clientRate: 99999, workState: "confirmed" },
    });
    assert.equal(res.status, 400, "unknown/hostile fields are rejected at the validation boundary");
    // Nothing was created for the forged client B.
    const leaked = Number(
      (await admin.query("select count(*)::int as n from work_item where source_party_id=$1", [clientBParty])).rows[0].n,
    );
    assert.equal(leaked, 0, "no job was created with the forged source party");
  });

  it("🔴 even a clean request forces source to the caller's OWN party (server-side, not client-supplied)", async () => {
    const res = await api(BASE, "/client/requests", { method: "POST", token: clientAToken, body: { title: "Clean request" } });
    assert.equal(res.status, 201);
    const wi = (await admin.query("select source_party_id, client_account_id, work_state from work_item where id=$1", [res.body.id])).rows[0];
    assert.equal(wi.source_party_id, clientAParty, "source is the caller's party, set server-side");
    assert.equal(wi.client_account_id, clientAAccountId);
    assert.equal(wi.work_state, "draft");
  });
});

// ─── 4. Messages ──────────────────────────────────────────────────────────────

describe("messages — client↔admin thread; no cross-client read", () => {
  it("client A posts a message, then sees it in their thread", async () => {
    const send = await api(BASE, "/client/messages", { method: "POST", token: clientAToken, body: { body: "Hello from client A" } });
    assert.equal(send.status, 201, `send should succeed (got ${send.status}: ${JSON.stringify(send.body)})`);
    const list = await api(BASE, "/client/messages", { token: clientAToken });
    assert.equal(list.status, 200);
    assert.ok((list.body as Array<any>).some((m) => m.body === "Hello from client A" && m.sender === "client"));
  });

  it("admin replies (client_portal:create), and client A sees the reply", async () => {
    const reply = await api(BASE, "/client-portal/messages", {
      method: "POST",
      token: adminToken,
      body: { partyId: clientAParty, body: "Admin here, happy to help" },
    });
    assert.equal(reply.status, 201, `admin reply should succeed (got ${reply.status}: ${JSON.stringify(reply.body)})`);
    const list = await api(BASE, "/client/messages", { token: clientAToken });
    assert.ok((list.body as Array<any>).some((m) => m.body === "Admin here, happy to help" && m.sender === "admin"), "the client sees the admin reply");
  });

  it("🔴 client B's thread does NOT contain client A's messages", async () => {
    const list = await api(BASE, "/client/messages", { token: clientBToken });
    assert.equal(list.status, 200);
    assert.ok(!(list.body as Array<any>).some((m) => m.body === "Hello from client A"), "no cross-client thread leak");
    assert.ok(!(list.body as Array<any>).some((m) => m.body === "Admin here, happy to help"), "no cross-client admin reply leak");
  });
});

// ─── 5. Admin provision authz ─────────────────────────────────────────────────

describe("admin provision — client_portal:create gates it; first login flips invited→active", () => {
  let freshParty = "";
  const freshLogin = `fresh+${randomUUID().slice(0, 8)}@cp.test`;

  before(async () => {
    freshParty = await makeParty("CPHTTP Fresh Client", "client");
  });

  it("a Writer (no client_portal) → 403 on POST /client-portal/accounts", async () => {
    const res = await api(BASE, "/client-portal/accounts", {
      method: "POST",
      token: writerOnlyToken,
      body: { partyId: freshParty, loginId: freshLogin, password: CLIENT_PASSWORD },
    });
    assert.equal(res.status, 403, "provisioning requires client_portal:create");
  });

  it("an Admin provisions an 'invited' account; the client logs in → status flips to active", async () => {
    const prov = await api(BASE, "/client-portal/accounts", {
      method: "POST",
      token: adminToken,
      body: { partyId: freshParty, loginId: freshLogin, password: CLIENT_PASSWORD },
    });
    assert.equal(prov.status, 201, `provision should succeed (got ${prov.status}: ${JSON.stringify(prov.body)})`);
    assert.equal(prov.body.status, "invited");
    createdAccountIds.push(prov.body.id as string);

    const before = (await admin.query("select status from client_account where id=$1", [prov.body.id])).rows[0];
    assert.equal(before.status, "invited");

    const li = await clientLogin(freshLogin, CLIENT_PASSWORD);
    assert.equal(li.status, 200, "the invited client can log in");
    const afterRow = (await admin.query("select status from client_account where id=$1", [prov.body.id])).rows[0];
    assert.equal(afterRow.status, "active", "first login promotes invited → active");
  });
});

// ─── 6. Refresh rotation + reuse-detection ────────────────────────────────────

describe("🔴 refresh rotation + reuse-detection", () => {
  it("a fresh login's refresh token rotates; reusing the OLD (rotated) token → 401", async () => {
    const li = await clientLogin(clientALogin, CLIENT_PASSWORD);
    assert.equal(li.status, 200);
    const oldRefresh = li.body.refreshToken as string;

    const r1 = await api(BASE, "/client/auth/refresh", { method: "POST", body: { refreshToken: oldRefresh } });
    assert.equal(r1.status, 200, `first refresh should succeed (got ${r1.status}: ${JSON.stringify(r1.body)})`);
    assert.ok(r1.body.refreshToken && r1.body.refreshToken !== oldRefresh, "the refresh token is rotated");

    // Reusing the now-rotated old token must be rejected (reuse-detection).
    const reuse = await api(BASE, "/client/auth/refresh", { method: "POST", body: { refreshToken: oldRefresh } });
    assert.equal(reuse.status, 401, "a rotated (already-used) refresh token cannot be reused");
  });

  // 🔴 Reuse-detection revokes the WHOLE token family (a stolen-token signal must
  // invalidate every live token, not just the replayed one). The family-revoke +
  // audit run inside the withTenant tx but the callback now RETURNS (commits) and
  // the 401 is thrown OUTSIDE the tx — so the revoke is no longer rolled back.
  // (Earlier this rolled back: the revoke ran then the callback threw the 401,
  // undoing it. Fixed in client-auth.service.ts refresh().) Do not weaken this.
  it("🔴 reuse-detection revokes the WHOLE token family (the live token dies too)", async () => {
    const li = await clientLogin(clientALogin, CLIENT_PASSWORD);
    const t0 = li.body.refreshToken as string;
    const r1 = await api(BASE, "/client/auth/refresh", { method: "POST", body: { refreshToken: t0 } });
    assert.equal(r1.status, 200);
    const t1 = r1.body.refreshToken as string;

    // Reuse the revoked t0 → reuse detected (401), SHOULD revoke t1 too.
    const reuse = await api(BASE, "/client/auth/refresh", { method: "POST", body: { refreshToken: t0 } });
    assert.equal(reuse.status, 401, "reuse of the rotated token is detected");

    // The legitimate live token (t1) must now be dead — a stolen-token reuse must
    // invalidate the whole family, not just the replayed token.
    const afterReuse = await api(BASE, "/client/auth/refresh", { method: "POST", body: { refreshToken: t1 } });
    assert.equal(afterReuse.status, 401, "reuse-detection revokes the whole token family (the live token is invalidated)");
  });
});
