import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { config } from "dotenv";
import pg from "pg";
import { api, waitForHealth } from "./helpers.js";

/**
 * P1 item 8 — client auto-provisioning from student-id + name + FORCED first-login
 * reset (migration 0040). Proves: auto-provision derives login_id/password from the
 * student id + name and sets must_reset_password; a normal login is BLOCKED with
 * {resetRequired:true} until the client resets; after the shipped reset flow the
 * flag clears and login issues tokens; a login-id collision is 409; the endpoint is
 * client_portal:create-gated; and a public quote submits fine with the WhatsApp
 * stub wired (dev no-op). Requires FEATURE_CLIENT_PORTAL + FEATURE_WORK.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3262;
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const ORG = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // work only, NO client_portal
const OUTBOX = mkdtempSync(join(tmpdir(), "bos-autoprov-"));

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
let adminToken = "";
let sysToken = "";
let writerOnlyToken = "";
const createdUserIds: string[] = [];
const createdPartyIds: string[] = [];
const createdAccountIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — build the api first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      FEATURE_CLIENT_PORTAL: "true",
      FEATURE_WORK: "true",
      EMAIL_ADAPTER: "dev",
      EMAIL_OUTBOX_DIR: OUTBOX,
      WHATSAPP_ADAPTER: "dev",
      PUBLIC_QUOTE_NOTIFY_WHATSAPP: "+8801711111111",
      TURNSTILE_SECRET_KEY: "", // skip the bot gate in this test (a real key may be in .env)
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (d) => {
    const s = String(d);
    if (/error/i.test(s)) process.stderr.write(`[api] ${s}`);
  });
  await waitForHealth(BASE, 90000);
}

const login = (email: string, password: string) => api(BASE, "/auth/login", { method: "POST", body: { email, password } });
const clientLogin = (loginId: string, password: string, totp?: string) =>
  api(BASE, "/client/auth/login", { method: "POST", body: { loginId, password, totp } });

/** Insert a client party with a student id (external_ref) + a contact email. */
async function makeClientParty(name: string, studentId: string, email: string): Promise<string> {
  const id = randomUUID();
  await admin.query(
    "insert into party (id, org_id, display_name, party_type, external_ref, contact_json) values ($1,$2,$3,'{client}',$4,$5)",
    [id, ORG, name, studentId, JSON.stringify({ email })],
  );
  createdPartyIds.push(id);
  return id;
}

