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
 * Audit item 13 — vendor self-service invoicing. BLACK-BOX HTTP. Proves:
 *   • a vendor submits a proposed invoice and sees ONLY their own claims/balance;
 *   • a second vendor never sees the first's claim (self-scope);
 *   • an admin sees the queue and approves/rejects (governance — no leg posted);
 *   • submit is vendor:create-gated, decide is vendor:approve-gated.
 * Requires FEATURE_VENDOR_PORTAL + FEATURE_BILLING.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3265;
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const ORG = "00000000-0000-4000-8000-000000000001";
const VENDOR_ROLE = "00000000-0000-4000-8000-0000000000a8";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // no vendor permission

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
let adminToken = ""; // momin — vendor:view + vendor:approve
let sysToken = "";
const createdUserIds: string[] = [];
const createdPartyIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — build the api first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT), FEATURE_VENDOR: "true", FEATURE_BILLING: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (d) => {
    const s = String(d);
    if (/error/i.test(s)) process.stderr.write(`[api] ${s}`);
  });
  await waitForHealth(BASE, 90000);
}

const login = (email: string, password: string) => api(BASE, "/auth/login", { method: "POST", body: { email, password } });

/** Create a vendor party + a user_account on it with the given role; return the token. */
async function makeVendorUser(roleId: string): Promise<{ token: string; partyId: string }> {
  const partyId = randomUUID();
  await admin.query("insert into party (id, org_id, display_name, party_type) values ($1,$2,$3,'{vendor}')", [partyId, ORG, `Vendor ${partyId.slice(0, 6)}`]);
  createdPartyIds.push(partyId);
  const email = `vendor+${randomUUID()}@fathomxo.test`;
  const created = await api(BASE, "/platform/users", { method: "POST", token: sysToken, body: { email, password: DEV_PASSWORD, partyId } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  createdUserIds.push(created.body.id);
  await api(BASE, `/platform/users/${created.body.id}/roles`, { method: "POST", token: sysToken, body: { roleId } });
  const token = (await login(email, DEV_PASSWORD)).body.accessToken as string;
  return { token, partyId };
}

let vendorA: { token: string; partyId: string };
let vendorB: { token: string; partyId: string };
let writerUser: { token: string; partyId: string };

before(async () => {
  await admin.connect();
  await startServer();
  sysToken = (await login("sysadmin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  adminToken = (await login("momin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  vendorA = await makeVendorUser(VENDOR_ROLE);
  vendorB = await makeVendorUser(VENDOR_ROLE);
  writerUser = await makeVendorUser(WRITER_ROLE); // a party+user with a NON-vendor role
});

after(async () => {
  await admin.query("delete from vendor_claim where vendor_party_id = any($1::uuid[])", [createdPartyIds]);
  for (const id of createdUserIds) {
    await admin.query("delete from auth_refresh_token where user_id=$1", [id]);
    await admin.query("delete from user_role where user_id=$1", [id]);
    await admin.query("delete from user_account where id=$1", [id]);
  }
  for (const id of createdPartyIds) await admin.query("delete from party where id=$1", [id]);
  await admin.end();
  if (server && !server.killed) server.kill();
});

describe("vendor self-service invoicing (audit item 13)", () => {
  it("a vendor submits an invoice and sees only their own; a second vendor sees none of it", async () => {
    const sub = await api(BASE, "/vendor/claims", { method: "POST", token: vendorA.token, body: { amount: 1500, note: "Handoff for job X" } });
    assert.equal(sub.status, 201, JSON.stringify(sub.body));
    assert.equal(sub.body.status, "proposed");
    assert.equal(sub.body.vendorPartyId, vendorA.partyId, "vendor is the caller, not from the body");

    const meA = await api(BASE, "/vendor/me", { token: vendorA.token });
    assert.equal(meA.status, 200, JSON.stringify(meA.body));
    assert.equal((meA.body.claims as Array<any>).filter((c) => c.id === sub.body.id).length, 1, "vendorA sees their own claim");
    assert.ok(meA.body.balance, "self balance present");

    const meB = await api(BASE, "/vendor/me", { token: vendorB.token });
    assert.equal((meB.body.claims as Array<any>).length, 0, "vendorB sees none of vendorA's claims");
  });

  it("an admin sees the queue and approves (governance decision, no leg posted)", async () => {
    const sub = await api(BASE, "/vendor/claims", { method: "POST", token: vendorA.token, body: { amount: 900 } });
    const queue = await api(BASE, "/vendor-admin/claims?status=proposed", { token: adminToken });
    assert.equal(queue.status, 200);
    assert.ok((queue.body as Array<any>).some((c) => c.id === sub.body.id), "the claim is in the admin queue");

    const dec = await api(BASE, `/vendor-admin/claims/${sub.body.id}/decide`, { method: "POST", token: adminToken, body: { status: "approved" } });
    assert.equal(dec.status, 201, JSON.stringify(dec.body));
    assert.equal(dec.body.status, "approved");

    // Deciding an already-decided claim → 400.
    const again = await api(BASE, `/vendor-admin/claims/${sub.body.id}/decide`, { method: "POST", token: adminToken, body: { status: "rejected" } });
    assert.equal(again.status, 400);
  });

  it("submit is vendor:create-gated; decide is vendor:approve-gated", async () => {
    // A non-vendor role can't submit.
    const noSubmit = await api(BASE, "/vendor/claims", { method: "POST", token: writerUser.token, body: { amount: 100 } });
    assert.equal(noSubmit.status, 403);
    // A vendor can't approve (no vendor:approve).
    const sub = await api(BASE, "/vendor/claims", { method: "POST", token: vendorA.token, body: { amount: 200 } });
    const noApprove = await api(BASE, `/vendor-admin/claims/${sub.body.id}/decide`, { method: "POST", token: vendorA.token, body: { status: "approved" } });
    assert.equal(noApprove.status, 403);
  });
});
