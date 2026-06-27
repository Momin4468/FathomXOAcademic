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
 * Projects / engagements + milestones + milestone templates — BLACK-BOX HTTP
 * tests against the COMPILED app (dist/main.js). Proves the request-time
 * guarantees of the new module:
 *   • template create + ordered items; instantiate-on-create; extend (append)
 *   • milestone tz-deadline → absolute dueAt + urgency; invalid tz → 400
 *   • milestone state machine pending→in_progress→done (adjacent only)
 *   • derived `actual` = Σ billable children's consumer-line client amounts
 *   • money redaction: a Writer (work:view+create, no approve) gets NO `money`
 *   • complete governance: approver firms; a Writer → 403
 *   • boundary validation (empty title, bad enum, non-uuid)
 * Requires FEATURE_WORK=true so the /projects + /work routes mount.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3217; // dedicated test port (auth=3210, reference=3211, work=3212)
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";

const ORG = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // work:view+create, NO approve

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = ""; // System SuperAdmin
let mominToken = ""; // Admin (work:approve)
let writerToken = ""; // a NEW user holding ONLY Writer (work:view+create, no approve)
let writerPartyId = "";

const createdUserIds: string[] = [];
const createdPartyIds: string[] = [];
const createdProjectIds: string[] = [];
const createdTemplateIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT), FEATURE_WORK: "true", FEATURE_REFERENCE: "true" },
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
  const email = `prjuser+${randomUUID()}@fathomxo.test`;
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

before(async () => {
  await admin.connect();
  await startServer();

  const s = await login("sysadmin@fathomxo.local", DEV_PASSWORD);
  assert.equal(s.status, 200, "sysadmin should log in");
  sysToken = s.body.accessToken;

  const m = await login("momin@fathomxo.local", DEV_PASSWORD);
  assert.equal(m.status, 200, "momin should log in");
  mominToken = m.body.accessToken;

  writerPartyId = await makeParty("PRJTEST Writer", "writer");
  ({ token: writerToken } = await makeUserWithRole(WRITER_ROLE, writerPartyId));
});

