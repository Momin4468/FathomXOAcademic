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
 * Audit item 12 — HRM employee work-logging. BLACK-BOX HTTP. Proves:
 *   • an employee logs work with NO price visible anywhere in the surface;
 *   • a second employee never sees the first's logs (self-scope);
 *   • an admin converts a draft log → a priced producer work_line (status flips,
 *     converted_work_line_id set); convert without a job → 400; reject flips;
 *   • log is hrm:create-gated, convert/reject hrm:approve-gated.
 * Requires FEATURE_HRM + FEATURE_WORK.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3266;
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const ORG = "00000000-0000-4000-8000-000000000001";
const EMPLOYEE_ROLE = "00000000-0000-4000-8000-0000000000ab";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // no hrm permission

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
let adminToken = ""; // momin — hrm:view + hrm:approve + work:*
let sysToken = "";
const createdUserIds: string[] = [];
const createdPartyIds: string[] = [];
const createdWorkItemIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — build the api first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT), FEATURE_HRM: "true", FEATURE_WORK: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (d) => {
    const s = String(d);
    if (/error/i.test(s)) process.stderr.write(`[api] ${s}`);
  });
  await waitForHealth(BASE, 90000);
}

const login = (email: string, password: string) => api(BASE, "/auth/login", { method: "POST", body: { email, password } });

