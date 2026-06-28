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
 * Module 13 (role-scoped dashboards) — BLACK-BOX HTTP tests against the COMPILED
 * app (dist/main.js). Proves the request-time guarantees that must NEVER break:
 *   • the OWNER analytics section (profit-per-writer, client dues, org margin) is
 *     computed correctly from legs + invoices/allocations, derived at read time.
 *   • 🔴 the HEADLINE: a non-owner (no dashboard:approve) gets `balance` +
 *     `openLoops` but NO `owner` section — no cross-writer figure leaks.
 *   • openLoops is self-scoped ("mine") for a non-approver, org-wide ("all") for
 *     an owner.
 *   • a party-linked viewer's `balance.partyId` is their own (self-scope).
 * Requires FEATURE_DASHBOARD + FEATURE_WORK + FEATURE_BILLING + FEATURE_REFERENCE.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3227; // dedicated test port (auth=3210 … billing=3213)
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";

const ORG = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // dashboard:view + work:view, NO approve

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = ""; // System SuperAdmin — owner (isSystemSuperadmin)
let mominToken = ""; // Admin (dashboard:approve) — a non-sysadmin OWNER
let writerToken = ""; // a NEW user holding ONLY Writer (no dashboard:approve) — non-owner
let writerUserPartyId = ""; // the non-owner viewer's own party (self-scope check)

let clientPartyId = ""; // chain top (source/client) — carries the dues
let partnerPartyId = ""; // intermediary
let doerWriterPartyId = ""; // the job's doer (writer) — carries the profit row

const createdUserIds: string[] = [];
const createdPartyIds: string[] = [];
const createdWorkItemIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      FEATURE_DASHBOARD: "true",
      FEATURE_WORK: "true",
      FEATURE_BILLING: "true",
      FEATURE_REFERENCE: "true",
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

