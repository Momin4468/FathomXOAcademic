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
 * Module 7 (outcomes) — BLACK-BOX HTTP against the COMPILED app (dist/main.js).
 * Proves the request-time guarantees of the new module (DESIGN_SPEC §8):
 *   • record + derived reputation read-model; reputation updates as outcomes land
 *   • NO self-report: a principal cannot record an outcome for their OWN work (403)
 *   • a Writer (outcomes:view only) cannot record (403)
 *   • view-own: a Writer sees only their own reputation/outcomes; another → 403
 *   • duplicate outcome → 409 (one per work item)
 *   • writer card: courseHistory + derived load (open jobs)
 *   • profile edit: own party or admin; another writer's profile → 403
 *   • boundary validation (bad enum, non-uuid)
 * Requires FEATURE_OUTCOMES=true so the /outcomes routes mount.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3219; // dedicated test port (auth=3210 … work=3212, projects=3217)
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";

const ORG = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // outcomes:view only
const MOMIN_PARTY = "00000000-0000-4000-8000-0000000000c1"; // momin is Admin + Writer

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = "";
let mominToken = ""; // Admin (outcomes:create/edit/approve)
let writerToken = ""; // a Writer-role user (outcomes:view only)
let writerPartyId = "";

let courseRefId = "";
const createdUserIds: string[] = [];
const createdPartyIds: string[] = [];
const createdWorkItemIds: string[] = [];
const createdRefIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      FEATURE_OUTCOMES: "true",
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

