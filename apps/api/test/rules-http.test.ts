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
 * Module 3 (effective-dated rules engine) — BLACK-BOX HTTP tests against the
 * COMPILED app (dist/main.js). Proves the request-time guarantees:
 *   • EFFECTIVE-DATING: a PAST job settles on PAST terms after a renegotiation
 *     (supersede preserves the old row's VALUE, only sets its effective_to)
 *   • PRECEDENCE: most-specific (client > jobtype > default) wins at resolve time
 *   • comp_rule party-specific vs role-level + cost_bearer surfaced
 *   • GOVERNANCE/AUTHZ: a Writer (no rules perm) → 403 on EVERY rules endpoint;
 *     create/supersede write an audit_log row; supersede never deletes the prior
 *   • previewLegs is read-only (writes NO leg)
 *   • merge repoints work_item.course_ref_id / assignment_type_ref_id
 * Requires FEATURE_RULES + FEATURE_WORK + FEATURE_REFERENCE.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3213; // dedicated test port (auth=3210, reference=3211, work=3212)
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";

const ORG = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // NO rules perm
const MOMIN_PARTY = "00000000-0000-4000-8000-0000000000c1";
const EMON_PARTY = "00000000-0000-4000-8000-0000000000c2";

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = "";
let mominToken = ""; // Admin: rules:view/create/edit/approve
let writerToken = ""; // a NEW user holding ONLY Writer (no rules perm)
let writerPartyId = "";
let clientPartyId = "";

const createdUserIds: string[] = [];
const createdPartyIds: string[] = [];
const createdWorkItemIds: string[] = [];
const createdDealTermIds: string[] = [];
const createdCompRuleIds: string[] = [];
const createdRefIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT), FEATURE_RULES: "true", FEATURE_WORK: "true", FEATURE_REFERENCE: "true" },
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
  const email = `m3user+${randomUUID()}@fathomxo.test`;
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
  assert.equal(s.status, 200, "sysadmin should log in");
  sysToken = s.body.accessToken;

  const m = await login("momin@fathomxo.local", DEV_PASSWORD);
  assert.equal(m.status, 200, "momin should log in");
  mominToken = m.body.accessToken;

  clientPartyId = await makeParty("M3TEST Client", "client");
  writerPartyId = await makeParty("M3TEST Writer", "writer");
  ({ token: writerToken } = await makeUserWithRole(WRITER_ROLE, writerPartyId));
});

after(async () => {
  // Kill the server FIRST so its handles release even if a delete fails; then
  // tear down data with each statement guarded (one FK hiccup must not strand
  // the connection and hang the runner).
  if (server && !server.killed) server.kill();
  const del = async (sql: string, params: unknown[]) => {
    try {
      await admin.query(sql, params);
    } catch {
      /* best-effort cleanup */
    }
  };
  for (const id of createdWorkItemIds) {
    await del("delete from leg where work_item_id=$1", [id]);
    await del("delete from work_line where work_item_id=$1", [id]);
    await del("delete from work_item where id=$1", [id]);
  }
  for (const id of createdDealTermIds) await del("delete from deal_term where id=$1", [id]);
  for (const id of createdCompRuleIds) await del("delete from comp_rule where id=$1", [id]);
  // ref_entity may carry merged_into_id FKs to one another → null them before delete.
  for (const id of createdRefIds) await del("delete from ref_alias where ref_id=$1", [id]);
  for (const id of createdRefIds) await del("update ref_entity set merged_into_id=null where merged_into_id=$1", [id]);
  for (const id of createdRefIds) await del("delete from ref_entity where id=$1", [id]);
  for (const id of createdUserIds) {
    await del("delete from audit_log where actor_user_id=$1", [id]);
    await del("delete from auth_refresh_token where user_id=$1", [id]);
    await del("delete from user_role where user_id=$1", [id]);
    await del("delete from user_account where id=$1", [id]);
  }
  for (const id of createdPartyIds) await del("delete from party where id=$1", [id]);
  await admin.end();
});

