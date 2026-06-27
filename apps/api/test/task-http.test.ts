import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { config } from "dotenv";
import pg from "pg";
import { instantToZoned, urgency, zonedWallToInstant } from "@business-os/shared";
import { api, waitForHealth } from "./helpers.js";

/**
 * Module 6 (task board) — BLACK-BOX HTTP tests against the COMPILED app
 * (dist/main.js). Proves the deadline + capture-first contract (DESIGN_SPEC §8):
 *   • create with dueDate+dueTime+dueTz stores the CORRECT absolute due_at + due_tz
 *     (DST-correct, round-trips back to the original wall clock);
 *   • urgency bucket is computed (future=later, past=overdue, ~now+1h=soon);
 *   • complete → state=done + completed_at; ?state=open excludes done;
 *   • ?mine=true returns only the caller's assigned tasks;
 *   • a Writer (capture:create) CAN create a task; a valid flow never errors.
 * Requires FEATURE_CAPTURE=true so /tasks mounts.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3217; // dedicated test port
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";

const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // capture view+create, NO edit
const MOMIN_PARTY = "00000000-0000-4000-8000-0000000000c1";
const EMON_PARTY = "00000000-0000-4000-8000-0000000000c2";

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = "";
let mominToken = "";
let writerToken = "";

const createdUserIds: string[] = [];
const createdTaskIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT), FEATURE_CAPTURE: "true" },
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
  const email = `m6task+${randomUUID()}@fathomxo.test`;
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

async function createTask(body: Record<string, unknown>, token = mominToken) {
  const res = await api(BASE, "/tasks", { method: "POST", token, body });
  if (res.status === 201 && res.body?.id) createdTaskIds.push(res.body.id);
  return res;
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

  // Writer-only login: capture:view+create, NO capture:edit.
  ({ token: writerToken } = await makeUserWithRole(WRITER_ROLE));
});

after(async () => {
  for (const id of createdTaskIds) {
    await admin.query("delete from audit_log where entity='task' and entity_id=$1", [id]);
    await admin.query("delete from task where id=$1", [id]);
  }
  for (const id of createdUserIds) {
    await admin.query("delete from audit_log where actor_user_id=$1", [id]);
    await admin.query("delete from auth_refresh_token where user_id=$1", [id]);
    await admin.query("delete from user_role where user_id=$1", [id]);
    await admin.query("delete from user_account where id=$1", [id]);
  }
  await admin.end();
  if (server && !server.killed) server.kill();
});

// ─── tz-aware deadline: absolute instant + zone, DST-correct ───────────────────────

describe("tz-aware deadline — due_at is the correct absolute instant + due_tz stored", () => {
  it("dueDate+dueTime+dueTz (Sydney winter) → due_at = the correct UTC instant", async () => {
    const res = await createTask({
      title: "Sydney winter deadline",
      dueDate: "2027-07-01",
      dueTime: "17:00",
      dueTz: "Australia/Sydney",
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    // 17:00 AEST (UTC+10, no DST in July) = 07:00Z.
    assert.equal(new Date(res.body.dueAt).toISOString(), "2027-07-01T07:00:00.000Z");
    assert.equal(res.body.dueTz, "Australia/Sydney", "the zone it was set in is retained");
  });

  it("DST is honoured: Sydney summer 17:00 → 06:00Z (UTC+11), not 07:00Z", async () => {
    const res = await createTask({
      title: "Sydney summer deadline",
      dueDate: "2027-01-15",
      dueTime: "17:00",
      dueTz: "Australia/Sydney",
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(new Date(res.body.dueAt).toISOString(), "2027-01-15T06:00:00.000Z");
  });

  it("the stored instant round-trips back to the original wall clock in its zone", async () => {
    const res = await createTask({
      title: "London BST deadline",
      dueDate: "2027-07-15",
      dueTime: "09:00",
      dueTz: "Europe/London",
    });
    assert.equal(res.status, 201);
    // Independently recompute and round-trip via the shared helpers.
    assert.equal(new Date(res.body.dueAt).toISOString(), zonedWallToInstant("2027-07-15", "09:00", "Europe/London"));
    assert.deepEqual(instantToZoned(new Date(res.body.dueAt).toISOString(), "Europe/London"), {
      date: "2027-07-15",
      time: "09:00",
    });
  });

  it("a precomputed absolute dueAt is stored verbatim", async () => {
    const res = await createTask({ title: "absolute", dueAt: "2027-03-03T03:03:00.000Z", dueTz: "UTC" });
    assert.equal(res.status, 201);
    assert.equal(new Date(res.body.dueAt).toISOString(), "2027-03-03T03:03:00.000Z");
  });
});

// ─── computed urgency ──────────────────────────────────────────────────────────────

describe("computed urgency bucket (derived from due_at, never stored)", () => {
  it("far future → later", async () => {
    const res = await createTask({ title: "future", dueAt: "2099-01-01T00:00:00.000Z", dueTz: "UTC" });
    assert.equal(res.status, 201);
    assert.equal(res.body.urgency.bucket, "later");
    assert.equal(res.body.urgency.overdue, false);
  });

  it("past → overdue", async () => {
    const res = await createTask({ title: "past", dueAt: "2000-01-01T00:00:00.000Z", dueTz: "UTC" });
    assert.equal(res.status, 201);
    assert.equal(res.body.urgency.bucket, "overdue");
    assert.equal(res.body.urgency.overdue, true);
  });

  it("~now+1h → soon (within 24h)", async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await createTask({ title: "soon", dueAt: soon, dueTz: "UTC" });
    assert.equal(res.status, 201);
    assert.equal(res.body.urgency.bucket, "soon");
    // Cross-check against the shared pure fn with the same instant.
    assert.equal(urgency(soon).bucket, "soon");
  });

  it("no deadline → none (empty state, never errors)", async () => {
    const res = await createTask({ title: "no deadline" });
    assert.equal(res.status, 201);
    assert.equal(res.body.urgency.bucket, "none");
    assert.equal(res.body.dueAt, null);
  });
});

// ─── complete + state filters ──────────────────────────────────────────────────────

describe("complete → done + completed_at; ?state filters", () => {
  it("complete sets state=done and stamps completed_at", async () => {
    const created = await createTask({ title: "to be done" });
    const res = await api(BASE, `/tasks/${created.body.id}/complete`, { method: "POST", token: mominToken });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.state, "done");
    assert.ok(res.body.completedAt, "completed_at must be stamped");
  });

  it("?state=open excludes done tasks; ?state=done includes them", async () => {
    const open = await createTask({ title: `open ${randomUUID().slice(0, 6)}` });
    const done = await createTask({ title: `done ${randomUUID().slice(0, 6)}` });
    await api(BASE, `/tasks/${done.body.id}/complete`, { method: "POST", token: mominToken });

    const openList = await api(BASE, "/tasks?state=open", { token: mominToken });
    assert.equal(openList.status, 200);
    const openIds = (openList.body as Array<any>).map((t) => t.id);
    assert.ok(openIds.includes(open.body.id), "the open task is in ?state=open");
    assert.ok(!openIds.includes(done.body.id), "a done task is excluded from ?state=open");

    const doneList = await api(BASE, "/tasks?state=done", { token: mominToken });
    const doneIds = (doneList.body as Array<any>).map((t) => t.id);
    assert.ok(doneIds.includes(done.body.id), "the done task is in ?state=done");
  });
});

// ─── ?mine=true ────────────────────────────────────────────────────────────────────

describe("?mine=true returns only the caller's assigned tasks", () => {
  it("momin?mine=true sees a task assigned to his party, not one assigned to Emon", async () => {
    const mine = await createTask({ title: `mine ${randomUUID().slice(0, 6)}`, assigneePartyId: MOMIN_PARTY });
    const theirs = await createTask({ title: `emon ${randomUUID().slice(0, 6)}`, assigneePartyId: EMON_PARTY });

    const res = await api(BASE, "/tasks?mine=true", { token: mominToken });
    assert.equal(res.status, 200);
    const ids = (res.body as Array<any>).map((t) => t.id);
    assert.ok(ids.includes(mine.body.id), "a task assigned to me appears");
    assert.ok(!ids.includes(theirs.body.id), "a task assigned to Emon must NOT appear under mine=true");
    for (const t of res.body as Array<any>) {
      assert.equal(t.assigneePartyId, MOMIN_PARTY, "every mine=true row is assigned to the caller");
    }
  });
});

// ─── capture-first: a Writer can create; a valid flow never errors ─────────────────

describe("capture-first — a Writer (capture:create) CAN create a task", () => {
  it("Writer POST /tasks → 201 (few-clicks add, draft-now)", async () => {
    const res = await api(BASE, "/tasks", { method: "POST", token: writerToken, body: { title: "writer's quick capture" } });
    assert.equal(res.status, 201, "a capture:create holder may add a task");
    if (res.body?.id) createdTaskIds.push(res.body.id);
  });

  it("Writer can list tasks (capture:view)", async () => {
    const res = await api(BASE, "/tasks", { token: writerToken });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });
});

// ─── boundary validation ────────────────────────────────────────────────────────────

describe("boundary validation (treat client input as hostile)", () => {
  it("empty title → 400", async () => {
    const res = await createTask({ title: "" });
    assert.equal(res.status, 400);
  });

  it("malformed dueTime (no leading zero / wrong shape) → 400", async () => {
    const res = await createTask({ title: "bad time", dueDate: "2027-07-01", dueTime: "5pm", dueTz: "UTC" });
    assert.equal(res.status, 400);
  });

  it("malformed dueDate shape → 400", async () => {
    const res = await createTask({ title: "bad date", dueDate: "01/07/2027", dueTime: "17:00", dueTz: "UTC" });
    assert.equal(res.status, 400);
  });

  it("GET /tasks/:id complete with a non-uuid → 400 (ParseUUIDPipe)", async () => {
    const res = await api(BASE, "/tasks/not-a-uuid/complete", { method: "POST", token: mominToken });
    assert.equal(res.status, 400);
  });

  it("an out-of-enum ?state → 400", async () => {
    const res = await api(BASE, "/tasks?state=archived", { token: mominToken });
    assert.equal(res.status, 400);
  });
});
