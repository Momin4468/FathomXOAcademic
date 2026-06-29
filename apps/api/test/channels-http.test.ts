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
 * Module 17 — Channels + N-way profit-share + writer commission (DESIGN_SPEC
 * §3, §4.4) — BLACK-BOX HTTP tests against the COMPILED app (dist/main.js).
 * Mirrors settlement-http.test.ts (same spawn/login/api harness). Proves the
 * request-time guarantees that must NEVER silently break:
 *   • channel CRUD + controllerName resolution + archive
 *   • 🔴 §4.4 OPACITY GUARD: a default-scoped net-profit dividend to a PARTNER is
 *     rejected (would leak the other partner's margin); the same basis is allowed
 *     when channel-scoped, when 'fixed', or to a non-partner silent investor
 *   • N-way pool view divides the DERIVED pool (revenue − writer cost) correctly
 *   • 🔴 self-view opacity: a sharer sees only their OWN cut; a default net
 *     dividend is aggregate-only (never per-job); a different sharer's /mine differs
 *   • writer commission: fixed (independent of earnings, even at zero), pct, and
 *     once-per-(party,job) idempotency
 * Requires FEATURE_CHANNELS + FEATURE_BILLING + FEATURE_WORK so the three modules
 * mount and PartyService (ReferenceModule) is available.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3219; // dedicated test port (settlement=3218)
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";

const ORG = "00000000-0000-4000-8000-000000000001";
const ADMIN_ROLE = "00000000-0000-4000-8000-0000000000a3"; // channels:* + billing:* + work
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // work only, NO channels/billing
const MOMIN_PARTY = "00000000-0000-4000-8000-0000000000c1";

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = "";
let mominToken = ""; // Admin (channels:approve via role a3), party Momin

const createdUserIds: string[] = [];
const createdPartyIds: string[] = [];
const createdChannelIds: string[] = [];
const createdWorkItemIds: string[] = [];
const createdDealTermIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      FEATURE_CHANNELS: "true",
      FEATURE_BILLING: "true",
      FEATURE_WORK: "true",
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
  const email = `chanuser+${randomUUID()}@fathomxo.test`;
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

/** Insert a profit_share / writer_commission deal_term directly (admin) and track it. */
async function seedDealTerm(opts: {
  fromPartyId: string | null;
  toPartyId: string | null;
  appliesTo?: string;
  termType: string;
  basis?: string | null;
  value: number;
  effectiveFrom?: string;
  effectiveTo?: string | null;
}): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `insert into deal_term (id, org_id, from_party_id, to_party_id, applies_to, term_type, basis, value, effective_from, effective_to)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      ORG,
      opts.fromPartyId,
      opts.toPartyId,
      opts.appliesTo ?? "default",
      opts.termType,
      opts.basis ?? null,
      opts.value,
      opts.effectiveFrom ?? "2020-01-01",
      opts.effectiveTo ?? null,
    ],
  );
  createdDealTermIds.push(id);
  return id;
}

/**
 * Build a job sourced from a channel party with explicit legs (admin). The pool
 * derivation needs work_item.source_party_id (= revenue node) and doer_party_id
 * (= writer cost node); legs supply the amounts. Created at a fixed past date so
 * the profit_share / commission terms (effective 2020) are in effect.
 */
async function buildSourcedJob(opts: {
  sourcePartyId: string;
  doerPartyId: string;
  legs: Array<{ from: string; to: string; amount: number }>;
  createdAt?: string;
}): Promise<string> {
  const jobId = randomUUID();
  await admin.query(
    "insert into work_item (id, org_id, title, source_party_id, doer_party_id, created_at) values ($1,$2,$3,$4,$5,$6)",
    [jobId, ORG, `CHANTEST job ${jobId.slice(0, 8)}`, opts.sourcePartyId, opts.doerPartyId, opts.createdAt ?? "2026-05-01T00:00:00Z"],
  );
  createdWorkItemIds.push(jobId);
  let seq = 1;
  for (const l of opts.legs) {
    await admin.query(
      "insert into leg (id, org_id, work_item_id, seq, from_party_id, to_party_id, amount) values ($1,$2,$3,$4,$5,$6,$7)",
      [randomUUID(), ORG, jobId, seq++, l.from, l.to, l.amount],
    );
  }
  return jobId;
}

before(async () => {
  await admin.connect();
  await startServer();
  sysToken = (await login("sysadmin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  mominToken = (await login("momin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  assert.ok(sysToken && mominToken, "seeded logins succeed");
});

after(async () => {
  for (const id of createdWorkItemIds) {
    await admin.query("delete from charge where work_item_id=$1", [id]);
    await admin.query("delete from leg where work_item_id=$1", [id]);
    await admin.query("delete from work_item where id=$1", [id]);
  }
  for (const id of createdDealTermIds) {
    await admin.query("delete from deal_term where id=$1", [id]);
  }
  for (const id of createdChannelIds) {
    await admin.query("delete from channel where id=$1", [id]);
  }
  // channels created via the API spawn rows we don't track by id — clean any
  // CHANTEST-named channel-party and its channel row.
  await admin.query(
    "delete from channel where party_id in (select id from party where org_id=$1 and display_name like 'CHANTEST%')",
    [ORG],
  );
  for (const id of createdUserIds) {
    await admin.query("delete from audit_log where actor_user_id=$1", [id]);
    await admin.query("delete from auth_refresh_token where user_id=$1", [id]);
    await admin.query("delete from user_role where user_id=$1", [id]);
    await admin.query("delete from user_account where id=$1", [id]);
  }
  await admin.query("delete from party where org_id=$1 and display_name like 'CHANTEST%'", [ORG]);
  for (const id of createdPartyIds) {
    await admin.query("delete from party where id=$1", [id]);
  }
  await admin.end();
  if (server && !server.killed) server.kill();
});

// ─── 1. channel CRUD ──────────────────────────────────────────────────────────

describe("channel list — a controller-LESS channel lists cleanly (no name lookup)", () => {
  // Runs FIRST, before any controller-bearing CHANTEST channel exists, so the
  // partyNames() helper is not invoked — isolating whether the list endpoint
  // itself works vs. only the controllerName-resolution path (the bug below).
  it("GET /channels returns 200 and lists a controller-less channel", async () => {
    const created = await api(BASE, "/channels", {
      method: "POST",
      token: mominToken,
      body: { name: "CHANTEST NoCtrl", medium: "tiktok" },
    });
    assert.equal(created.status, 201, `create should succeed (got ${created.status}: ${JSON.stringify(created.body)})`);
    createdChannelIds.push(created.body.id);
    createdPartyIds.push(created.body.partyId);

    const res = await api(BASE, "/channels", { token: mominToken });
    assert.equal(res.status, 200, `list should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    const row = (res.body as Array<any>).find((c) => c.id === created.body.id);
    assert.ok(row, "the controller-less channel is listed");
    assert.equal(row.medium, "tiktok");
    assert.equal(row.controllerName, null, "no controller → null name");

    // Archive immediately so it does not pollute the controllerName list test below.
    await admin.query("update channel set archived_at=now() where id=$1", [created.body.id]);
  });
});