async function createDealTerm(body: Record<string, unknown>): Promise<any> {
  const res = await api(BASE, "/deal-terms", { method: "POST", token: mominToken, body });
  assert.equal(res.status, 201, `deal-term create should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
  createdDealTermIds.push(res.body.id);
  return res.body;
}

// ─── EFFECTIVE-DATING (the mandatory focus) ──────────────────────────────────

describe("effective-dating — a PAST job settles on PAST terms after a renegotiation", () => {
  const fromP = MOMIN_PARTY;
  let toP = "";
  let v1Id = "";
  let v2Id = "";

  before(async () => {
    toP = await makeParty("M3 Doer A", "writer");
    // v1: per_word 1.0 effective 2026-01-01
    const v1 = await createDealTerm({ fromPartyId: fromP, toPartyId: toP, termType: "per_word", value: 1.0, effectiveFrom: "2026-01-01" });
    v1Id = v1.id;
    // Renegotiate: supersede with 1.5 effective 2026-06-01
    const sup = await api(BASE, "/deal-terms/supersede", { method: "POST", token: mominToken, body: { priorId: v1Id, value: 1.5, effectiveFrom: "2026-06-01" } });
    assert.equal(sup.status, 201, `supersede should succeed (got ${sup.status}: ${JSON.stringify(sup.body)})`);
    v2Id = sup.body.id;
    createdDealTermIds.push(v2Id);
  });

  it("resolve asOf 2026-03-15 (a March job) → 1.0 (the OLD terms)", async () => {
    const res = await api(BASE, `/deal-terms/resolve?fromPartyId=${fromP}&toPartyId=${toP}&termType=per_word&asOf=2026-03-15`, { token: mominToken });
    assert.equal(res.status, 200);
    assert.equal(Number(res.body.resolved?.value), 1.0, "a March job must settle on March's 1.0");
    assert.equal(res.body.resolved?.id, v1Id);
  });

  it("resolve asOf 2026-07-01 (after renegotiation) → 1.5 (the NEW terms)", async () => {
    const res = await api(BASE, `/deal-terms/resolve?fromPartyId=${fromP}&toPartyId=${toP}&termType=per_word&asOf=2026-07-01`, { token: mominToken });
    assert.equal(res.status, 200);
    assert.equal(Number(res.body.resolved?.value), 1.5);
    assert.equal(res.body.resolved?.id, v2Id);
  });

  it("resolve asOf 2025-12-01 (before any version) → null", async () => {
    const res = await api(BASE, `/deal-terms/resolve?fromPartyId=${fromP}&toPartyId=${toP}&termType=per_word&asOf=2025-12-01`, { token: mominToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.resolved, null);
  });

  it("history preserves the OLD row (value unchanged, effective_to now set) + the new row", async () => {
    const res = await api(BASE, `/deal-terms?fromPartyId=${fromP}&toPartyId=${toP}&termType=per_word`, { token: mominToken });
    assert.equal(res.status, 200);
    const rows = res.body as Array<any>;
    const old = rows.find((r) => r.id === v1Id);
    const neu = rows.find((r) => r.id === v2Id);
    assert.ok(old, "the prior version row must still exist (no delete)");
    assert.equal(Number(old.value), 1.0, "the OLD row's value must NOT be mutated by supersede");
    assert.equal(String(old.effectiveTo).slice(0, 10), "2026-06-01", "the old row is closed at the cutover");
    assert.ok(neu, "the new version row must exist");
    assert.equal(Number(neu.value), 1.5);
    assert.equal(neu.effectiveTo, null, "the new row is open-ended");
  });

  it("supersede does NOT delete the prior row — the version COUNT grows", async () => {
    const before = (await api(BASE, `/deal-terms?fromPartyId=${fromP}&toPartyId=${toP}&termType=per_word`, { token: mominToken })).body.length;
    const sup = await api(BASE, "/deal-terms/supersede", { method: "POST", token: mominToken, body: { priorId: v2Id, value: 2.0, effectiveFrom: "2027-01-01" } });
    assert.equal(sup.status, 201);
    createdDealTermIds.push(sup.body.id);
    const afterRows = (await api(BASE, `/deal-terms?fromPartyId=${fromP}&toPartyId=${toP}&termType=per_word`, { token: mominToken })).body;
    assert.equal(afterRows.length, before + 1, "a supersede adds a version, never replaces in place");
    // and the once-open v2 is now closed (not removed)
    const v2 = (afterRows as Array<any>).find((r) => r.id === v2Id);
    assert.equal(String(v2.effectiveTo).slice(0, 10), "2027-01-01");
  });

  it("supersede with an earlier effectiveFrom than the prior is rejected (400)", async () => {
    const res = await api(BASE, "/deal-terms/supersede", { method: "POST", token: mominToken, body: { priorId: v1Id, value: 9, effectiveFrom: "2025-01-01" } });
    assert.equal(res.status, 400, "a new version cannot start before the prior version");
  });
});

// ─── PRECEDENCE (HTTP) ───────────────────────────────────────────────────────

describe("precedence — most-specific (client > jobtype > default) wins at resolve", () => {
  const fromP = MOMIN_PARTY;
  let toP = "";
  let clientP = "";

  before(async () => {
    toP = await makeParty("M3 Doer B", "writer");
    clientP = await makeParty("M3 Client B", "client");
    await createDealTerm({ fromPartyId: fromP, toPartyId: toP, appliesTo: "default", termType: "split_pct", value: 10, effectiveFrom: "2026-01-01" });
    await createDealTerm({ fromPartyId: fromP, toPartyId: toP, appliesTo: "jobtype:essay", termType: "split_pct", value: 20, effectiveFrom: "2026-01-01" });
    await createDealTerm({ fromPartyId: fromP, toPartyId: toP, appliesTo: `client:${clientP}`, termType: "split_pct", value: 30, effectiveFrom: "2026-01-01" });
  });

  it("resolve with the matching clientPartyId → the client value (30)", async () => {
    const res = await api(BASE, `/deal-terms/resolve?fromPartyId=${fromP}&toPartyId=${toP}&termType=split_pct&asOf=2026-03-15&clientPartyId=${clientP}&jobType=essay`, { token: mominToken });
    assert.equal(Number(res.body.resolved?.value), 30);
  });

  it("resolve with only a jobType → the jobtype value (20)", async () => {
    const res = await api(BASE, `/deal-terms/resolve?fromPartyId=${fromP}&toPartyId=${toP}&termType=split_pct&asOf=2026-03-15&jobType=essay`, { token: mominToken });
    assert.equal(Number(res.body.resolved?.value), 20);
  });

  it("resolve with neither → the default value (10)", async () => {
    const res = await api(BASE, `/deal-terms/resolve?fromPartyId=${fromP}&toPartyId=${toP}&termType=split_pct&asOf=2026-03-15`, { token: mominToken });
    assert.equal(Number(res.body.resolved?.value), 10);
  });

  it("a non-matching client falls through to jobtype (an unrelated client rule never leaks)", async () => {
    const otherClient = await makeParty("M3 Client Other", "client");
    const res = await api(BASE, `/deal-terms/resolve?fromPartyId=${fromP}&toPartyId=${toP}&termType=split_pct&asOf=2026-03-15&clientPartyId=${otherClient}&jobType=essay`, { token: mominToken });
    assert.equal(Number(res.body.resolved?.value), 20, "client:X must not match client Y");
  });
});

// ─── comp_rule resolution ────────────────────────────────────────────────────

describe("comp_rule — party-specific beats role-level; cost_bearer returned", () => {
  let partyP = "";

  before(async () => {
    partyP = await makeParty("M3 Comp Party", "writer");
    // Role-level rule on the Writer role.
    const role = await api(BASE, "/comp-rules", { method: "POST", token: mominToken, body: { roleId: WRITER_ROLE, basis: "per_word", rate: 0.4, costBearer: "writer", effectiveFrom: "2026-01-01" } });
    assert.equal(role.status, 201, `role comp-rule create (got ${role.status}: ${JSON.stringify(role.body)})`);
    createdCompRuleIds.push(role.body.id);
    // Party-specific rule, borne by a named partner (0036 party ref).
    const party = await api(BASE, "/comp-rules", { method: "POST", token: mominToken, body: { partyId: partyP, basis: "per_word", rate: 0.6, costBearer: "party", bearerPartyId: MOMIN_PARTY, effectiveFrom: "2026-01-01" } });
    assert.equal(party.status, 201, `party comp-rule create (got ${party.status}: ${JSON.stringify(party.body)})`);
    createdCompRuleIds.push(party.body.id);
  });

  it("resolve with both party + role → the party-specific rule (rate 0.6, cost_bearer party)", async () => {
    const res = await api(BASE, `/comp-rules/resolve?partyId=${partyP}&roleId=${WRITER_ROLE}&asOf=2026-03-15`, { token: mominToken });
    assert.equal(res.status, 200);
    assert.equal(Number(res.body.resolved?.rate), 0.6);
    assert.equal(res.body.resolved?.costBearer, "party", "cost_bearer must be returned");
  });

  it("resolve with only the role → the role-level rule (rate 0.4, cost_bearer writer)", async () => {
    const res = await api(BASE, `/comp-rules/resolve?roleId=${WRITER_ROLE}&asOf=2026-03-15`, { token: mominToken });
    assert.equal(res.status, 200);
    assert.equal(Number(res.body.resolved?.rate), 0.4);
    assert.equal(res.body.resolved?.costBearer, "writer");
  });

  it("a comp rule needs a party or a role → 400 with neither", async () => {
    const res = await api(BASE, "/comp-rules", { method: "POST", token: mominToken, body: { basis: "per_word", rate: 1, costBearer: "writer", effectiveFrom: "2026-01-01" } });
    assert.equal(res.status, 400);
  });
});

// ─── GOVERNANCE / AUTHZ — a Writer (no rules perm) gets 403 everywhere ───────

describe("authz — a Writer (no rules perm) is denied on EVERY rules endpoint", () => {
  let aTermId = "";
  before(async () => {
    const t = await createDealTerm({ fromPartyId: MOMIN_PARTY, toPartyId: EMON_PARTY, termType: "commission_pct", value: 5, effectiveFrom: "2026-01-01" });
    aTermId = t.id;
  });

  const denied = (status: number) => assert.equal(status, 403, `expected 403, got ${status}`);

  it("POST /deal-terms (create) → 403", async () => {
    denied((await api(BASE, "/deal-terms", { method: "POST", token: writerToken, body: { termType: "per_word", value: 1, effectiveFrom: "2026-01-01" } })).status);
  });
  it("GET /deal-terms (view) → 403", async () => {
    denied((await api(BASE, "/deal-terms", { token: writerToken })).status);
  });
  it("GET /deal-terms/resolve (view) → 403", async () => {
    denied((await api(BASE, `/deal-terms/resolve?fromPartyId=${MOMIN_PARTY}&toPartyId=${EMON_PARTY}&termType=per_word&asOf=2026-03-15`, { token: writerToken })).status);
  });
  it("POST /deal-terms/supersede (edit) → 403", async () => {
    denied((await api(BASE, "/deal-terms/supersede", { method: "POST", token: writerToken, body: { priorId: aTermId, value: 9, effectiveFrom: "2026-07-01" } })).status);
  });
  it("POST /comp-rules (create) → 403", async () => {
    denied((await api(BASE, "/comp-rules", { method: "POST", token: writerToken, body: { partyId: MOMIN_PARTY, basis: "per_word", rate: 1, costBearer: "writer", effectiveFrom: "2026-01-01" } })).status);
  });
  it("GET /comp-rules (view) → 403", async () => {
    denied((await api(BASE, "/comp-rules", { token: writerToken })).status);
  });
  it("GET /comp-rules/resolve (view) → 403", async () => {
    denied((await api(BASE, `/comp-rules/resolve?partyId=${MOMIN_PARTY}&asOf=2026-03-15`, { token: writerToken })).status);
  });

  it("the prior term is untouched by the denied supersede (still 5, still open)", async () => {
    const res = await api(BASE, `/deal-terms?fromPartyId=${MOMIN_PARTY}&toPartyId=${EMON_PARTY}&termType=commission_pct`, { token: mominToken });
    const row = (res.body as Array<any>).find((r) => r.id === aTermId);
    assert.equal(Number(row.value), 5);
    assert.equal(row.effectiveTo, null);
  });
});

// ─── AUDIT — create + supersede are recorded immutably ───────────────────────

describe("audit — create and supersede each write an audit_log row", () => {
  it("creating a deal term writes a rules.deal_term_created audit row", async () => {
    const t = await createDealTerm({ fromPartyId: MOMIN_PARTY, toPartyId: EMON_PARTY, termType: "referral_pct", value: 3, effectiveFrom: "2026-02-01" });
    const audit = await admin.query("select count(*)::int n from audit_log where action='rules.deal_term_created' and entity_id=$1", [t.id]);
    assert.ok(audit.rows[0].n >= 1, "deal_term create must be audited");
  });

  it("superseding writes a rules.deal_term_superseded audit row and grows the table count", async () => {
    const t = await createDealTerm({ fromPartyId: MOMIN_PARTY, toPartyId: EMON_PARTY, termType: "referral_pct", value: 4, effectiveFrom: "2026-03-01" });
    const before = (await admin.query("select count(*)::int n from audit_log")).rows[0].n;
    const sup = await api(BASE, "/deal-terms/supersede", { method: "POST", token: mominToken, body: { priorId: t.id, value: 6, effectiveFrom: "2026-09-01" } });
    assert.equal(sup.status, 201);
    createdDealTermIds.push(sup.body.id);
    const after = (await admin.query("select count(*)::int n from audit_log")).rows[0].n;
    assert.ok(after > before, "supersede must append an audit row");
    const row = await admin.query("select count(*)::int n from audit_log where action='rules.deal_term_superseded' and entity_id=$1", [sup.body.id]);
    assert.ok(row.rows[0].n >= 1);
  });
});

// ─── previewLegs — read-only (writes NO leg) ─────────────────────────────────

describe("previewLegs — read-only: resolves terms for a job, writes NO leg", () => {
  let workId = "";

  before(async () => {
    const wi = await api(BASE, "/work", { method: "POST", token: mominToken, body: { title: `M3 Preview ${randomUUID().slice(0, 8)}`, sourcePartyId: MOMIN_PARTY, doerPartyId: EMON_PARTY } });
    assert.equal(wi.status, 201, `work create (got ${wi.status}: ${JSON.stringify(wi.body)})`);
    workId = wi.body.id;
    createdWorkItemIds.push(workId);
    // a per_word term on the source→doer relationship so preview has something to resolve
    await createDealTerm({ fromPartyId: MOMIN_PARTY, toPartyId: EMON_PARTY, termType: "per_word", value: 0.9, effectiveFrom: "2026-01-01" });
  });

  it("GET /rules/preview-legs/:id returns resolved terms and writes NO leg", async () => {
    const legsBefore = (await admin.query("select count(*)::int n from leg where work_item_id=$1", [workId])).rows[0].n;
    const res = await api(BASE, `/rules/preview-legs/${workId}?asOf=2026-03-15`, { token: mominToken });
    assert.equal(res.status, 200, `preview should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(Number(res.body.dealTerms?.per_word?.value), 0.9, "preview resolves the source→doer per_word term");
    const legsAfter = (await admin.query("select count(*)::int n from leg where work_item_id=$1", [workId])).rows[0].n;
    assert.equal(legsAfter, legsBefore, "preview is read-only — leg count must be unchanged");
    assert.equal(legsAfter, 0, "no leg was written");
  });

  it("a Writer (no rules perm) cannot preview → 403", async () => {
    const res = await api(BASE, `/rules/preview-legs/${workId}?asOf=2026-03-15`, { token: writerToken });
    assert.equal(res.status, 403);
  });
});

