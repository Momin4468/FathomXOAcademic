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
 * Module 11 (referrers) — BLACK-BOX HTTP against the COMPILED app (dist/main.js).
 * A referral is "another claimant leg, scoped like any other": an admin attaches
 * a leg business(from=null)→referrer, scoped by the existing leg-visibility RLS so
 * the referrer sees ONLY their own slice. Proves the request-time guarantees:
 *   • SUGGEST correctness: revenue%/margin%/fixed off the real job chain
 *   • ATTACH writes the leg; the referrer's /me shows it, a DIFFERENT referrer's /me does NOT
 *   • 🔴 NO CASCADE: a referral goes to the DIRECT one-hop referrer, never up the graph
 *   • admin reassign (explicit referrerId) + amount override
 *   • dup guard (409) on a second attach for the same (job, referrer)
 *   • manual attach with no agreement creates a one-off term and shows in referrer_works
 *   • 🔴 authz: a Writer (no referrers:approve) is 403 on attach/suggest/terms
 * Requires FEATURE_REFERRERS (routes) + FEATURE_WORK (build the job chain) +
 * FEATURE_REFERENCE (POST /parties). Mirrors checks-http / work-http exactly.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3224; // dedicated test port for the referrers module
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";

const ORG = "00000000-0000-4000-8000-000000000001";
const ADMIN_ROLE = "00000000-0000-4000-8000-0000000000a3"; // referrers: all actions
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // work:view+create, NO referrers:approve
const REFERRER_ROLE = "00000000-0000-4000-8000-0000000000a9"; // referrers:view only
const MOMIN_PARTY = "00000000-0000-4000-8000-0000000000c1";
const EMON_PARTY = "00000000-0000-4000-8000-0000000000c2";

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = ""; // System SuperAdmin — creates users, sees whole chain
let mominToken = ""; // Admin (referrers:approve) + party Momin
let writerToken = ""; // a NEW user holding ONLY Writer (no referrers:approve)
let writerPartyId = ""; // the chain terminal `to` (doer) + the no-approve actor's party
let clientPartyId = ""; // the job source (chain top)

// Referrers + their logins (a9, linked to the referrer party for the /me self-view).
let mujibParty = "";
let siamParty = "";
let mujibToken = "";
let siamToken = "";

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
      FEATURE_REFERRERS: "true",
      FEATURE_WORK: "true",
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

/** Create a login (sysadmin), optionally link a party, assign one role, log it in. */
async function makeUserWithRole(roleId: string, partyId?: string): Promise<{ token: string; userId: string }> {
  const email = `m11user+${randomUUID()}@fathomxo.test`;
  const body: Record<string, unknown> = { email, password: DEV_PASSWORD };
  if (partyId) body.partyId = partyId;
  const created = await api(BASE, "/platform/users", { method: "POST", token: sysToken, body });
  assert.equal(created.status, 201, `user create should succeed (got ${created.status}: ${JSON.stringify(created.body)})`);
  const userId = created.body.id as string;
  createdUserIds.push(userId);
  const assigned = await api(BASE, `/platform/users/${userId}/roles`, {
    method: "POST",
    token: sysToken,
    body: { roleId },
  });
  assert.equal(assigned.status, 201, `role assign should succeed (got ${assigned.status})`);
  const li = await login(email, DEV_PASSWORD);
  assert.equal(li.status, 200, "the new user should log in");
  return { token: li.body.accessToken as string, userId };
}

