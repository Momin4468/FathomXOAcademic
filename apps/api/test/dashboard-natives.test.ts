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
 * Native dashboards / leaderboard (replacing the Metabase embed) — BLACK-BOX HTTP
 * against the COMPILED app. Proves the role-scoped figure LOCK (§4.4/§4.5) that
 * must never break:
 *   • a non-owner (dashboard:view only) gets the VOLUME leaderboard ONLY — no
 *     reputation, no profit/margin keys, and no seeded money figure anywhere;
 *   • an owner (dashboard:approve) gets reputation + profit-per-writer + org net;
 *   • /dashboard/charts owner sections are absent for a non-owner;
 *   • cross-org: an org-B figure/writer never appears for an org-A caller.
 * Requires FEATURE_DASHBOARD + FEATURE_WORK + FEATURE_BILLING.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3252;
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";

const ORG = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // dashboard:view, NO approve

// Distinctive figures so a leak is unmistakable in a JSON.stringify scan.
const REVENUE = 61234; // client -> business
const WRITER_COST = 30987; // business -> writer
const ORGB_FIGURE = 77777; // an org-B leg amount — must never surface for org A

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = ""; // System SuperAdmin (owner via bypass)
let mominToken = ""; // Admin a3 — dashboard:approve (owner)
let writerToken = ""; // dashboard:view only, party-linked (member)

let clientPartyId = "";
let businessPartyId = "";
let writerPartyId = "";
const workItemIds: string[] = [];
const partyIds: string[] = [];
const userIds: string[] = [];
let orgB = "";
let orgBWriterId = "";
let orgBWorkItem = "";

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT), FEATURE_DASHBOARD: "true", FEATURE_WORK: "true", FEATURE_BILLING: "true" },
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

async function makeUserWithRole(roleId: string, partyId?: string): Promise<string> {
  const email = `dash+${randomUUID()}@fathomxo.test`;
  const created = await api(BASE, "/platform/users", { method: "POST", token: sysToken, body: { email, password: DEV_PASSWORD, ...(partyId ? { partyId } : {}) } });
  assert.equal(created.status, 201, `user create (${created.status}: ${JSON.stringify(created.body)})`);
  userIds.push(created.body.id as string);
  const assigned = await api(BASE, `/platform/users/${created.body.id}/roles`, { method: "POST", token: sysToken, body: { roleId } });
  assert.equal(assigned.status, 201);
  const li = await login(email, DEV_PASSWORD);
  assert.equal(li.status, 200);
  return li.body.accessToken as string;
}

async function makeParty(orgId: string, name: string, type: string): Promise<string> {
  const id = randomUUID();
  await admin.query("insert into party (id, org_id, display_name, party_type) values ($1,$2,$3,$4)", [id, orgId, name, `{${type}}`]);
  partyIds.push(id);
  return id;
}

async function makeJobWithChain(orgId: string, source: string, business: string, writer: string, revenue: number, writerCost: number): Promise<string> {
  const wid = randomUUID();
  await admin.query(
    "insert into work_item (id, org_id, title, source_party_id, doer_party_id, work_state) values ($1,$2,$3,$4,$5,'delivered')",
    [wid, orgId, "DASHTEST job", source, writer],
  );
  workItemIds.push(wid);
  await admin.query("insert into leg (id, org_id, work_item_id, seq, from_party_id, to_party_id, amount) values ($1,$2,$3,1,$4,$5,$6)", [randomUUID(), orgId, wid, source, business, revenue]);
  await admin.query("insert into leg (id, org_id, work_item_id, seq, from_party_id, to_party_id, amount) values ($1,$2,$3,2,$4,$5,$6)", [randomUUID(), orgId, wid, business, writer, writerCost]);
  return wid;
}