// ─── boundary validation ─────────────────────────────────────────────────────

describe("boundary validation — hostile/malformed input is rejected", () => {
  it("a deal term with effectiveTo <= effectiveFrom → 400", async () => {
    const res = await api(BASE, "/deal-terms", { method: "POST", token: mominToken, body: { termType: "per_word", value: 1, effectiveFrom: "2026-06-01", effectiveTo: "2026-01-01" } });
    assert.equal(res.status, 400);
  });
  it("an out-of-enum term_type → 400", async () => {
    const res = await api(BASE, "/deal-terms", { method: "POST", token: mominToken, body: { termType: "bogus", value: 1, effectiveFrom: "2026-01-01" } });
    assert.equal(res.status, 400);
  });
  it("a negative value → 400 (Min(0))", async () => {
    const res = await api(BASE, "/deal-terms", { method: "POST", token: mominToken, body: { termType: "per_word", value: -5, effectiveFrom: "2026-01-01" } });
    assert.equal(res.status, 400);
  });
  it("a malformed asOf on resolve → 400 (IsDateString)", async () => {
    const res = await api(BASE, `/deal-terms/resolve?fromPartyId=${MOMIN_PARTY}&toPartyId=${EMON_PARTY}&termType=per_word&asOf=not-a-date`, { token: mominToken });
    assert.equal(res.status, 400);
  });
  it("a non-uuid workItemId on preview → 400 (ParseUUIDPipe)", async () => {
    const res = await api(BASE, "/rules/preview-legs/not-a-uuid", { token: mominToken });
    assert.equal(res.status, 400);
  });
});