/** Create a party via the HTTP API (admin) and track it for teardown. */
async function makeParty(name: string, type: string): Promise<string> {
  const res = await api(BASE, "/parties", {
    method: "POST",
    token: mominToken,
    body: { displayName: `${name} ${randomUUID().slice(0, 8)}`, partyType: [type] },
  });
  assert.equal(res.status, 201, `party create should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
  createdPartyIds.push(res.body.id);
  return res.body.id as string;
}

/** Build a job with a KNOWN revenue + writer cost via the leg chain.
 *  revenue = Σ legs FROM source; writer cost = Σ legs TO doer (job_money definer). */
async function buildJob(revenue: number, writerCost: number, source = clientPartyId): Promise<string> {
  const wi = await api(BASE, "/work", {
    method: "POST",
    token: mominToken,
    body: {
      title: `M11TEST Job ${randomUUID().slice(0, 8)}`,
      sourcePartyId: source,
      doerPartyId: writerPartyId,
    },
  });
  assert.equal(wi.status, 201, `work create (got ${wi.status}: ${JSON.stringify(wi.body)})`);
  const workId = wi.body.id as string;
  createdWorkItemIds.push(workId);
  const legs = await api(BASE, `/work/${workId}/legs`, {
    method: "POST",
    token: mominToken,
    body: {
      legs: [
        { seq: 1, fromPartyId: source, toPartyId: MOMIN_PARTY, amount: revenue },
        { seq: 2, fromPartyId: MOMIN_PARTY, toPartyId: writerPartyId, amount: writerCost },
      ],
    },
  });
  assert.equal(legs.status, 201, `build chain (got ${legs.status}: ${JSON.stringify(legs.body)})`);
  return workId;
}

before(async () => {
  await admin.connect();
  await startServer();

  const s = await login("sysadmin@fathomxo.local", DEV_PASSWORD);
  assert.equal(s.status, 200, "sysadmin should log in");
  sysToken = s.body.accessToken;

  const m = await login("momin@fathomxo.local", DEV_PASSWORD);
  assert.equal(m.status, 200, "momin should log in");
  mominToken = m.body.accessToken;

  clientPartyId = await makeParty("M11TEST Client", "client");
  writerPartyId = await makeParty("M11TEST Writer", "writer");
  ({ token: writerToken } = await makeUserWithRole(WRITER_ROLE, writerPartyId));

  // Two referrers, each with a login (a9, linked to the referrer party for /me).
  mujibParty = await makeParty("M11TEST Mujib", "referrer");
  siamParty = await makeParty("M11TEST Siam", "referrer");
  ({ token: mujibToken } = await makeUserWithRole(REFERRER_ROLE, mujibParty));
  ({ token: siamToken } = await makeUserWithRole(REFERRER_ROLE, siamParty));
});

after(async () => {
  for (const id of createdWorkItemIds) {
    await admin.query("delete from leg where work_item_id=$1", [id]);
    await admin.query("delete from work_line where work_item_id=$1", [id]);
    await admin.query("delete from work_item where id=$1", [id]);
  }
  // referral_pct deal_terms created by the tests (standing + one-off) key on a
  // created referrer party (from_party_id). Delete by ALL created parties so the
  // ad-hoc referrers' one-off terms don't trip the FK on party delete.
  if (createdPartyIds.length) {
    await admin.query("delete from deal_term where from_party_id = any($1::uuid[])", [createdPartyIds]);
  }
  for (const id of createdUserIds) {
    await admin.query("delete from audit_log where actor_user_id=$1", [id]);
    await admin.query("delete from auth_refresh_token where user_id=$1", [id]);
    await admin.query("delete from user_role where user_id=$1", [id]);
    await admin.query("delete from user_account where id=$1", [id]);
  }
  // clear any referred_by links pointing at our test parties before deleting parties
  await admin.query("update party set referred_by_party_id = null where referred_by_party_id = any($1::uuid[])", [
    createdPartyIds.length ? createdPartyIds : ["00000000-0000-4000-8000-000000000000"],
  ]);
  for (const id of createdPartyIds) {
    await admin.query("delete from party where id=$1", [id]);
  }
  await admin.end();
  if (server && !server.killed) server.kill();
});

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ─── 1. Setup: agreements per basis ──────────────────────────────────────────────

describe("setup — referrer agreements per basis", () => {
  it("Mujib gets a revenue-basis agreement (10%) → 201", async () => {
    const res = await api(BASE, `/referrers/${mujibParty}/terms`, {
      method: "POST",
      token: mominToken,
      body: { basis: "revenue", value: 10, effectiveFrom: "2020-01-01" },
    });
    assert.equal(res.status, 201, `set terms (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.basis, "revenue");
  });

  it("Siam gets a margin-basis agreement (20%) → 201", async () => {
    const res = await api(BASE, `/referrers/${siamParty}/terms`, {
      method: "POST",
      token: mominToken,
      body: { basis: "margin", value: 20, effectiveFrom: "2020-01-01" },
    });
    assert.equal(res.status, 201, `set terms (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.basis, "margin");
  });

  it("the referrer directory lists both referrers", async () => {
    const res = await api(BASE, "/referrers", { token: mominToken });
    assert.equal(res.status, 200);
    const ids = (res.body as Array<any>).map((r) => r.id);
    assert.ok(ids.includes(mujibParty), "Mujib is listed");
    assert.ok(ids.includes(siamParty), "Siam is listed");
  });
});

// ─── 2. SUGGEST correctness (revenue / margin / fixed) ───────────────────────────

describe("suggest — derived from the real job chain (revenue/margin/fixed)", () => {
  it("revenue basis: 10% of revenue 6000 = 600; revenue/margin match the chain", async () => {
    const job = await buildJob(6000, 3000); // revenue 6000, writer cost 3000 → margin 3000
    const res = await api(BASE, "/referrers/suggest", {
      method: "POST",
      token: mominToken,
      body: { workItemId: job, referrerId: mujibParty },
    });
    assert.equal(res.status, 200, `suggest is @HttpCode(200) (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.revenue, 6000, "revenue derived from legs FROM the source");
    assert.equal(res.body.margin, 3000, "margin = revenue − writer cost (6000 − 3000)");
    assert.equal(res.body.suggestedAmount, round2((6000 * 10) / 100), "10% of revenue = 600");
    assert.equal(res.body.source, "derived");
  });

  it("margin basis: 20% of margin 3000 = 600 (uses margin, not revenue)", async () => {
    const job = await buildJob(6000, 3000);
    const res = await api(BASE, "/referrers/suggest", {
      method: "POST",
      token: mominToken,
      body: { workItemId: job, referrerId: siamParty },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.revenue, 6000);
    assert.equal(res.body.margin, 3000);
    assert.equal(res.body.suggestedAmount, round2((3000 * 20) / 100), "20% of margin (3000) = 600");
  });

  it("fixed basis: the set amount, independent of the job's revenue/margin", async () => {
    const fixedRef = await makeParty("M11TEST FixedRef", "referrer");
    await api(BASE, `/referrers/${fixedRef}/terms`, {
      method: "POST",
      token: mominToken,
      body: { basis: "fixed", value: 750, effectiveFrom: "2020-01-01" },
    });
    const job = await buildJob(6000, 3000);
    const res = await api(BASE, "/referrers/suggest", {
      method: "POST",
      token: mominToken,
      body: { workItemId: job, referrerId: fixedRef },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.suggestedAmount, 750, "fixed basis = the flat agreement amount");
  });
});

// ─── 3. ATTACH writes a leg; referrer self-view; cross-referrer opacity ───────────

describe("🔴 attach writes a leg — own /me shows it, a different referrer's does NOT", () => {
  let job = "";

  before(async () => {
    job = await buildJob(6000, 3000);
    const res = await api(BASE, "/referrers/attach", {
      method: "POST",
      token: mominToken,
      body: { workItemId: job, referrerId: mujibParty },
    });
    assert.equal(res.status, 201, `attach (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.amount, 600, "attached the derived 10%-of-revenue amount");
    assert.equal(res.body.referrerId, mujibParty);
    assert.ok(res.body.legId, "a leg id is returned");
  });

  it("Mujib GET /referrers/me shows the work + the 600 referral amount", async () => {
    const res = await api(BASE, "/referrers/me", { token: mujibToken });
    assert.equal(res.status, 200, `me (got ${res.status}: ${JSON.stringify(res.body)})`);
    const work = (res.body.works as Array<any>).find((w) => w.workItemId === job);
    assert.ok(work, "Mujib's referred work appears in their self-view");
    assert.equal(Number(work.referralAmount), 600, "Mujib sees their OWN referral amount");
  });

  it("🔴 Siam GET /referrers/me does NOT include Mujib's referred work (own-only)", async () => {
    const res = await api(BASE, "/referrers/me", { token: siamToken });
    assert.equal(res.status, 200);
    const leaked = (res.body.works as Array<any>).filter((w) => w.workItemId === job);
    assert.deepEqual(leaked, [], "a different referrer must see ZERO of Mujib's referrals");
  });

  it("🔴 Mujib's /me never reveals the client price (6000) on the referred work", async () => {
    const res = await api(BASE, "/referrers/me", { token: mujibToken });
    const blob = JSON.stringify(res.body);
    assert.ok(!blob.includes("6000"), "the true client price must never reach the referrer");
  });
});

// ─── 4. 🔴 NO CASCADE — the direct one-hop referrer only ─────────────────────────

describe("🔴 no-cascade — the referral goes to the DIRECT referrer, never up the graph", () => {
  it("client referred_by = Siam → a default attach goes to Siam, NOT Mujib", async () => {
    // The client is referred by Siam; Siam is (incorrectly, to test) referred by Mujib.
    const noCascadeClient = await makeParty("M11TEST CascadeClient", "client");
    let res = await api(BASE, `/referrers/clients/${noCascadeClient}`, {
      method: "PUT",
      token: mominToken,
      body: { referrerId: siamParty },
    });
    assert.equal(res.status, 200, `set client referrer (got ${res.status}: ${JSON.stringify(res.body)})`);
    // Make Siam itself referred-by Mujib — to prove the referral does NOT climb to Mujib.
    res = await api(BASE, `/referrers/clients/${siamParty}`, {
      method: "PUT",
      token: mominToken,
      body: { referrerId: mujibParty },
    });
    assert.equal(res.status, 200);

    const job = await buildJob(5000, 2000, noCascadeClient); // source = the cascade client
    const attach = await api(BASE, "/referrers/attach", {
      method: "POST",
      token: mominToken,
      body: { workItemId: job }, // no explicit referrerId → use the client's DIRECT referrer
    });
    assert.equal(attach.status, 201, `default attach (got ${attach.status}: ${JSON.stringify(attach.body)})`);
    assert.equal(attach.body.referrerId, siamParty, "the DIRECT (one-hop) referrer is Siam");

    // Siam's /me shows it; Mujib's /me must NOT (no cascade up the referred-by graph).
    const siamMe = await api(BASE, "/referrers/me", { token: siamToken });
    assert.ok(
      (siamMe.body.works as Array<any>).some((w) => w.workItemId === job),
      "Siam (the direct referrer) sees the referral",
    );
    const mujibMe = await api(BASE, "/referrers/me", { token: mujibToken });
    assert.deepEqual(
      (mujibMe.body.works as Array<any>).filter((w) => w.workItemId === job),
      [],
      "Mujib must NOT receive a cascaded referral from Siam's client",
    );
  });
});

// ─── 5. Admin reassign — explicit referrerId overrides the client default ─────────

describe("admin reassign — explicit referrerId beats the client default", () => {
  it("client default = Siam, but attach with referrerId=Mujib → goes to Mujib", async () => {
    const client = await makeParty("M11TEST ReassignClient", "client");
    await api(BASE, `/referrers/clients/${client}`, {
      method: "PUT",
      token: mominToken,
      body: { referrerId: siamParty },
    });
    const job = await buildJob(4000, 1000, client);
    const attach = await api(BASE, "/referrers/attach", {
      method: "POST",
      token: mominToken,
      body: { workItemId: job, referrerId: mujibParty }, // explicit override
    });
    assert.equal(attach.status, 201, `attach (got ${attach.status}: ${JSON.stringify(attach.body)})`);
    assert.equal(attach.body.referrerId, mujibParty, "the explicit referrer wins over the client default");
  });
});

// ─── 6. Override amount — explicit amount beats the suggestion ────────────────────

describe("override amount — an explicit amount beats the derived suggestion", () => {
  it("Mujib's 10%-of-6000 would suggest 600, but amount:1234 wins", async () => {
    const job = await buildJob(6000, 3000);
    const attach = await api(BASE, "/referrers/attach", {
      method: "POST",
      token: mominToken,
      body: { workItemId: job, referrerId: mujibParty, amount: 1234 },
    });
    assert.equal(attach.status, 201, `override (got ${attach.status}: ${JSON.stringify(attach.body)})`);
    assert.equal(attach.body.amount, 1234, "the explicit amount overrides the suggestion");
  });
});

// ─── 7. Dup guard — a second attach for (job, referrer) → 409 ─────────────────────

describe("dup guard — one live referral per (job, referrer)", () => {
  it("a second attach for the same (job, Mujib) → 409", async () => {
    const job = await buildJob(6000, 3000);
    const first = await api(BASE, "/referrers/attach", {
      method: "POST",
      token: mominToken,
      body: { workItemId: job, referrerId: mujibParty },
    });
    assert.equal(first.status, 201, `first attach (got ${first.status}: ${JSON.stringify(first.body)})`);
    const second = await api(BASE, "/referrers/attach", {
      method: "POST",
      token: mominToken,
      body: { workItemId: job, referrerId: mujibParty },
    });
    assert.equal(second.status, 409, `a duplicate referral must be rejected (got ${second.status}: ${JSON.stringify(second.body)})`);
  });

  it("a SECOND referrer (Siam) on the SAME job is allowed (different beneficiary)", async () => {
    const job = await buildJob(6000, 3000);
    const a1 = await api(BASE, "/referrers/attach", {
      method: "POST",
      token: mominToken,
      body: { workItemId: job, referrerId: mujibParty },
    });
    assert.equal(a1.status, 201);
    const a2 = await api(BASE, "/referrers/attach", {
      method: "POST",
      token: mominToken,
      body: { workItemId: job, referrerId: siamParty },
    });
    assert.equal(a2.status, 201, "a different referrer is a distinct claimant leg, not a duplicate");
  });
});

// ─── 8. Manual attach with no agreement → one-off term, shows in referrer_works ───

describe("manual attach — no agreement, explicit amount creates a one-off referral", () => {
  it("a referrer with NO agreement + amount → 201 and shows in /me", async () => {
    const adhoc = await makeParty("M11TEST AdhocRef", "referrer");
    const { token: adhocToken } = await makeUserWithRole(REFERRER_ROLE, adhoc);
    const job = await buildJob(6000, 3000);
    const attach = await api(BASE, "/referrers/attach", {
      method: "POST",
      token: mominToken,
      body: { workItemId: job, referrerId: adhoc, amount: 321 },
    });
    assert.equal(attach.status, 201, `manual attach (got ${attach.status}: ${JSON.stringify(attach.body)})`);
    assert.equal(attach.body.amount, 321);

    const me = await api(BASE, "/referrers/me", { token: adhocToken });
    assert.equal(me.status, 200);
    const work = (me.body.works as Array<any>).find((w) => w.workItemId === job);
    assert.ok(work, "the one-off referral surfaces in referrer_works");
    assert.equal(Number(work.referralAmount), 321);
  });

  it("a referrer with no agreement and NO amount → 400 (capture stays explicit)", async () => {
    const noTerm = await makeParty("M11TEST NoTermRef", "referrer");
    const job = await buildJob(6000, 3000);
    const attach = await api(BASE, "/referrers/attach", {
      method: "POST",
      token: mominToken,
      body: { workItemId: job, referrerId: noTerm }, // no agreement, no amount
    });
    assert.equal(attach.status, 400, "no derivable suggestion and no amount must be rejected");
  });
});

// ─── 9. 🔴 AUTHZ — a Writer (no referrers:approve) is forbidden ───────────────────

describe("🔴 authz — referrers:approve surfaces are forbidden to a Writer", () => {
  let job = "";
  before(async () => {
    job = await buildJob(6000, 3000);
  });

  it("Writer POST /referrers/attach → 403", async () => {
    const res = await api(BASE, "/referrers/attach", {
      method: "POST",
      token: writerToken,
      body: { workItemId: job, referrerId: mujibParty },
    });
    assert.equal(res.status, 403, "attaching a referral needs referrers:approve");
  });

  it("Writer POST /referrers/suggest → 403", async () => {
    const res = await api(BASE, "/referrers/suggest", {
      method: "POST",
      token: writerToken,
      body: { workItemId: job, referrerId: mujibParty },
    });
    assert.equal(res.status, 403, "the suggestion (sees revenue/margin) needs referrers:approve");
  });

  it("Writer POST /referrers/:id/terms → 403", async () => {
    const res = await api(BASE, `/referrers/${mujibParty}/terms`, {
      method: "POST",
      token: writerToken,
      body: { basis: "revenue", value: 5, effectiveFrom: "2020-01-01" },
    });
    assert.equal(res.status, 403, "managing agreements needs referrers:approve");
  });

  it("🔴 a Writer cannot read another referrer's slice — GET /referrers/me is empty/own-only", async () => {
    // The Writer has no referrers:view → the route is forbidden entirely.
    const res = await api(BASE, "/referrers/me", { token: writerToken });
    assert.equal(res.status, 403, "a Writer has no referrers:view");
  });
});

// ─── 10. Boundary validation ──────────────────────────────────────────────────────

describe("boundary validation — hostile input is rejected", () => {
  it("attach with a non-uuid workItemId → 400", async () => {
    const res = await api(BASE, "/referrers/attach", {
      method: "POST",
      token: mominToken,
      body: { workItemId: "not-a-uuid", referrerId: mujibParty },
    });
    assert.equal(res.status, 400);
  });

  it("set terms with an out-of-enum basis → 400", async () => {
    const res = await api(BASE, `/referrers/${mujibParty}/terms`, {
      method: "POST",
      token: mominToken,
      body: { basis: "bogus", value: 10, effectiveFrom: "2020-01-01" },
    });
    assert.equal(res.status, 400);
  });

  it("set terms with a negative value → 400", async () => {
    const res = await api(BASE, `/referrers/${mujibParty}/terms`, {
      method: "POST",
      token: mominToken,
      body: { basis: "revenue", value: -5, effectiveFrom: "2020-01-01" },
    });
    assert.equal(res.status, 400);
  });
});