/** Create a login (sysadmin), link it to a party, assign one role, log it in. */
async function makeUserWithRole(roleId: string, partyId?: string): Promise<{ token: string; userId: string }> {
  const email = `m13user+${randomUUID()}@fathomxo.test`;
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

before(async () => {
  await admin.connect();
  await startServer();

  const s = await login("sysadmin@fathomxo.local", DEV_PASSWORD);
  assert.equal(s.status, 200);
  sysToken = s.body.accessToken;

  const m = await login("momin@fathomxo.local", DEV_PASSWORD);
  assert.equal(m.status, 200);
  mominToken = m.body.accessToken;

  clientPartyId = await makeParty("M13 Client", "client");
  partnerPartyId = await makeParty("M13 Partner", "partner");
  doerWriterPartyId = await makeParty("M13 Writer", "writer");

  // The non-owner viewer: a fresh user with ONLY the Writer role + its own party.
  writerUserPartyId = await makeParty("M13 ViewerWriter", "writer");
  ({ token: writerToken } = await makeUserWithRole(WRITER_ROLE, writerUserPartyId));
});

after(async () => {
  for (const id of createdWorkItemIds) {
    await admin.query("delete from payment_allocation where invoice_line_id in (select il.id from invoice_line il join work_line wl on wl.id=il.work_line_id where wl.work_item_id=$1)", [id]);
    await admin.query("delete from invoice_line where work_line_id in (select id from work_line where work_item_id=$1)", [id]);
    await admin.query("delete from leg where work_item_id=$1", [id]);
    await admin.query("delete from work_line where work_item_id=$1", [id]);
    await admin.query("delete from work_item where id=$1", [id]);
  }
  for (const id of createdPartyIds) {
    await admin.query("delete from payment_allocation where invoice_line_id in (select il.id from invoice_line il join invoice i on i.id=il.invoice_id where i.client_party_id=$1)", [id]);
    await admin.query("delete from payment_allocation where payment_id in (select id from payment where counterparty_party_id=$1)", [id]);
    await admin.query("delete from payment where counterparty_party_id=$1", [id]);
    await admin.query("delete from leg where to_party_id=$1 or from_party_id=$1", [id]);
    await admin.query("delete from invoice_line where invoice_id in (select id from invoice where client_party_id=$1)", [id]);
    await admin.query("delete from invoice where client_party_id=$1", [id]);
    await admin.query("delete from work_item where source_party_id=$1 or doer_party_id=$1", [id]);
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

/**
 * Build the canonical owner-dashboard fixture as momin (Admin, work:approve +
 * billing:create):
 *   • work item: source = client, doer = the writer
 *   • legs: client→partner 6000 (revenue) + partner→writer 4000 (writer_cost)
 *   • client invoice 6000, partial payment 2000 allocated → due 4000
 * Returns the work id.
 */
async function buildOwnerFixture(): Promise<string> {
  const work = await api(BASE, "/work", {
    method: "POST",
    token: mominToken,
    body: { title: `M13 Job ${randomUUID().slice(0, 8)}`, sourcePartyId: clientPartyId, doerPartyId: doerWriterPartyId },
  });
  assert.equal(work.status, 201, `work create should succeed (got ${work.status}: ${JSON.stringify(work.body)})`);
  const workId = work.body.id as string;
  createdWorkItemIds.push(workId);

  const legs = await api(BASE, `/work/${workId}/legs`, {
    method: "POST",
    token: mominToken,
    body: {
      legs: [
        { seq: 1, fromPartyId: clientPartyId, toPartyId: partnerPartyId, amount: 6000 }, // revenue
        { seq: 2, fromPartyId: partnerPartyId, toPartyId: doerWriterPartyId, amount: 4000 }, // writer cost
      ],
    },
  });
  assert.equal(legs.status, 201, `append legs should succeed (got ${legs.status}: ${JSON.stringify(legs.body)})`);

  // Billable client line → open invoice → partial allocation.
  const line = await api(BASE, `/work/${workId}/lines`, {
    method: "POST",
    token: mominToken,
    body: { lineKind: "copy", consumerPartyId: clientPartyId, fixedAmount: 6000 },
  });
  assert.equal(line.status, 201, `add line should succeed (got ${line.status}: ${JSON.stringify(line.body)})`);
  const attach = await api(BASE, "/invoices/attach-line", { method: "POST", token: mominToken, body: { workLineId: line.body.id } });
  assert.equal(attach.status, 201, `attach-line should succeed (got ${attach.status}: ${JSON.stringify(attach.body)})`);
  const invoiceLineId = attach.body.id as string;

  const pay = await api(BASE, "/payments", { method: "POST", token: mominToken, body: { direction: "in", amount: 2000, paidAt: "2026-06-01", counterpartyPartyId: clientPartyId } });
  assert.equal(pay.status, 201, `record payment should succeed (got ${pay.status}: ${JSON.stringify(pay.body)})`);
  const alloc = await api(BASE, `/payments/${pay.body.id}/allocate`, { method: "POST", token: mominToken, body: { items: [{ invoiceLineId, amount: 2000 }] } });
  assert.equal(alloc.status, 201, `allocate should succeed (got ${alloc.status}: ${JSON.stringify(alloc.body)})`);

  return workId;
}

const approx = (got: number, want: number, msg: string) =>
  assert.ok(Math.abs(got - want) < 0.01, `${msg} (got ${got}, want ≈${want})`);

// ─── Owner analytics section (the headline figures) ──────────────────────────────

describe("owner dashboard — profit-per-writer + client dues + org margin", () => {
  before(async () => {
    await buildOwnerFixture();
  });

  for (const who of ["sysadmin (System SuperAdmin)", "momin (Admin with dashboard:approve)"] as const) {
    it(`${who} GET /dashboard returns an owner section with the right figures`, async () => {
      const token = who.startsWith("sysadmin") ? sysToken : mominToken;
      const res = await api(BASE, "/dashboard", { token });
      assert.equal(res.status, 200, `dashboard should load (got ${res.status}: ${JSON.stringify(res.body)})`);
      assert.ok(res.body.owner, "an owner viewer gets the owner analytics section");

      const owner = res.body.owner;
      // profit-per-writer: our doer writer has revenue 6000, cost 4000, profit 2000.
      const w = (owner.profitPerWriter as Array<any>).find((r) => r.writerPartyId === doerWriterPartyId);
      assert.ok(w, "the job's doer appears in profitPerWriter");
      approx(Number(w.revenue), 6000, "profitPerWriter.revenue");
      approx(Number(w.writerCost), 4000, "profitPerWriter.writerCost");
      approx(Number(w.profit), 2000, "profitPerWriter.profit = revenue − writerCost");

      // client dues: our client has invoiced 6000, paid 2000, due 4000.
      const d = (owner.duesByClient as Array<any>).find((r) => r.clientPartyId === clientPartyId);
      assert.ok(d, "the client appears in duesByClient");
      approx(Number(d.invoiced), 6000, "duesByClient.invoiced");
      approx(Number(d.paid), 2000, "duesByClient.paid");
      approx(Number(d.due), 4000, "duesByClient.due = invoiced − paid");

      // org-wide rollups INCLUDE our contribution (other org data may add more).
      assert.ok(Number(owner.outstandingDuesTotal) >= 4000 - 0.01, "outstandingDuesTotal ≥ our 4000");
      assert.ok(Number(owner.orgMargin.margin) >= 2000 - 0.01, "orgMargin.margin ≥ our 2000");
      // orgMargin.margin must equal revenue − writerCost (derived consistency).
      approx(Number(owner.orgMargin.margin), Number(owner.orgMargin.revenue) - Number(owner.orgMargin.writerCost), "orgMargin.margin = revenue − writerCost");
      // pendingClientCount = number of clients with an outstanding due.
      assert.equal(Number(owner.pendingClientCount), (owner.duesByClient as Array<any>).length, "pendingClientCount = #duesByClient");
    });
  }

  it("an isolated owner fixture yields EXACTLY due=4000 / margin=2000 on its own client+writer", async () => {
    // Re-read and pin the per-row figures (immune to other org data, unlike totals).
    const res = await api(BASE, "/dashboard", { token: sysToken });
    const w = (res.body.owner.profitPerWriter as Array<any>).find((r) => r.writerPartyId === doerWriterPartyId);
    const d = (res.body.owner.duesByClient as Array<any>).find((r) => r.clientPartyId === clientPartyId);
    approx(Number(w.profit), 2000, "per-writer profit pinned at 2000");
    approx(Number(d.due), 4000, "per-client due pinned at 4000");
  });
});

// ─── 🔴 the headline: a non-owner gets NO owner section ──────────────────────────

describe("🔴 a non-owner (no dashboard:approve) gets NO owner section", () => {
  it("a plain Writer GET /dashboard has balance + openLoops but owner === undefined", async () => {
    const res = await api(BASE, "/dashboard", { token: writerToken });
    assert.equal(res.status, 200, "any authenticated viewer gets their own dashboard");
    assert.ok(res.body.balance !== undefined, "a viewer gets their own balance");
    assert.ok(res.body.openLoops, "a viewer gets their open-loop count");
    assert.equal(res.body.owner, undefined, "🔴 a non-owner must NOT receive the owner analytics section");
    // Defence in depth: no cross-writer figure may appear ANYWHERE in the payload.
    const blob = JSON.stringify(res.body);
    assert.ok(!/profitPerWriter|duesByClient|orgMargin|outstandingDuesTotal/.test(blob), `no owner-only key may leak to a non-owner: ${blob}`);
  });
});

// ─── openLoops scope ─────────────────────────────────────────────────────────────

describe("openLoops scope — self for a non-approver, org-wide for an owner", () => {
  it("an owner's openLoops.scope === 'all'", async () => {
    const res = await api(BASE, "/dashboard", { token: sysToken });
    assert.equal(res.body.openLoops.scope, "all", "an owner counts all open loops org-wide");
  });

  it("a writer's openLoops.scope === 'mine' and counts ONLY their doer jobs", async () => {
    // Baseline for this writer (should be 0 — no doer jobs yet).
    let res = await api(BASE, "/dashboard", { token: writerToken });
    assert.equal(res.body.openLoops.scope, "mine", "a non-approver is self-scoped");
    const before = Number(res.body.openLoops.count);

    // Give the writer ONE open (unsettled/undelivered) doer job.
    const work = await api(BASE, "/work", { method: "POST", token: mominToken, body: { title: `M13 WriterJob ${randomUUID().slice(0, 8)}`, doerPartyId: writerUserPartyId } });
    assert.equal(work.status, 201);
    createdWorkItemIds.push(work.body.id);

    res = await api(BASE, "/dashboard", { token: writerToken });
    assert.equal(res.body.openLoops.scope, "mine");
    assert.equal(Number(res.body.openLoops.count), before + 1, "the writer's open-loop count rises by exactly their one new doer job");
  });
});

// ─── balance self-scope ──────────────────────────────────────────────────────────

describe("balance self-scope — a party-linked viewer's balance is their OWN party", () => {
  it("a writer viewer's balance.partyId === their own party id", async () => {
    const res = await api(BASE, "/dashboard", { token: writerToken });
    assert.ok(res.body.balance, "a party-linked viewer has a balance");
    assert.equal(res.body.balance.partyId, writerUserPartyId, "balance is self-scoped to the viewer's party");
  });
});