/** Create a login (sysadmin), link it to a party, assign one role, log it in. */
async function makeUserWithRole(roleId: string, partyId?: string): Promise<{ token: string; userId: string }> {
  const email = `outuser+${randomUUID()}@fathomxo.test`;
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

/** Insert a party directly (admin) so we control its id. */
async function makeParty(name: string, type: string): Promise<string> {
  const id = randomUUID();
  await admin.query(
    "insert into party (id, org_id, display_name, party_type) values ($1,$2,$3,$4)",
    [id, ORG, name, `{${type}}`],
  );
  createdPartyIds.push(id);
  return id;
}

/** Insert a course ref_entity directly (admin). */
async function makeCourse(canonical: string): Promise<string> {
  const id = randomUUID();
  await admin.query(
    "insert into ref_entity (id, org_id, kind, canonical, status) values ($1,$2,'course',$3,'confirmed')",
    [id, ORG, canonical],
  );
  createdRefIds.push(id);
  return id;
}

/** Create a work item via POST /work (as momin) with a given doer + course. */
async function makeWorkItem(doerPartyId: string, opts: Record<string, unknown> = {}): Promise<string> {
  const res = await api(BASE, "/work", {
    method: "POST",
    token: mominToken,
    body: { title: `OUTTEST ${randomUUID().slice(0, 8)}`, doerPartyId, courseRefId, ...opts },
  });
  assert.equal(res.status, 201, `work create should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
  createdWorkItemIds.push(res.body.id);
  return res.body.id as string;
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

  courseRefId = await makeCourse(`OUTTEST Course ${randomUUID().slice(0, 8)}`);
  writerPartyId = await makeParty("OUTTEST Writer", "writer");
  ({ token: writerToken } = await makeUserWithRole(WRITER_ROLE, writerPartyId));
});

after(async () => {
  for (const id of createdWorkItemIds) {
    await admin.query("delete from work_outcome where work_item_id=$1", [id]);
    await admin.query("delete from work_item where id=$1", [id]);
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
  for (const id of createdRefIds) {
    await admin.query("delete from ref_entity where id=$1", [id]);
  }
  await admin.end();
  if (server && !server.killed) server.kill();
});

// ─── 1–3. Record + derived reputation that updates as outcomes land ──────────────

describe("record + derived reputation (DESIGN_SPEC §8)", () => {
  let job1 = "";
  let job2 = "";

  before(async () => {
    job1 = await makeWorkItem(writerPartyId);
    job2 = await makeWorkItem(writerPartyId);
  });

  it("admin POST /outcomes → 201 and reputation reflects the single on-time job", async () => {
    const res = await api(BASE, "/outcomes", {
      method: "POST",
      token: mominToken,
      body: { workItemId: job1, onTime: true, grade: "A", satisfaction: "high", revisionCount: 0 },
    });
    assert.equal(res.status, 201, `record should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);

    const rep = await api(BASE, `/outcomes/reputation/${writerPartyId}`, { token: mominToken });
    assert.equal(rep.status, 200);
    assert.equal(rep.body.reputation.jobCount, 1, "one recorded outcome");
    assert.equal(rep.body.reputation.onTime.rate, 1, "the only job is on time");
    assert.equal(rep.body.reputation.complaint.rate, 0, "no complaints yet");
  });

  it("a second outcome (complaint, late) updates the derived reputation", async () => {
    const res = await api(BASE, "/outcomes", {
      method: "POST",
      token: mominToken,
      body: { workItemId: job2, onTime: false, daysLate: 5, complaint: true, satisfaction: "low" },
    });
    assert.equal(res.status, 201, `second record should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);

    const rep = await api(BASE, `/outcomes/reputation/${writerPartyId}`, { token: mominToken });
    assert.equal(rep.body.reputation.jobCount, 2);
    assert.equal(rep.body.reputation.onTime.rate, 0.5, "1 of 2 on time");
    assert.equal(rep.body.reputation.complaint.rate, 0.5, "1 of 2 complaints");
    assert.equal(rep.body.reputation.avgDaysLate, 5, "one measured late job, 5 days");
  });

  it("a duplicate outcome for an already-recorded work item → 409", async () => {
    const res = await api(BASE, "/outcomes", {
      method: "POST",
      token: mominToken,
      body: { workItemId: job1, onTime: true },
    });
    assert.equal(res.status, 409, "one outcome per work item (edit instead)");
  });
});

// ─── 4. No self-report (momin is Admin AND a Writer, party c1) ───────────────────

describe("🔴 no self-report — cannot record an outcome for your own work", () => {
  it("momin POST /outcomes for a job with doerPartyId = momin's own party → 403", async () => {
    const ownJob = await makeWorkItem(MOMIN_PARTY);
    const res = await api(BASE, "/outcomes", {
      method: "POST",
      token: mominToken,
      body: { workItemId: ownJob, onTime: true },
    });
    assert.equal(res.status, 403, `recording your own outcome must be forbidden (got ${res.status}: ${JSON.stringify(res.body)})`);
  });
});

// ─── 5. A Writer cannot record ───────────────────────────────────────────────────

describe("🔴 a Writer (outcomes:view only) cannot record an outcome", () => {
  it("Writer POST /outcomes → 403", async () => {
    const job = await makeWorkItem(writerPartyId);
    const res = await api(BASE, "/outcomes", {
      method: "POST",
      token: writerToken,
      body: { workItemId: job, onTime: true },
    });
    assert.equal(res.status, 403, "outcomes:create is required to record");
  });
});

// ─── 6. View-own ─────────────────────────────────────────────────────────────────

describe("view-own — a Writer sees only their own reputation/outcomes", () => {
  let otherWriter = "";

  before(async () => {
    otherWriter = await makeParty("OUTTEST Other Writer", "writer");
  });

  it("Writer GET /outcomes/reputation/<self> → 200", async () => {
    const res = await api(BASE, `/outcomes/reputation/${writerPartyId}`, { token: writerToken });
    assert.equal(res.status, 200, "own reputation is visible");
    assert.equal(res.body.partyId, writerPartyId);
  });

  it("Writer GET /outcomes/reputation/<another writer> → 403", async () => {
    const res = await api(BASE, `/outcomes/reputation/${otherWriter}`, { token: writerToken });
    assert.equal(res.status, 403, "a non-admin may not read another writer's reputation");
  });

  it("Writer GET /outcomes?writerPartyId=<another> → 403", async () => {
    const res = await api(BASE, `/outcomes?writerPartyId=${otherWriter}`, { token: writerToken });
    assert.equal(res.status, 403, "a non-admin may not list another writer's outcomes");
  });

  it("Writer GET /outcomes/writers/<self> → 200 (the card)", async () => {
    const res = await api(BASE, `/outcomes/writers/${writerPartyId}`, { token: writerToken });
    assert.equal(res.status, 200, "own card is visible");
    assert.ok(res.body.profile, "card has a profile");
    assert.ok(res.body.reputation, "card has a derived reputation");
    assert.ok(Array.isArray(res.body.courseHistory), "card has courseHistory");
    assert.ok(res.body.load, "card has load");
  });
});

// ─── 8. Course history + load ────────────────────────────────────────────────────

describe("writer card — courseHistory + derived load", () => {
  it("courseHistory shows the shared course with jobCount≥2; load.openJobs counts open work", async () => {
    // job1 + job2 from the first suite already share courseRefId; add no more.
    const res = await api(BASE, `/outcomes/writers/${writerPartyId}`, { token: mominToken });
    assert.equal(res.status, 200);
    const ch = (res.body.courseHistory as Array<any>).find((c) => c.courseRefId === courseRefId);
    assert.ok(ch, "the shared course appears in courseHistory");
    assert.ok(ch.jobCount >= 2, `course jobCount should be ≥2 (got ${ch?.jobCount})`);
    // The writer's open work items (draft/pending/confirmed) — at least the ones we created.
    assert.ok(res.body.load.openJobs >= 2, `openJobs should count the writer's open work (got ${res.body.load.openJobs})`);
  });
});