async function makeUser(roleId: string, partyType: string): Promise<{ token: string; partyId: string; userId: string }> {
  const partyId = randomUUID();
  await admin.query("insert into party (id, org_id, display_name, party_type) values ($1,$2,$3,$4)", [partyId, ORG, `Emp ${partyId.slice(0, 6)}`, `{${partyType}}`]);
  createdPartyIds.push(partyId);
  const email = `hrm+${randomUUID()}@fathomxo.test`;
  const created = await api(BASE, "/platform/users", { method: "POST", token: sysToken, body: { email, password: DEV_PASSWORD, partyId } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  createdUserIds.push(created.body.id);
  await api(BASE, `/platform/users/${created.body.id}/roles`, { method: "POST", token: sysToken, body: { roleId } });
  const token = (await login(email, DEV_PASSWORD)).body.accessToken as string;
  return { token, partyId, userId: created.body.id };
}

let empA: { token: string; partyId: string; userId: string };
let empB: { token: string; partyId: string; userId: string };
let writerUser: { token: string; partyId: string; userId: string };

before(async () => {
  await admin.connect();
  await startServer();
  sysToken = (await login("sysadmin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  adminToken = (await login("momin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  empA = await makeUser(EMPLOYEE_ROLE, "employee");
  empB = await makeUser(EMPLOYEE_ROLE, "employee");
  writerUser = await makeUser(WRITER_ROLE, "writer");
});

after(async () => {
  // producer_work_log references work_line (converted_work_line_id) → delete logs FIRST.
  await admin.query("delete from producer_work_log where employee_party_id = any($1::uuid[])", [createdPartyIds]);
  for (const id of createdWorkItemIds) {
    await admin.query("delete from producer_work_log where work_item_id=$1", [id]);
    await admin.query("delete from work_line where work_item_id=$1", [id]);
  }
  for (const id of createdWorkItemIds) {
    await admin.query("delete from audit_log where entity_id=$1", [id]);
    await admin.query("delete from work_item where id=$1", [id]);
  }
  for (const id of createdUserIds) {
    await admin.query("delete from auth_refresh_token where user_id=$1", [id]);
    await admin.query("delete from user_role where user_id=$1", [id]);
    await admin.query("delete from user_account where id=$1", [id]);
  }
  for (const id of createdPartyIds) await admin.query("delete from party where id=$1", [id]);
  await admin.end();
  if (server && !server.killed) server.kill();
});

describe("HRM employee work-logging (audit item 12)", () => {
  it("an employee logs work with NO price visible, and sees only their own", async () => {
    const log = await api(BASE, "/worklog", { method: "POST", token: empA.token, body: { title: "Wrote chapter 2", quantity: 4, loggedOn: "2026-07-02" } });
    assert.equal(log.status, 201, JSON.stringify(log.body));
    assert.equal(log.body.status, "draft");
    assert.equal(log.body.employeePartyId, empA.partyId, "employee is the caller, not from the body");
    // NO money field exists on the surface.
    for (const k of ["amount", "rate", "price", "writerRate", "clientRate"]) {
      assert.equal((log.body as Record<string, unknown>)[k], undefined, `no money field '${k}' on a work log`);
    }

    const mineA = await api(BASE, "/worklog/mine", { token: empA.token });
    assert.equal(mineA.status, 200);
    assert.equal((mineA.body as Array<any>).filter((l) => l.id === log.body.id).length, 1, "empA sees their own log");
    const mineB = await api(BASE, "/worklog/mine", { token: empB.token });
    assert.equal((mineB.body as Array<any>).length, 0, "empB sees none of empA's logs");
  });

  it("an admin converts a draft log into a priced producer work_line", async () => {
    const log = await api(BASE, "/worklog", { method: "POST", token: empA.token, body: { title: "Edited thesis", loggedOn: "2026-07-03" } });
    // Convert without a job → 400.
    const noJob = await api(BASE, `/worklog/${log.body.id}/convert`, { method: "POST", token: adminToken, body: {} });
    assert.equal(noJob.status, 400, "cannot convert without a linked job");

    // Create a job, then convert onto it.
    const job = await api(BASE, "/work", { method: "POST", token: adminToken, body: { title: "HRM convert target" } });
    assert.equal(job.status, 201);
    createdWorkItemIds.push(job.body.id);
    const conv = await api(BASE, `/worklog/${log.body.id}/convert`, { method: "POST", token: adminToken, body: { workItemId: job.body.id } });
    assert.equal(conv.status, 201, JSON.stringify(conv.body));
    assert.equal(conv.body.status, "converted");
    assert.ok(conv.body.convertedWorkLineId, "the log links the created work_line");

    // A producer work_line for the employee now exists on the job, with NO money fabricated.
    const line = await admin.query("select writer_party_id, line_kind, writer_rate, client_rate, fixed_amount from work_line where id=$1", [conv.body.convertedWorkLineId]);
    assert.equal(line.rows[0].writer_party_id, empA.partyId, "the line is a producer line for the employee");
    assert.equal(line.rows[0].writer_rate, null, "convert fabricates no writer rate");
    assert.equal(line.rows[0].client_rate, null, "convert fabricates no client rate");
    assert.equal(line.rows[0].fixed_amount, null, "convert fabricates no amount — priced later on the job");

    // A converted log can't be converted again.
    const again = await api(BASE, `/worklog/${log.body.id}/convert`, { method: "POST", token: adminToken, body: { workItemId: job.body.id } });
    assert.equal(again.status, 400);
  });

  it("log is hrm:create-gated; convert/reject is hrm:approve-gated", async () => {
    // A non-hrm role can't log.
    const noLog = await api(BASE, "/worklog", { method: "POST", token: writerUser.token, body: { title: "x", loggedOn: "2026-07-03" } });
    assert.equal(noLog.status, 403);
    // An employee can't convert or reject (no hrm:approve).
    const log = await api(BASE, "/worklog", { method: "POST", token: empA.token, body: { title: "For reject", loggedOn: "2026-07-03" } });
    const noConvert = await api(BASE, `/worklog/${log.body.id}/convert`, { method: "POST", token: empA.token, body: {} });
    assert.equal(noConvert.status, 403);
    // Admin rejects it.
    const rej = await api(BASE, `/worklog/${log.body.id}/reject`, { method: "POST", token: adminToken });
    assert.equal(rej.status, 201, JSON.stringify(rej.body));
    assert.equal(rej.body.status, "rejected");
  });
});