describe("channel CRUD — create, list (controllerName resolved), patch, archive", () => {
  let channelId = "";
  let partnerCtrl = "";

  before(async () => {
    partnerCtrl = await makeParty("CHANTEST Controller", "partner");
  });

  it("POST /channels creates a Web channel with a controller", async () => {
    const res = await api(BASE, "/channels", {
      method: "POST",
      token: mominToken,
      body: { name: "CHANTEST Web", medium: "web", controllerPartyId: partnerCtrl },
    });
    assert.equal(res.status, 201, `create should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.ok(res.body.id, "returns a channel id");
    assert.ok(res.body.partyId, "returns the channel-as-party id");
    assert.equal(res.body.medium, "web");
    channelId = res.body.id;
    createdChannelIds.push(channelId);
    createdPartyIds.push(res.body.partyId);
  });

  it("🔴 GET /channels resolves controllerName for a channel WITH a controller", async () => {
    // Exercises ChannelsService.partyNames(); see bug note in the final report.
    const res = await api(BASE, "/channels", { token: mominToken });
    assert.equal(res.status, 200, `list should succeed when a controller must be name-resolved (got ${res.status}: ${JSON.stringify(res.body)})`);
    const row = (res.body as Array<any>).find((c) => c.id === channelId);
    assert.ok(row, "the controller-bearing channel is listed");
    assert.equal(row.name, "CHANTEST Web");
    assert.equal(row.controllerPartyId, partnerCtrl);
    assert.equal(row.controllerName, "CHANTEST Controller", "controller party name is resolved");
    assert.equal(row.isActive, true);
  });

  it("PATCH /channels/:id updates medium + isActive (verified at the DB, independent of the list endpoint)", async () => {
    const res = await api(BASE, `/channels/${channelId}`, {
      method: "PATCH",
      token: mominToken,
      body: { medium: "facebook", isActive: false },
    });
    assert.equal(res.status, 200, `patch should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    const r = await admin.query("select medium, is_active from channel where id=$1", [channelId]);
    assert.equal(r.rows[0].medium, "facebook", "medium updated");
    assert.equal(r.rows[0].is_active, false, "isActive updated");
  });

  it("DELETE /channels/:id archives it (archived_at set; verified at the DB)", async () => {
    const res = await api(BASE, `/channels/${channelId}`, { method: "DELETE", token: mominToken });
    assert.equal(res.status, 200, `archive should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    const r = await admin.query("select archived_at from channel where id=$1", [channelId]);
    assert.notEqual(r.rows[0].archived_at, null, "archived_at is set → channel is archived (gone from list)");
  });

  it("a channels-less Writer GET /channels → 403", async () => {
    const { token } = await makeUserWithRole(WRITER_ROLE);
    const res = await api(BASE, "/channels", { token });
    assert.equal(res.status, 403, "viewing channels needs channels:view");
  });
});

// ─── 2. 🔴 §4.4 OPACITY GUARD on profit-share term creation ────────────────────

describe("🔴 §4.4 opacity guard — a default net dividend to a PARTNER is rejected", () => {
  let partner = "";
  let investor = ""; // non-partner silent investor
  let channelParty = "";

  before(async () => {
    partner = await makeParty("CHANTEST Partner", "partner");
    investor = await makeParty("CHANTEST Investor", ""); // party_type {} — no 'partner'
    channelParty = await makeParty("CHANTEST GuardChannel", "channel");
  });

  // This block seeds DEFAULT-scoped profit_share terms, which by design apply to
  // EVERY job. Clean them here so they don't pollute the later pool/self-view
  // blocks' residual (a default dividend correctly applies org-wide).
  after(async () => {
    await admin.query("delete from deal_term where to_party_id = any($1::uuid[])", [[partner, investor]]);
  });

  it("default-scoped pct_of_net to a PARTNER → 400 (would leak the other partner's margin)", async () => {
    const res = await api(BASE, "/channels/profit-shares", {
      method: "POST",
      token: mominToken,
      body: { toPartyId: partner, basis: "pct_of_net", value: 10, effectiveFrom: "2026-01-01" },
    });
    assert.equal(res.status, 400, `must be rejected (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.match(
      JSON.stringify(res.body),
      /partner|margin|fixed|channel-scoped|source/i,
      "the rejection explains the §4.4 leak / the allowed alternatives",
    );
  });

  it("default-scoped pct_after_writer to a PARTNER → 400 (same leak)", async () => {
    const res = await api(BASE, "/channels/profit-shares", {
      method: "POST",
      token: mominToken,
      body: { toPartyId: partner, basis: "pct_after_writer", value: 20, effectiveFrom: "2026-01-01" },
    });
    assert.equal(res.status, 400, `must be rejected (got ${res.status}: ${JSON.stringify(res.body)})`);
  });

  it("the SAME basis but channel-SCOPED (sourcePartyId set) to a partner → ALLOWED", async () => {
    const res = await api(BASE, "/channels/profit-shares", {
      method: "POST",
      token: mominToken,
      body: { toPartyId: partner, basis: "pct_after_writer", value: 40, sourcePartyId: channelParty, effectiveFrom: "2026-01-01" },
    });
    assert.equal(res.status, 201, `channel-scoped share should be allowed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.appliesTo, `source:${channelParty}`, "scoped to the channel");
    createdDealTermIds.push(res.body.id);
  });

  it("a FIXED default-scoped term to a partner → ALLOWED (no margin is back-computable)", async () => {
    const res = await api(BASE, "/channels/profit-shares", {
      method: "POST",
      token: mominToken,
      body: { toPartyId: partner, basis: "fixed", value: 500, effectiveFrom: "2026-01-01" },
    });
    assert.equal(res.status, 201, `fixed default share should be allowed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.appliesTo, "default");
    createdDealTermIds.push(res.body.id);
  });

  it("a default pct_of_net to a NON-partner silent investor → ALLOWED", async () => {
    const res = await api(BASE, "/channels/profit-shares", {
      method: "POST",
      token: mominToken,
      body: { toPartyId: investor, basis: "pct_of_net", value: 10, effectiveFrom: "2026-01-01" },
    });
    assert.equal(res.status, 201, `silent-investor net dividend should be allowed (got ${res.status}: ${JSON.stringify(res.body)})`);
    createdDealTermIds.push(res.body.id);
  });

  it("a channels:view (non-approve) user cannot POST a profit-share term → 403", async () => {
    // role a4 (Manager) has channels:view only. Confirm approve is required.
    const { token } = await makeUserWithRole("00000000-0000-4000-8000-0000000000a4");
    const res = await api(BASE, "/channels/profit-shares", {
      method: "POST",
      token,
      body: { toPartyId: investor, basis: "fixed", value: 1, effectiveFrom: "2026-01-01" },
    });
    assert.equal(res.status, 403, "setting a profit-share term needs channels:approve");
  });
});

// ─── 3. N-way pool view (the §3 worked example) ────────────────────────────────

describe("N-way pool view — pool 3000, ownerPartner 1200, investor 300, residual 1500", () => {
  let webParty = "";
  let ownerPartner = "";
  let investor = "";
  let writer = "";
  let jobId = "";

  before(async () => {
    webParty = await makeParty("CHANTEST PoolWeb", "channel");
    ownerPartner = await makeParty("CHANTEST PoolOwner", "partner");
    investor = await makeParty("CHANTEST PoolInvestor", ""); // non-partner
    writer = await makeParty("CHANTEST PoolWriter", "writer");
    // Job sourced from Web: Web→Momin 6000 (revenue), Momin→Writer 3000 (writer cost).
    jobId = await buildSourcedJob({
      sourcePartyId: webParty,
      doerPartyId: writer,
      legs: [
        { from: webParty, to: MOMIN_PARTY, amount: 6000 },
        { from: MOMIN_PARTY, to: writer, amount: 3000 },
      ],
    });
    // investor: default pct_of_net 10% (= 300); ownerPartner: source:Web pct_after_writer 40% (= 1200).
    await seedDealTerm({ fromPartyId: null, toPartyId: investor, termType: "profit_share", basis: "pct_of_net", value: 10 });
    await seedDealTerm({
      fromPartyId: null,
      toPartyId: ownerPartner,
      appliesTo: `source:${webParty}`,
      termType: "profit_share",
      basis: "pct_after_writer",
      value: 40,
    });
  });

  it("GET /channels/jobs/:id/profit-shares divides the derived pool N-way", async () => {
    const res = await api(BASE, `/channels/jobs/${jobId}/profit-shares`, { token: mominToken });
    assert.equal(res.status, 200, `pool view should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(Number(res.body.pool), 3000, "pool = revenue 6000 − writer cost 3000");
    const byParty = Object.fromEntries((res.body.cuts as Array<any>).map((c) => [c.toPartyId, Number(c.amount)]));
    assert.equal(byParty[ownerPartner], 1200, "ownerPartner: 40% of 3000 (channel-scoped)");
    assert.equal(byParty[investor], 300, "investor: 10% of 3000 net dividend");
    assert.equal(Number(res.body.residual), 1500, "3000 − 1200 − 300 to the business");
    assert.equal(res.body.overAllocated, false);
  });
});

// ─── 4. 🔴 self-view opacity (GET /channels/profit-share/mine) ──────────────────

describe("🔴 self-view opacity — a sharer sees ONLY their own cut", () => {
  let webParty = "";
  let ownerPartner = "";
  let investor = "";
  let writer = "";
  let jobId = "";
  let ownerToken = "";
  let investorToken = "";

  before(async () => {
    webParty = await makeParty("CHANTEST MineWeb", "channel");
    ownerPartner = await makeParty("CHANTEST MineOwner", "partner");
    investor = await makeParty("CHANTEST MineInvestor", ""); // non-partner
    writer = await makeParty("CHANTEST MineWriter", "writer");
    // This job has a UNIQUE date so the investor's default (org-wide) net dividend
    // can be window-bounded to exactly this one job — a default term applies to
    // EVERY org job, so without date isolation the aggregate would sum across the
    // other suites' jobs. (The owner's cut is source-scoped, so already isolated.)
    jobId = await buildSourcedJob({
      sourcePartyId: webParty,
      doerPartyId: writer,
      createdAt: "2026-02-10T00:00:00Z",
      legs: [
        { from: webParty, to: MOMIN_PARTY, amount: 6000 },
        { from: MOMIN_PARTY, to: writer, amount: 3000 },
      ],
    });
    await seedDealTerm({
      fromPartyId: null,
      toPartyId: investor,
      termType: "profit_share",
      basis: "pct_of_net",
      value: 10,
      effectiveFrom: "2026-02-01",
      effectiveTo: "2026-03-01",
    });
    await seedDealTerm({
      fromPartyId: null,
      toPartyId: ownerPartner,
      appliesTo: `source:${webParty}`,
      termType: "profit_share",
      basis: "pct_after_writer",
      value: 40,
    });
    // Users mapped to the sharer parties, holding channels:view (role a3).
    ({ token: ownerToken } = await makeUserWithRole(ADMIN_ROLE, ownerPartner));
    ({ token: investorToken } = await makeUserWithRole(ADMIN_ROLE, investor));
  });

  it("the ownerPartner sees their channel cut per-job (1200, scope=source) and never the 6000 revenue", async () => {
    const res = await api(BASE, "/channels/profit-share/mine", { token: ownerToken });
    assert.equal(res.status, 200, `mine should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(Number(res.body.total), 1200, "owner's own total");
    const share = (res.body.channelShares as Array<any>).find((s) => s.workItemId === jobId);
    assert.ok(share, "the channel-scoped cut is listed per-job");
    assert.equal(Number(share.amount), 1200);
    assert.equal(Number(res.body.dividendTotal), 0, "no default net dividend for the owner");
    assert.ok(!JSON.stringify(res.body).includes("6000"), "the 6000 client revenue must never reach the sharer");
  });

  it("the investor's default net dividend appears ONLY in dividendTotal, never per-job in channelShares", async () => {
    const res = await api(BASE, "/channels/profit-share/mine", { token: investorToken });
    assert.equal(res.status, 200);
    assert.equal(Number(res.body.dividendTotal), 300, "the net dividend is aggregated");
    assert.equal(Number(res.body.total), 300, "investor's own total");
    assert.equal((res.body.channelShares as Array<any>).length, 0, "a default net dividend is NEVER listed per-job (§4.4)");
  });

  it("🔴 the owner's /mine and the investor's /mine differ — neither sees the other's cut", async () => {
    const ownerRes = await api(BASE, "/channels/profit-share/mine", { token: ownerToken });
    const invRes = await api(BASE, "/channels/profit-share/mine", { token: investorToken });
    assert.notEqual(Number(ownerRes.body.total), Number(invRes.body.total), "each sharer sees only their own number");
    // The owner must not see the investor's 300 dividend, and vice-versa.
    assert.equal(Number(ownerRes.body.dividendTotal), 0, "owner sees no foreign net dividend");
    assert.equal((invRes.body.channelShares as Array<any>).length, 0, "investor sees no foreign channel share");
  });
});

// ─── 5. writer commission (POST /settlement/writer-commission) ─────────────────

describe("writer commission — fixed (independent of earnings), pct, idempotent", () => {
  let fixedWriter = "";
  let fixedJob = "";
  let zeroWriter = ""; // a writer with ZERO leg earnings on its job
  let zeroJob = "";
  let pctWriter = "";
  let pctJob = "";
  let srcParty = "";

  before(async () => {
    srcParty = await makeParty("CHANTEST WCSource", "channel");
    fixedWriter = await makeParty("CHANTEST WCFixedWriter", "writer");
    zeroWriter = await makeParty("CHANTEST WCZeroWriter", "writer");
    pctWriter = await makeParty("CHANTEST WCPctWriter", "writer");

    // FIXED writer_commission (global from/to null), value 250, effective before the job.
    await seedDealTerm({ fromPartyId: null, toPartyId: null, termType: "writer_commission", basis: "fixed", value: 250 });

    // fixedJob: the writer earns 3000 — the fixed 250 must apply regardless.
    fixedJob = await buildSourcedJob({
      sourcePartyId: srcParty,
      doerPartyId: fixedWriter,
      legs: [
        { from: srcParty, to: MOMIN_PARTY, amount: 6000 },
        { from: MOMIN_PARTY, to: fixedWriter, amount: 3000 },
      ],
    });

    // zeroJob: zeroWriter is the doer but has NO leg paying them (0 earnings).
    // The fixed 250 must still apply (not rejected for want of earnings).
    zeroJob = await buildSourcedJob({
      sourcePartyId: srcParty,
      doerPartyId: zeroWriter,
      legs: [{ from: srcParty, to: MOMIN_PARTY, amount: 6000 }],
    });
  });

  it("a FIXED writer commission returns the fixed amount (250), independent of earnings", async () => {
    const res = await api(BASE, "/settlement/writer-commission", {
      method: "POST",
      token: mominToken,
      body: { partyId: fixedWriter, workItemId: fixedJob },
    });
    assert.equal(res.status, 201, `apply should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(Number(res.body.amount), 250, "the fixed value, not a % of the 3000 earnings");
  });

  it("a second POST on the same (party, job) → 400 (idempotent)", async () => {
    const res = await api(BASE, "/settlement/writer-commission", {
      method: "POST",
      token: mominToken,
      body: { partyId: fixedWriter, workItemId: fixedJob },
    });
    assert.equal(res.status, 400, "already applied for this party + job");
    assert.match(JSON.stringify(res.body), /already applied/i);
  });

  it("a FIXED commission still applies at ZERO leg earnings (amount = fixed value, not rejected)", async () => {
    const res = await api(BASE, "/settlement/writer-commission", {
      method: "POST",
      token: mominToken,
      body: { partyId: zeroWriter, workItemId: zeroJob },
    });
    assert.equal(res.status, 201, `fixed commission must not be blocked by zero earnings (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(Number(res.body.amount), 250, "the fixed amount applies even with no earnings");
  });

  it("a PCT writer commission = value% × the writer's job earnings (10% × 3000 = 300)", async () => {
    // Distinct party+job to avoid the global-fixed term winning; use a party-scoped
    // pct term that beats the default (most-specific precedence in resolveDealTerm).
    await seedDealTerm({ fromPartyId: pctWriter, toPartyId: pctWriter, termType: "writer_commission", basis: "pct", value: 10 });
    pctJob = await buildSourcedJob({
      sourcePartyId: srcParty,
      doerPartyId: pctWriter,
      legs: [
        { from: srcParty, to: MOMIN_PARTY, amount: 6000 },
        { from: MOMIN_PARTY, to: pctWriter, amount: 3000 },
      ],
    });
    const res = await api(BASE, "/settlement/writer-commission", {
      method: "POST",
      token: mominToken,
      body: { partyId: pctWriter, workItemId: pctJob },
    });
    assert.equal(res.status, 201, `apply should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(Number(res.body.amount), 300, "10% of 3000 leg earnings");
  });

  it("a billing-less Writer cannot POST a writer commission → 403", async () => {
    const { token } = await makeUserWithRole(WRITER_ROLE);
    const res = await api(BASE, "/settlement/writer-commission", {
      method: "POST",
      token,
      body: { partyId: fixedWriter, workItemId: fixedJob },
    });
    assert.equal(res.status, 403, "applying a commission needs billing:create");
  });
});