// ─── 9. Profile edit ─────────────────────────────────────────────────────────────

describe("profile edit — own party or admin", () => {
  it("Writer PATCH /outcomes/writers/<self>/profile → 200, reflected in the card", async () => {
    const res = await api(BASE, `/outcomes/writers/${writerPartyId}/profile`, {
      method: "PATCH",
      token: writerToken,
      body: { expertiseTags: ["Statistics"], availability: "limited", maxConcurrent: 3 },
    });
    assert.equal(res.status, 200, `own profile edit should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    const card = await api(BASE, `/outcomes/writers/${writerPartyId}`, { token: writerToken });
    assert.deepEqual(card.body.profile.expertiseTags, ["Statistics"], "tags reflected");
    assert.equal(card.body.profile.availability, "limited", "availability reflected");
    assert.equal(card.body.profile.maxConcurrent, 3, "maxConcurrent reflected");
  });

  it("Writer PATCH another party's profile → 403", async () => {
    const other = await makeParty("OUTTEST Profile Other", "writer");
    const res = await api(BASE, `/outcomes/writers/${other}/profile`, {
      method: "PATCH",
      token: writerToken,
      body: { availability: "unavailable" },
    });
    assert.equal(res.status, 403, "a non-admin may only edit their own profile");
  });

  it("momin (admin) PATCH any writer's profile → 200", async () => {
    const res = await api(BASE, `/outcomes/writers/${writerPartyId}/profile`, {
      method: "PATCH",
      token: mominToken,
      body: { availability: "available" },
    });
    assert.equal(res.status, 200, "an admin may edit any writer's profile");
  });
});

// ─── 10. Boundary validation ─────────────────────────────────────────────────────

describe("boundary validation (treat client input as hostile, CLAUDE.md §4)", () => {
  it("POST /outcomes with revisionFault out of enum → 400", async () => {
    const job = await makeWorkItem(writerPartyId);
    const res = await api(BASE, "/outcomes", {
      method: "POST",
      token: mominToken,
      body: { workItemId: job, revisionFault: " aliens " },
    });
    assert.equal(res.status, 400, "an out-of-enum revisionFault must be rejected");
  });

  it("POST /outcomes with satisfaction out of enum → 400", async () => {
    const job = await makeWorkItem(writerPartyId);
    const res = await api(BASE, "/outcomes", {
      method: "POST",
      token: mominToken,
      body: { workItemId: job, satisfaction: "ecstatic" },
    });
    assert.equal(res.status, 400, "an out-of-enum satisfaction must be rejected");
  });

  it("GET /outcomes/reputation/:partyId with a non-uuid → 400 (ParseUUIDPipe)", async () => {
    const res = await api(BASE, "/outcomes/reputation/not-a-uuid", { token: mominToken });
    assert.equal(res.status, 400);
  });
});