after(async () => {
  // Children: work_line → leg → work_item, scoped by project.
  for (const id of createdProjectIds) {
    await admin.query(
      "delete from work_line where work_item_id in (select id from work_item where project_id=$1)",
      [id],
    );
    await admin.query(
      "delete from leg where work_item_id in (select id from work_item where project_id=$1)",
      [id],
    );
    await admin.query("delete from work_item where project_id=$1", [id]);
    await admin.query("delete from milestone where project_id=$1", [id]);
    await admin.query("delete from project where id=$1", [id]);
  }
  for (const id of createdTemplateIds) {
    await admin.query("delete from milestone_template_item where template_id=$1", [id]);
    await admin.query("delete from milestone_template where id=$1", [id]);
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

/** Create a template and track it. */
async function createTemplate(name: string): Promise<string> {
  const res = await api(BASE, "/milestone-templates", { method: "POST", token: mominToken, body: { name } });
  assert.equal(res.status, 201, `template create should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
  createdTemplateIds.push(res.body.id);
  return res.body.id as string;
}

/** Create a project (as momin) and track it. */
async function createProject(body: Record<string, unknown>): Promise<string> {
  const res = await api(BASE, "/projects", { method: "POST", token: mominToken, body });
  assert.equal(res.status, 201, `project create should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
  createdProjectIds.push(res.body.id);
  return res.body.id as string;
}

// ─── 1. Template + ordered items ─────────────────────────────────────────────────

describe("milestone templates — create + ordered items (DESIGN_SPEC §5)", () => {
  let templateId = "";

  it("create a template and add items; GET returns items in sort order", async () => {
    templateId = await createTemplate("UWTSD MBA Thesis");
    const items = [
      { title: "Proposal", sort: 1 },
      { title: "Ethics", sort: 2 },
      { title: "Final", sort: 3, billable: true },
    ];
    for (const it of items) {
      const r = await api(BASE, `/milestone-templates/${templateId}/items`, {
        method: "POST",
        token: mominToken,
        body: it,
      });
      assert.equal(r.status, 201, `item add should succeed (got ${r.status}: ${JSON.stringify(r.body)})`);
    }
    const got = await api(BASE, `/milestone-templates/${templateId}`, { token: mominToken });
    assert.equal(got.status, 200);
    const titles = (got.body.items as Array<any>).map((i) => i.title);
    assert.deepEqual(titles, ["Proposal", "Ethics", "Final"], "items returned in sort order");
    const final = (got.body.items as Array<any>).find((i) => i.title === "Final");
    assert.equal(final.billable, true, "the Final item carries billable:true");
  });
});

// ─── 2. Instantiate on create ────────────────────────────────────────────────────

describe("instantiate-on-create — templateId copies items into milestones", () => {
  it("POST /projects {templateId} → milestones match the template items in order, flags copied", async () => {
    const templateId = await createTemplate("Instantiate Template");
    for (const it of [
      { title: "Proposal", sort: 1 },
      { title: "Ethics", sort: 2 },
      { title: "Final", sort: 3, billable: true },
    ]) {
      await api(BASE, `/milestone-templates/${templateId}/items`, { method: "POST", token: mominToken, body: it });
    }
    const projectId = await createProject({ title: "Instantiated Engagement", templateId });
    const detail = await api(BASE, `/projects/${projectId}`, { token: mominToken });
    assert.equal(detail.status, 200);
    const ms = detail.body.milestones as Array<any>;
    assert.deepEqual(ms.map((m) => m.title), ["Proposal", "Ethics", "Final"], "milestones in template order");
    const finalMs = ms.find((m) => m.title === "Final");
    assert.equal(finalMs.billable, true, "billable flag copied onto the instantiated milestone");
  });
});

// ─── 3. Extend (append) ──────────────────────────────────────────────────────────

describe("extend — POST /:id/instantiate appends a template's milestones", () => {
  it("instantiating again grows the milestone count (callable repeatedly)", async () => {
    const templateId = await createTemplate("Extend Template");
    for (const it of [{ title: "A", sort: 1 }, { title: "B", sort: 2 }]) {
      await api(BASE, `/milestone-templates/${templateId}/items`, { method: "POST", token: mominToken, body: it });
    }
    const projectId = await createProject({ title: "Extend Engagement", templateId });
    const before = await api(BASE, `/projects/${projectId}`, { token: mominToken });
    const beforeCount = (before.body.milestones as Array<any>).length;
    assert.equal(beforeCount, 2, "two milestones after instantiate-on-create");

    const ext = await api(BASE, `/projects/${projectId}/instantiate`, {
      method: "POST",
      token: mominToken,
      body: { templateId },
    });
    assert.equal(ext.status, 201, `instantiate should succeed (got ${ext.status}: ${JSON.stringify(ext.body)})`);
    const after = await api(BASE, `/projects/${projectId}`, { token: mominToken });
    assert.equal((after.body.milestones as Array<any>).length, beforeCount + 2, "milestones appended (count grows)");
  });
});

// ─── 4. Milestone with tz deadline + urgency ─────────────────────────────────────

describe("milestone tz-deadline → absolute dueAt + urgency (DESIGN_SPEC §8)", () => {
  let projectId = "";

  before(async () => {
    projectId = await createProject({ title: "Deadline Engagement" });
  });

  it("dueDate+dueTime+dueTz yields a non-null absolute dueAt, the zone, and an urgency object", async () => {
    const res = await api(BASE, `/projects/${projectId}/milestones`, {
      method: "POST",
      token: mominToken,
      body: { title: "Submit", dueDate: "2026-09-01", dueTime: "17:00", dueTz: "Australia/Sydney" },
    });
    assert.equal(res.status, 201, `milestone create should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.ok(res.body.dueAt, "dueAt is a non-null absolute instant");
    assert.ok(!Number.isNaN(Date.parse(res.body.dueAt)), "dueAt parses as a real instant");
    assert.equal(res.body.dueTz, "Australia/Sydney", "the IANA zone is carried");
    assert.ok(res.body.urgency && typeof res.body.urgency === "object", "the milestone carries an urgency object");
  });

  it("an invalid timezone → 400", async () => {
    const res = await api(BASE, `/projects/${projectId}/milestones`, {
      method: "POST",
      token: mominToken,
      body: { title: "Bad TZ", dueDate: "2026-09-01", dueTime: "17:00", dueTz: "Mars/Olympus" },
    });
    assert.equal(res.status, 400, "an invalid tz must be rejected");
  });
});

// ─── 5. Milestone state machine ──────────────────────────────────────────────────

describe("milestone state machine — pending→in_progress→done (adjacent only)", () => {
  let projectId = "";
  let milestoneId = "";

  before(async () => {
    projectId = await createProject({ title: "State Engagement" });
    const m = await api(BASE, `/projects/${projectId}/milestones`, {
      method: "POST",
      token: mominToken,
      body: { title: "Phase" },
    });
    assert.equal(m.status, 201);
    milestoneId = m.body.id;
  });

  it("pending→in_progress is accepted (adjacent forward)", async () => {
    const res = await api(BASE, `/projects/${projectId}/milestones/${milestoneId}/transition`, {
      method: "POST",
      token: mominToken,
      body: { state: "in_progress" },
    });
    assert.equal(res.status, 201, `adjacent transition should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.state, "in_progress");
  });

  it("pending→done (non-adjacent) is rejected with 400", async () => {
    const fresh = await api(BASE, `/projects/${projectId}/milestones`, {
      method: "POST",
      token: mominToken,
      body: { title: "Phase 2" },
    });
    const res = await api(BASE, `/projects/${projectId}/milestones/${fresh.body.id}/transition`, {
      method: "POST",
      token: mominToken,
      body: { state: "done" },
    });
    assert.equal(res.status, 400, "a non-adjacent transition must be rejected");
  });
});

// ─── 6. Children + derived actual ────────────────────────────────────────────────

describe("derived actual — Σ billable children's consumer-line client amounts (§3.3/§4)", () => {
  /** Add a child work item under a project; returns its id. */
  async function addChild(projectId: string, billable: boolean): Promise<string> {
    const res = await api(BASE, "/work", {
      method: "POST",
      token: mominToken,
      body: { title: `PRJTEST Child ${randomUUID().slice(0, 8)}`, projectId, billable },
    });
    assert.equal(res.status, 201, `child create should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    return res.body.id as string;
  }

  /** Add a consumer 'part' line (amount = clientRate × wordCount) to a child. */
  async function addLine(childId: string, clientRate: number, wordCount: number): Promise<void> {
    const res = await api(BASE, `/work/${childId}/lines`, {
      method: "POST",
      token: mominToken,
      body: { lineKind: "part", consumerPartyId: writerPartyId, clientRate, wordCount },
    });
    assert.equal(res.status, 201, `line add should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
  }

  it("actual sums ONLY billable children's lines; estimate is the stored quote", async () => {
    const projectId = await createProject({ title: "Actual Engagement", estimateAmount: 5000 });

    const billableChild = await addChild(projectId, true);
    await addLine(billableChild, 1.5, 4000); // 6000 — should count

    const nonBillableChild = await addChild(projectId, false);
    await addLine(nonBillableChild, 9.99, 1000); // 9990 — must NOT count

    const detail = await api(BASE, `/projects/${projectId}`, { token: mominToken }); // momin holds work:approve
    assert.equal(detail.status, 200);
    assert.ok(detail.body.money, "an approver sees the money block");
    assert.equal(Number(detail.body.money.estimate), 5000, "estimate = the stored quote");
    assert.equal(detail.body.money.actual, 6000, "actual = ONLY the billable child's 4000×1.5");
  });

  it("one-child case: actual equals that single billable child's price", async () => {
    const projectId = await createProject({ title: "One-Child Engagement", estimateAmount: 1000 });
    const child = await addChild(projectId, true);
    await addLine(child, 2.0, 1500); // 3000
    const detail = await api(BASE, `/projects/${projectId}`, { token: mominToken });
    assert.equal(detail.body.money.actual, 3000, "single-billable-child actual = its own price");
  });
});

// ─── 7. Money redaction for a Writer ─────────────────────────────────────────────

describe("money redaction — a Writer (work:view+create, no approve) gets NO money block", () => {
  let projectId = "";

  before(async () => {
    projectId = await createProject({ title: "Redaction Engagement", estimateAmount: 5000 });
    const child = await api(BASE, "/work", {
      method: "POST",
      token: mominToken,
      body: { title: "Redaction Child", projectId, billable: true },
    });
    await api(BASE, `/work/${child.body.id}/lines`, {
      method: "POST",
      token: mominToken,
      body: { lineKind: "part", consumerPartyId: writerPartyId, clientRate: 1.5, wordCount: 4000 },
    });
    // add a milestone so we can prove non-money content is still visible
    await api(BASE, `/projects/${projectId}/milestones`, { method: "POST", token: mominToken, body: { title: "Phase" } });
  });

  it("Writer GET /projects/:id has NO `money` block (no derived actual)", async () => {
    const res = await api(BASE, `/projects/${projectId}`, { token: writerToken });
    assert.equal(res.status, 200, "the Writer can still view the engagement");
    assert.ok(!("money" in res.body), "the money block (derived actual) must be absent for a non-approver");
  });

  it("🔴 Writer GET /projects/:id must NOT leak the client estimate via project.estimateAmount", async () => {
    // The spec gates the estimate behind money-visibility (money.estimate). But the
    // raw `project` row is returned verbatim to every viewer, so the same client
    // quote leaks through project.estimateAmount to a non-money Writer.
    const res = await api(BASE, `/projects/${projectId}`, { token: writerToken });
    assert.equal(
      res.body.project.estimateAmount,
      null,
      "the stored client estimate must not be exposed to a non-approver (it currently is)",
    );
  });

  it("Writer still sees milestones + children (capture-first, money-free)", async () => {
    const res = await api(BASE, `/projects/${projectId}`, { token: writerToken });
    assert.ok((res.body.milestones as Array<any>).length >= 1, "milestones visible");
    assert.ok((res.body.children as Array<any>).length >= 1, "children visible");
    const child = (res.body.children as Array<any>)[0];
    assert.ok("billable" in child && "trackable" in child, "child flags are visible (structure, not money)");
  });

  it("momin (work:approve) DOES get the money block on the same project", async () => {
    const res = await api(BASE, `/projects/${projectId}`, { token: mominToken });
    assert.ok(res.body.money, "an approver sees money");
    assert.equal(res.body.money.actual, 6000);
  });
});

// ─── 8. Complete governance ──────────────────────────────────────────────────────

describe("complete governance — approver firms; a Writer is denied (CLAUDE.md §3.8)", () => {
  it("momin (work:approve) POST /:id/complete → status 'completed', confirmedBy set", async () => {
    const projectId = await createProject({ title: "Complete Engagement" });
    const res = await api(BASE, `/projects/${projectId}/complete`, { method: "POST", token: mominToken });
    assert.equal(res.status, 201, `complete should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.status, "completed", "status is firmed to completed");
    assert.ok(res.body.confirmedBy, "confirmedBy is stamped on the governance step");
  });

  it("a Writer (no work:approve) POST /:id/complete → 403; project stays not-completed", async () => {
    const projectId = await createProject({ title: "Writer-Denied Engagement" });
    const denied = await api(BASE, `/projects/${projectId}/complete`, { method: "POST", token: writerToken });
    assert.equal(denied.status, 403, "completing requires work:approve");
    const detail = await api(BASE, `/projects/${projectId}`, { token: mominToken });
    assert.notEqual(detail.body.project.status, "completed", "an unauthorized complete must not firm the project");
    assert.equal(detail.body.project.confirmedBy, null, "confirmedBy must remain unset");
  });
});

// ─── 9. Boundary validation ──────────────────────────────────────────────────────

describe("boundary validation (treat client input as hostile, CLAUDE.md §4)", () => {
  it("POST /projects with an empty title → 400", async () => {
    const res = await api(BASE, "/projects", { method: "POST", token: mominToken, body: { title: "" } });
    assert.equal(res.status, 400);
  });

  it("a milestone transition to an out-of-enum state → 400", async () => {
    const projectId = await createProject({ title: "Boundary Engagement" });
    const m = await api(BASE, `/projects/${projectId}/milestones`, {
      method: "POST",
      token: mominToken,
      body: { title: "Phase" },
    });
    const res = await api(BASE, `/projects/${projectId}/milestones/${m.body.id}/transition`, {
      method: "POST",
      token: mominToken,
      body: { state: "shipped" },
    });
    assert.equal(res.status, 400, "an out-of-enum milestone state must be rejected");
  });

  it("GET /projects/:id with a non-uuid → 400 (ParseUUIDPipe)", async () => {
    const res = await api(BASE, "/projects/not-a-uuid", { token: mominToken });
    assert.equal(res.status, 400);
  });
});
