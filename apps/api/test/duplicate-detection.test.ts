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
 * P1 item 10 — duplicate/overlap detection (capture-first, NEVER blocks). Reuses
 * pg_trgm similarity(). Proves: a new job that matches an existing (source +
 * course + assignment/title) surfaces it as `possibleDuplicates` on create AND via
 * GET /work/:id/possible-duplicates; creation is never blocked; a different course
 * yields no match; insufficient signal (no source/course) yields no match.
 * Requires FEATURE_WORK + FEATURE_REFERENCE.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3260;
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const ORG = "00000000-0000-4000-8000-000000000001";

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
let mominToken = "";
let clientPartyId = "";
let courseRefId = "";
let course2RefId = "";
let assignmentRefId = "";
const createdWorkItemIds: string[] = [];
const createdRefIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — build the api first.`);
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
const login = (email: string, password: string) => api(BASE, "/auth/login", { method: "POST", body: { email, password } });

async function resolveRef(kind: string, raw: string): Promise<string> {
  const res = await api(BASE, "/reference/resolve", { method: "POST", token: mominToken, body: { kind, raw } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  createdRefIds.push(res.body.entity.id);
  return res.body.entity.id;
}
async function createWork(body: Record<string, unknown>) {
  const res = await api(BASE, "/work", { method: "POST", token: mominToken, body });
  if (res.status === 201 && res.body?.id) createdWorkItemIds.push(res.body.id);
  return res;
}

before(async () => {
  await admin.connect();
  await startServer();
  mominToken = (await login("momin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  clientPartyId = randomUUID();
  await admin.query("insert into party (id, org_id, display_name, party_type) values ($1,$2,'DUP Client','{client}')", [clientPartyId, ORG]);
  courseRefId = await resolveRef("course", `DUPCOURSE${randomUUID().slice(0, 6)}`);
  course2RefId = await resolveRef("course", `OTHERCRS${randomUUID().slice(0, 6)}`);
  assignmentRefId = await resolveRef("assignment_type", `dupessay${randomUUID().slice(0, 6)}`);
});

after(async () => {
  for (const id of createdWorkItemIds) {
    await admin.query("delete from audit_log where entity_id=$1", [id]);
    await admin.query("delete from work_item where id=$1", [id]);
  }
  for (const id of createdRefIds) {
    await admin.query("delete from ref_alias where ref_id=$1", [id]);
    await admin.query("delete from ref_entity where id=$1", [id]);
  }
  await admin.query("delete from party where id=$1", [clientPartyId]);
  await admin.end();
  if (server && !server.killed) server.kill();
});

describe("duplicate/overlap detection (capture-first, never blocks; P1 item 10)", () => {
  let firstId = "";

  it("the FIRST job (nothing to match) creates with no possible duplicates", async () => {
    const res = await createWork({
      title: "Macroeconomics essay on inflation",
      sourcePartyId: clientPartyId,
      courseRefId,
      assignmentTypeRefId: assignmentRefId,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    firstId = res.body.id;
    assert.deepEqual(res.body.possibleDuplicates, [], "no prior job to flag");
  });

  it("a near-identical SECOND job surfaces the first as a possible duplicate — but is NEVER blocked", async () => {
    const res = await createWork({
      title: "Macroeconomics essay on inflation and growth",
      sourcePartyId: clientPartyId,
      courseRefId,
      assignmentTypeRefId: assignmentRefId,
    });
    assert.equal(res.status, 201, "creation is never blocked (capture-first)");
    const dups = res.body.possibleDuplicates as Array<{ id: string }>;
    assert.ok(dups.some((d) => d.id === firstId), "the first job is surfaced as a possible duplicate");

    // Also reachable via the dedicated endpoint.
    const get = await api(BASE, `/work/${res.body.id}/possible-duplicates`, { token: mominToken });
    assert.equal(get.status, 200);
    assert.ok((get.body as Array<{ id: string }>).some((d) => d.id === firstId));
  });

  it("a job on a DIFFERENT course is NOT flagged (the strong pair must match)", async () => {
    const res = await createWork({
      title: "Macroeconomics essay on inflation",
      sourcePartyId: clientPartyId,
      courseRefId: course2RefId,
      assignmentTypeRefId: assignmentRefId,
    });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.possibleDuplicates, [], "a different course is not a duplicate");
  });

  it("a job with no source/course has insufficient signal → no duplicates (never fabricated)", async () => {
    const res = await createWork({ title: "Some ad-hoc note" });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.possibleDuplicates, []);
  });
});