before(async () => {
  await admin.connect();
  await startServer();
  sysToken = (await login("sysadmin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  mominToken = (await login("momin@fathomxo.local", DEV_PASSWORD)).body.accessToken;

  // Org A priced chain: client -> business (REVENUE), business -> writer (WRITER_COST).
  clientPartyId = await makeParty(ORG, "DASHTEST Client", "client");
  businessPartyId = await makeParty(ORG, "DASHTEST Business", "partner");
  writerPartyId = await makeParty(ORG, "DASHTEST Writer", "writer");
  await makeJobWithChain(ORG, clientPartyId, businessPartyId, writerPartyId, REVENUE, WRITER_COST);
  writerToken = await makeUserWithRole(WRITER_ROLE, writerPartyId);

  // Org B (cross-org): its own org + writer + a job whose figure must never leak.
  orgB = randomUUID();
  await admin.query("insert into org (id, name) values ($1,$2)", [orgB, "DASHTEST OrgB"]);
  const bClient = await makeParty(orgB, "OrgB Client", "client");
  const bBiz = await makeParty(orgB, "OrgB Biz", "partner");
  orgBWriterId = await makeParty(orgB, "OrgB Writer", "writer");
  orgBWorkItem = await makeJobWithChain(orgB, bClient, bBiz, orgBWriterId, ORGB_FIGURE, 11111);
});

after(async () => {
  for (const id of workItemIds) {
    await admin.query("delete from leg where work_item_id=$1", [id]);
    await admin.query("delete from work_item where id=$1", [id]);
  }
  for (const id of userIds) {
    await admin.query("delete from auth_refresh_token where user_id=$1", [id]);
    await admin.query("delete from user_role where user_id=$1", [id]);
    await admin.query("delete from user_account where id=$1", [id]);
  }
  for (const id of partyIds) await admin.query("delete from party where id=$1", [id]);
  if (orgB) await admin.query("delete from org where id=$1", [orgB]);
  await admin.end();
  server?.kill();
});

describe("native dashboards — leaderboard opacity", () => {
  it("owner sees volume + reputation + profit-per-writer (with the money figures)", async () => {
    const res = await api(BASE, "/dashboard/leaderboard", { token: mominToken });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.scope, "owner");
    assert.ok(Array.isArray(res.body.volume), "owner gets the volume board");
    assert.ok(Array.isArray(res.body.reputation), "owner gets reputation");
    assert.ok(Array.isArray(res.body.profitPerWriter), "owner gets profit-per-writer");
    const blob = JSON.stringify(res.body);
    assert.ok(blob.includes(String(REVENUE)), "owner may see the revenue figure");
  });

  it("🔴 a non-owner (dashboard:view) gets VOLUME ONLY — no reputation, no money, no leak", async () => {
    const res = await api(BASE, "/dashboard/leaderboard", { token: writerToken });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.scope, "member");
    assert.ok(Array.isArray(res.body.volume), "a member still gets the volume board");
    assert.equal(res.body.reputation, undefined, "🔴 no reputation key for a non-owner");
    assert.equal(res.body.profitPerWriter, undefined, "🔴 no profit/margin key for a non-owner");
    // The member appears in the volume board (their own party) — names + counts only.
    assert.ok(res.body.volume.some((v: { partyId: string }) => v.partyId === writerPartyId), "the writer is on the volume board");
    // Defence in depth: no money figure of the priced chain leaks anywhere.
    const blob = JSON.stringify(res.body);
    assert.ok(!blob.includes(String(REVENUE)), `🔴 the client price (${REVENUE}) must never reach a non-owner`);
    assert.ok(!blob.includes(String(WRITER_COST)), `🔴 the writer cost (${WRITER_COST}) must never reach a non-owner`);
  });
});

describe("native dashboards — charts opacity", () => {
  it("owner charts carry org net + trend; a non-owner gets scope:'member' only", async () => {
    const owner = await api(BASE, "/dashboard/charts", { token: mominToken });
    assert.equal(owner.status, 200);
    assert.equal(owner.body.scope, "owner");
    assert.ok(owner.body.orgNet && Array.isArray(owner.body.netMonthly), "owner gets org net + monthly trend");

    const member = await api(BASE, "/dashboard/charts", { token: writerToken });
    assert.equal(member.status, 200);
    assert.equal(member.body.scope, "member");
    assert.equal(member.body.orgNet, undefined, "🔴 no org net for a non-owner");
    assert.equal(member.body.netMonthly, undefined, "🔴 no trend for a non-owner");
    assert.equal(member.body.expenseByCategory, undefined, "🔴 no expense breakdown for a non-owner");
    const blob = JSON.stringify(member.body);
    assert.ok(!blob.includes(String(REVENUE)) && !blob.includes(String(WRITER_COST)), "🔴 no money figure leaks to a member's charts");
  });
});

describe("native dashboards — cross-org isolation", () => {
  it("an org-A owner never sees org-B figures or writers (definers filter app_current_org)", async () => {
    for (const path of ["/dashboard/leaderboard", "/dashboard/charts"]) {
      const res = await api(BASE, path, { token: mominToken });
      const blob = JSON.stringify(res.body);
      assert.ok(!blob.includes(String(ORGB_FIGURE)), `🔴 ${path}: org-B figure leaked`);
      assert.ok(!blob.includes(orgBWriterId), `🔴 ${path}: org-B writer leaked`);
    }
  });

  it("the System SuperAdmin gets the owner scope (break-glass)", async () => {
    const res = await api(BASE, "/dashboard/leaderboard", { token: sysToken });
    assert.equal(res.body.scope, "owner");
  });
});

describe("native dashboards — the sole tenant boundary is present (source guard)", () => {
  // The analytics.* views bypass RLS (superuser-owned), so each definer's
  // `where org_id = app_current_org()` is the ONLY tenant scope — there is no RLS
  // backstop (see the migration's ⚠️ comments + DECISIONS 2026-07-09). This guards
  // against a future edit silently dropping that filter: assert the LIVE function
  // body still contains it.
  it("every dashboard_* analytics definer body still filters by app_current_org()", async () => {
    const fns = [
      "dashboard_work_volume",
      "dashboard_writer_reputation",
      "dashboard_org_net",
      "dashboard_expense_totals",
      "dashboard_org_net_monthly",
    ];
    const res = await admin.query("select proname, prosrc from pg_proc where proname = any($1)", [fns]);
    const src = new Map(res.rows.map((r: { proname: string; prosrc: string }) => [r.proname, r.prosrc]));
    for (const fn of fns) {
      const body = src.get(fn);
      assert.ok(body, `${fn} must exist`);
      assert.ok(/app_current_org\(\)/.test(body!), `🔴 ${fn} lost its org filter — the SOLE tenant boundary`);
    }
  });
});