async function makeWriterOnlyUser(): Promise<string> {
  const email = `apwriter+${randomUUID()}@fathomxo.test`;
  const created = await api(BASE, "/platform/users", { method: "POST", token: sysToken, body: { email, password: DEV_PASSWORD } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  createdUserIds.push(created.body.id);
  await api(BASE, `/platform/users/${created.body.id}/roles`, { method: "POST", token: sysToken, body: { roleId: WRITER_ROLE } });
  return (await login(email, DEV_PASSWORD)).body.accessToken as string;
}

/**
 * Request a reset by the client's login id (their student id), then poll the outbox
 * for the email — addressed to the party's CONTACT email (client_reset_lookup maps
 * login_id → contact email) — and extract the raw token.
 */
async function tokenForReset(loginId: string, emailTo: string): Promise<string> {
  const res = await api(BASE, "/client/auth/request-reset", { method: "POST", body: { loginId } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  for (let i = 0; i < 100; i++) {
    const mail = readdirSync(OUTBOX)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(OUTBOX, f), "utf8")) as { to: string; text: string })
      .find((m) => m.to.toLowerCase() === emailTo.toLowerCase());
    const tok = mail?.text.match(/[?&]token=([^\s&]+)/)?.[1];
    if (tok) return tok;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no reset email for ${emailTo} landed in the outbox`);
}

before(async () => {
  await admin.connect();
  await startServer();
  sysToken = (await login("sysadmin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  adminToken = (await login("momin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  writerOnlyToken = await makeWriterOnlyUser();
});

after(async () => {
  for (const id of createdAccountIds) {
    await admin.query("delete from client_refresh_token where client_account_id=$1", [id]);
    await admin.query("delete from password_reset_token where account_id=$1", [id]);
    await admin.query("delete from client_account where id=$1", [id]);
  }
  // Any auto-created accounts on our parties (studentId+name path creates the party too).
  for (const id of createdPartyIds) {
    await admin.query("delete from client_refresh_token where client_account_id in (select id from client_account where party_id=$1)", [id]);
    await admin.query("delete from password_reset_token where account_id in (select id from client_account where party_id=$1)", [id]);
    await admin.query("delete from client_account where party_id=$1", [id]);
  }
  await admin.query("delete from party where org_id=$1 and external_ref like 'AP-%'", [ORG]);
  // The public-quote test leaves a lead party + draft + lead account (login = @lead.test email).
  await admin.query("delete from work_item where source_party_id in (select id from party where contact_json->>'email' like '%@lead.test')");
  await admin.query("delete from client_account where login_id like '%@lead.test'");
  await admin.query("delete from party where contact_json->>'email' like '%@lead.test'");
  for (const id of createdPartyIds) await admin.query("delete from party where id=$1", [id]);
  for (const id of createdUserIds) {
    await admin.query("delete from auth_refresh_token where user_id=$1", [id]);
    await admin.query("delete from user_role where user_id=$1", [id]);
    await admin.query("delete from user_account where id=$1", [id]);
  }
  await admin.end();
  if (server && !server.killed) server.kill();
});

describe("client auto-provisioning + forced first-login reset (P1 item 8)", () => {
  it("auto-provisions from an existing client party: login_id=student-id, derived password, must-reset", async () => {
    const studentId = `AP-${randomUUID().slice(0, 8)}`;
    const email = `${studentId.toLowerCase()}@stud.test`;
    const partyId = await makeClientParty("Auto Client One", studentId, email);
    const res = await api(BASE, "/client-portal/accounts/auto", { method: "POST", token: adminToken, body: { partyId } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.loginId, studentId, "login id is the student id");
    assert.equal(res.body.mustResetPassword, true);
    assert.ok(typeof res.body.initialPassword === "string" && res.body.initialPassword.length >= 8, "a derived initial password is returned");
    createdAccountIds.push(res.body.id);

    // A normal login is BLOCKED with resetRequired — no tokens issued yet.
    const blocked = await clientLogin(studentId, res.body.initialPassword);
    assert.equal(blocked.status, 200);
    assert.deepEqual(blocked.body, { resetRequired: true }, "forced reset: correct creds but no session");
    assert.equal(blocked.body.accessToken, undefined, "no access token while a reset is required");

    // After the shipped reset flow, the flag clears and login issues tokens.
    const token = await tokenForReset(studentId, email);
    const newPassword = "FreshClientPass123!";
    const reset = await api(BASE, "/client/auth/reset", { method: "POST", body: { token, newPassword } });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    const ok = await clientLogin(studentId, newPassword);
    assert.equal(ok.status, 200);
    assert.ok(ok.body.accessToken, "login now issues a session");
    // The old derived password no longer works (it was replaced by the reset).
    const old = await clientLogin(studentId, res.body.initialPassword);
    assert.equal(old.status, 401, "the derivable initial password is dead after the reset");
  });

  it("auto-provisions from studentId + name (creates the client party)", async () => {
    const studentId = `AP-${randomUUID().slice(0, 8)}`;
    const res = await api(BASE, "/client-portal/accounts/auto", {
      method: "POST",
      token: adminToken,
      body: { studentId, name: "Nadia Rahman" },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.loginId, studentId);
    assert.equal(res.body.mustResetPassword, true);
    createdAccountIds.push(res.body.id);
    createdPartyIds.push(res.body.partyId);
    // A client party now exists carrying that student id.
    const p = await admin.query("select party_type, external_ref from party where id=$1", [res.body.partyId]);
    assert.equal(p.rows[0].external_ref, studentId);
    assert.ok((p.rows[0].party_type as string[]).includes("client"));
  });

  it("a login-id collision is 409", async () => {
    const studentId = `AP-${randomUUID().slice(0, 8)}`;
    const first = await api(BASE, "/client-portal/accounts/auto", { method: "POST", token: adminToken, body: { studentId, name: "Dup One" } });
    assert.equal(first.status, 201);
    createdAccountIds.push(first.body.id);
    createdPartyIds.push(first.body.partyId);
    const again = await api(BASE, "/client-portal/accounts/auto", { method: "POST", token: adminToken, body: { studentId, name: "Dup Two" } });
    assert.equal(again.status, 409, "the same student-id login can't be provisioned twice");
  });

  it("auto-provision is client_portal:create-gated (a writer-only user → 403)", async () => {
    const studentId = `AP-${randomUUID().slice(0, 8)}`;
    const res = await api(BASE, "/client-portal/accounts/auto", { method: "POST", token: writerOnlyToken, body: { studentId, name: "No Perm" } });
    assert.equal(res.status, 403);
  });

  it("a public quote submits fine with the WhatsApp stub wired (dev no-op on intake)", async () => {
    const res = await api(BASE, "/public/quote", {
      method: "POST",
      body: { name: "Prospect", email: `prospect+${randomUUID().slice(0, 8)}@lead.test`, details: "I need help with an essay." },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { ok: true });
  });
});