// ─── merge repoints work_item ref FKs ────────────────────────────────────────

describe("reference merge repoints work_item.course_ref_id / assignment_type_ref_id", () => {
  let survivorId = "";
  let dupId = "";
  let workId = "";

  before(async () => {
    // Two course ref entities of the same kind (admin-inserted so we control ids).
    survivorId = randomUUID();
    dupId = randomUUID();
    await admin.query("insert into ref_entity (id, org_id, kind, canonical, status) values ($1,$2,'course','ICT 800 Survivor','confirmed')", [survivorId, ORG]);
    await admin.query("insert into ref_entity (id, org_id, kind, canonical, status) values ($1,$2,'course','ICT 800 Dup','confirmed')", [dupId, ORG]);
    createdRefIds.push(survivorId, dupId);
    // A work item pointing at the DUP for both course and assignment-type refs.
    const wi = await api(BASE, "/work", { method: "POST", token: mominToken, body: { title: `M3 Merge ${randomUUID().slice(0, 8)}`, courseRefId: dupId, assignmentTypeRefId: dupId } });
    assert.equal(wi.status, 201, `work create with ref ids (got ${wi.status}: ${JSON.stringify(wi.body)})`);
    workId = wi.body.id;
    createdWorkItemIds.push(workId);
  });

  it("after merge(dup → survivor) the work_item refs point at the survivor", async () => {
    const before = await admin.query("select course_ref_id, assignment_type_ref_id from work_item where id=$1", [workId]);
    assert.equal(before.rows[0].course_ref_id, dupId, "precondition: work item points at the dup");

    const res = await api(BASE, "/reference/merge", { method: "POST", token: mominToken, body: { sourceId: dupId, targetId: survivorId } });
    assert.equal(res.status, 201, `merge should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);

    const after = await admin.query("select course_ref_id, assignment_type_ref_id from work_item where id=$1", [workId]);
    assert.equal(after.rows[0].course_ref_id, survivorId, "course_ref_id repointed to survivor");
    assert.equal(after.rows[0].assignment_type_ref_id, survivorId, "assignment_type_ref_id repointed to survivor");
  });
});
