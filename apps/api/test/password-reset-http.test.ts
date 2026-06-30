import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { config } from "dotenv";
import bcrypt from "bcryptjs";
import pg from "pg";
import { api, waitForHealth } from "./helpers.js";

/**
 * Self-service password reset (migration 0034) — BLACK-BOX HTTP against the
 * COMPILED app (dist/main.js) with the `dev` EmailService adapter writing the
 * reset link to a fresh outbox. Mirrors auth-http / client-portal-http /
 * pf-core / reminders conventions exactly (spawn dist, seed via admin pg +
 * provision endpoints, read the outbox JSON).
 *
 * Proves, per plane (business, pf, client), the recovery guarantees that must
 * never silently break (CLAUDE.md §4 security baseline):
 *   • request-reset for a KNOWN account → generic 200 + an email with a token;
 *   • reset with that token + a ≥8-char password → 200; OLD password 401, NEW 200;
 *   • single-use: a SECOND reset with the same token → generic 400;
 *   • expired / forged token → generic 400;
 *   • a refresh token minted BEFORE the reset is DEAD afterwards (session kill);
 *   • NO enumeration: unknown identifier → SAME generic 200 and NO email;
 *   • newPassword < 8 → 400 validation;
 *   • request endpoint is reachable WITHOUT auth (@Public);
 *   • client: login_id may differ from the contact email → the email goes to the
 *     party's contact email and the reset still works.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3251; // dedicated test port
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const NEW_PASSWORD = "NewPassw0rd!";
const CLIENT_PASSWORD = "ClientPass123!";
const ORG = "00000000-0000-4000-8000-000000000001";

const OUTBOX = mkdtempSync(join(tmpdir(), "bos-pwreset-"));

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

// Per-plane fixtures (all created in `before`, cleaned in `after`).
const bizUserId = randomUUID();
const bizEmail = `pwreset-biz+${randomUUID().slice(0, 8)}@fathomxo.test`;

let pfAccountId = "";
const pfEmail = `pwreset-pf+${randomUUID().slice(0, 8)}@pf.test`;

let clientPartyId = "";
let clientAccountId = "";
const clientLoginId = `student-${randomUUID().slice(0, 8)}`; // NOT an email
const clientContactEmail = `pwreset-client+${randomUUID().slice(0, 8)}@cp.test`;

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      FEATURE_CLIENT_PORTAL: "true",
      FEATURE_PERSONAL_FINANCE: "true",
      EMAIL_ADAPTER: "dev",
      EMAIL_OUTBOX_DIR: OUTBOX,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (d) => {
    const s = String(d);
    if (/error/i.test(s)) process.stderr.write(`[api] ${s}`);
  });
  await waitForHealth(BASE, 90000);
}

function sha256(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Outbox JSON files {from,to,subject,text}, newest first. */
function outboxFiles(): Array<{ name: string; msg: { to: string; subject: string; text: string } }> {
  return readdirSync(OUTBOX)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((name) => ({ name, msg: JSON.parse(readFileSync(join(OUTBOX, name), "utf8")) }))
    .reverse();
}

/** The newest email addressed to `to`, or undefined. */
function latestEmailTo(to: string) {
  return outboxFiles().find((f) => f.msg.to.toLowerCase() === to.toLowerCase());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Filenames of every outbox email currently addressed to `to`. */
function emailNamesFor(to: string): Set<string> {
  return new Set(outboxFiles().filter((f) => f.msg.to.toLowerCase() === to.toLowerCase()).map((f) => f.name));
}

/**
 * The reset email is dispatched OFF the response path (so an existing account isn't
 * observably slower than an unknown one — no timing oracle), so it lands in the
 * outbox shortly AFTER the 200. Poll for any email to `to`.
 */
async function waitForEmailTo(to: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const mail = latestEmailTo(to);
    if (mail) return mail;
    if (Date.now() >= deadline) return undefined;
    await sleep(50);
  }
}

/** Poll for an email to `to` whose file did NOT already exist in `exclude`. */
async function waitForNewEmailTo(to: string, exclude: Set<string>, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const mail = outboxFiles().find((f) => f.msg.to.toLowerCase() === to.toLowerCase() && !exclude.has(f.name));
    if (mail) return mail;
    if (Date.now() >= deadline) return undefined;
    await sleep(50);
  }
}

function tokenFromEmail(text: string): string | null {
  const m = text.match(/[?&]token=([^\s&]+)/);
  return m ? m[1] : null;
}

/**
 * Request a reset for `to` over HTTP, then read the freshly-minted raw token from the
 * NEW outbox email (one minted by THIS request — a fresh mint invalidates any prior
 * live token for the account, so we must not grab a stale earlier email).
 */
async function requestAndGrabToken(path: string, body: unknown, to: string): Promise<string> {
  const before = emailNamesFor(to);
  const res = await api(BASE, path, { method: "POST", body });
  assert.equal(res.status, 200, `request-reset should be a generic 200 (got ${res.status}: ${JSON.stringify(res.body)})`);
  assert.deepEqual(res.body, { ok: true }, "request-reset returns the generic {ok:true}");
  const mail = await waitForNewEmailTo(to, before);
  assert.ok(mail, `a reset email landed in the outbox for ${to}`);
  const token = tokenFromEmail(mail!.msg.text);
  assert.ok(token, `the email carries a ?token= link: ${mail!.msg.text}`);
  return token!;
}

async function bizLogin(email: string, password: string) {
  return api(BASE, "/auth/login", { method: "POST", body: { email, password } });
}
async function pfLogin(email: string, password: string) {
  return api(BASE, "/pf/auth/login", { method: "POST", body: { email, password } });
}
async function clientLogin(loginId: string, password: string) {
  return api(BASE, "/client/auth/login", { method: "POST", body: { loginId, password } });
}

before(async () => {
  await admin.connect();
  await startServer();

  // ── business: a plain active user_account we control ──
  const bizHash = await bcrypt.hash(DEV_PASSWORD, 12);
  await admin.query(
    "insert into user_account (id, org_id, email, password_hash, status) values ($1,$2,$3,$4,'active')",
    [bizUserId, ORG, bizEmail, bizHash],
  );

  // ── pf: register a PF account over HTTP (the sanctioned path) ──
  const reg = await api(BASE, "/pf/auth/register", {
    method: "POST",
    body: { email: pfEmail, password: DEV_PASSWORD, displayName: "PWReset PF", baseCurrency: "BDT" },
  });
  assert.equal(reg.status, 201, `pf register should succeed (got ${reg.status}: ${JSON.stringify(reg.body)})`);
  pfAccountId = (await api(BASE, "/pf/auth/me", { token: reg.body.accessToken })).body.id as string;

  // ── client: a party whose contact email DIFFERS from the login_id, then provision
  //    a client_account directly (admin pg) so the reset target is the contact email. ──
  clientPartyId = randomUUID();
  await admin.query(
    "insert into party (id, org_id, display_name, party_type, contact_json) values ($1,$2,$3,'{client}',$4::jsonb)",
    [clientPartyId, ORG, "PWReset Client", JSON.stringify({ email: clientContactEmail })],
  );
  clientAccountId = randomUUID();
  const clientHash = await bcrypt.hash(CLIENT_PASSWORD, 12);
  await admin.query(
    "insert into client_account (id, org_id, party_id, login_id, password_hash, status) values ($1,$2,$3,$4,$5,'active')",
    [clientAccountId, ORG, clientPartyId, clientLoginId, clientHash],
  );
});

after(async () => {
  await admin.query("delete from password_reset_token where account_id = any($1::uuid[])", [
    [bizUserId, pfAccountId, clientAccountId].filter(Boolean),
  ]);

  await admin.query("delete from audit_log where entity_id = $1", [bizUserId]);
  await admin.query("delete from auth_refresh_token where user_id = $1", [bizUserId]);
  await admin.query("delete from user_account where id = $1", [bizUserId]);

  if (pfAccountId) {
    await admin.query("delete from pf_audit_log where pf_account_id=$1", [pfAccountId]);
    await admin.query("delete from pf_refresh_token where pf_account_id=$1", [pfAccountId]);
    await admin.query("delete from pf_category where pf_account_id=$1", [pfAccountId]);
    await admin.query("delete from pf_account where id=$1", [pfAccountId]);
  }

  if (clientAccountId) {
    await admin.query("delete from audit_log where entity_id=$1", [clientAccountId]);
    await admin.query("delete from client_refresh_token where client_account_id=$1", [clientAccountId]);
    await admin.query("delete from client_account where id=$1", [clientAccountId]);
  }
  if (clientPartyId) await admin.query("delete from party where id=$1", [clientPartyId]);

  await admin.end();
  if (server && !server.killed) server.kill();
});

// ─── BUSINESS plane ───────────────────────────────────────────────────────────

describe("business plane — POST /auth/request-reset + /auth/reset", () => {
  it("the request endpoint is reachable WITHOUT auth (@Public) and returns generic 200", async () => {
    const res = await api(BASE, "/auth/request-reset", { method: "POST", body: { email: bizEmail } });
    assert.equal(res.status, 200, "request-reset is @Public — no bearer needed");
    assert.deepEqual(res.body, { ok: true });
    // Flush this request's async email so it can't race the next test's fresh mint.
    await waitForEmailTo(bizEmail);
  });

  it("request → reset → OLD password fails (401), NEW password logs in (200); a pre-reset refresh dies", async () => {
    // A refresh token minted BEFORE the reset — must be dead after the reset (session kill).
    const pre = await bizLogin(bizEmail, DEV_PASSWORD);
    assert.equal(pre.status, 200, "old password logs in before reset");
    const preRefresh = pre.body.refreshToken as string;

    const token = await requestAndGrabToken("/auth/request-reset", { email: bizEmail }, bizEmail);

    const reset = await api(BASE, "/auth/reset", { method: "POST", body: { token, newPassword: NEW_PASSWORD } });
    assert.equal(reset.status, 200, `reset should succeed (got ${reset.status}: ${JSON.stringify(reset.body)})`);
    assert.deepEqual(reset.body, { ok: true });

    const oldLogin = await bizLogin(bizEmail, DEV_PASSWORD);
    assert.equal(oldLogin.status, 401, "the OLD password no longer works");

    const newLogin = await bizLogin(bizEmail, NEW_PASSWORD);
    assert.equal(newLogin.status, 200, "the NEW password works");

    const refresh = await api(BASE, "/auth/refresh", { method: "POST", body: { refreshToken: preRefresh } });
    assert.equal(refresh.status, 401, "a refresh token issued before the reset is revoked by it");

    // Single-use: replaying the same token is rejected with the generic 400.
    const replay = await api(BASE, "/auth/reset", { method: "POST", body: { token, newPassword: "AnotherPass1!" } });
    assert.equal(replay.status, 400, "a consumed token cannot be reused (single-use)");
  });

  it("a forged (random) token → generic 400", async () => {
    const forged = randomBytes(24).toString("base64url");
    const res = await api(BASE, "/auth/reset", { method: "POST", body: { token: forged, newPassword: NEW_PASSWORD } });
    assert.equal(res.status, 400, "an unknown token is rejected generically");
  });

  it("an EXPIRED token → generic 400 (seeded via the definer with a past expires_at)", async () => {
    const raw = randomBytes(24).toString("base64url");
    await admin.query("select pwreset_request('business', $1, $2, now() - interval '1 hour')", [bizUserId, sha256(raw)]);
    const res = await api(BASE, "/auth/reset", { method: "POST", body: { token: raw, newPassword: NEW_PASSWORD } });
    assert.equal(res.status, 400, "an expired token is rejected generically");
  });

  it("no enumeration — request for an UNKNOWN email → SAME generic 200 and NO email emitted", async () => {
    const unknown = `nobody+${randomUUID()}@fathomxo.test`;
    const before = outboxFiles().length;
    const res = await api(BASE, "/auth/request-reset", { method: "POST", body: { email: unknown } });
    assert.equal(res.status, 200, "unknown email gets the same generic 200");
    assert.deepEqual(res.body, { ok: true });
    await sleep(600); // let any (would-be) async dispatch flush before asserting absence
    assert.equal(outboxFiles().length, before, "no email emitted for an unknown account");
    assert.equal(latestEmailTo(unknown), undefined, "nothing addressed to the unknown email");
  });

  it("newPassword < 8 chars → 400 validation", async () => {
    const res = await api(BASE, "/auth/reset", { method: "POST", body: { token: "whatever", newPassword: "short" } });
    assert.equal(res.status, 400, "the DTO rejects a too-short password at the boundary");
  });
});

// ─── PF plane ───────────────────────────────────────────────────────────────

describe("pf plane — POST /pf/auth/request-reset + /pf/auth/reset", () => {
  it("request → reset → OLD password 401, NEW 200; a pre-reset refresh dies; single-use 400", async () => {
    const pre = await pfLogin(pfEmail, DEV_PASSWORD);
    assert.equal(pre.status, 200, "old password logs in before reset");
    const preRefresh = pre.body.refreshToken as string;

    const token = await requestAndGrabToken("/pf/auth/request-reset", { email: pfEmail }, pfEmail);

    const reset = await api(BASE, "/pf/auth/reset", { method: "POST", body: { token, newPassword: NEW_PASSWORD } });
    assert.equal(reset.status, 200, `pf reset should succeed (got ${reset.status}: ${JSON.stringify(reset.body)})`);

    assert.equal((await pfLogin(pfEmail, DEV_PASSWORD)).status, 401, "OLD pf password no longer works");
    assert.equal((await pfLogin(pfEmail, NEW_PASSWORD)).status, 200, "NEW pf password works");

    const refresh = await api(BASE, "/pf/auth/refresh", { method: "POST", body: { refreshToken: preRefresh } });
    assert.equal(refresh.status, 401, "a pf refresh token issued before the reset is revoked");

    const replay = await api(BASE, "/pf/auth/reset", { method: "POST", body: { token, newPassword: "AnotherPass1!" } });
    assert.equal(replay.status, 400, "a consumed pf token cannot be reused");
  });

  it("a forged token → generic 400", async () => {
    const res = await api(BASE, "/pf/auth/reset", {
      method: "POST",
      body: { token: randomBytes(24).toString("base64url"), newPassword: NEW_PASSWORD },
    });
    assert.equal(res.status, 400);
  });

  it("an EXPIRED pf token → generic 400", async () => {
    const raw = randomBytes(24).toString("base64url");
    await admin.query("select pwreset_request('pf', $1, $2, now() - interval '1 hour')", [pfAccountId, sha256(raw)]);
    const res = await api(BASE, "/pf/auth/reset", { method: "POST", body: { token: raw, newPassword: NEW_PASSWORD } });
    assert.equal(res.status, 400);
  });

  it("no enumeration — unknown email → generic 200, NO email", async () => {
    const unknown = `nobody+${randomUUID()}@pf.test`;
    const before = outboxFiles().length;
    const res = await api(BASE, "/pf/auth/request-reset", { method: "POST", body: { email: unknown } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    await sleep(600);
    assert.equal(outboxFiles().length, before, "no email for an unknown pf account");
  });

  it("newPassword < 8 → 400 validation", async () => {
    const res = await api(BASE, "/pf/auth/reset", { method: "POST", body: { token: "whatever", newPassword: "short" } });
    assert.equal(res.status, 400);
  });
});

// ─── CLIENT plane ─────────────────────────────────────────────────────────────

describe("client plane — POST /client/auth/request-reset + /client/auth/reset", () => {
  it("login_id differs from contact email — the reset email is sent to the PARTY contact email", async () => {
    const res = await api(BASE, "/client/auth/request-reset", { method: "POST", body: { loginId: clientLoginId } });
    assert.equal(res.status, 200, "request-reset returns generic 200");
    assert.deepEqual(res.body, { ok: true });
    // The email must go to the party's contact email, NOT the login_id (a student id).
    assert.ok(await waitForEmailTo(clientContactEmail), "the reset email is addressed to the party contact email");
    assert.equal(latestEmailTo(clientLoginId), undefined, "nothing is sent to the (non-email) login_id");
  });

  it("request → reset → OLD password 401, NEW 200; a pre-reset refresh dies; single-use 400", async () => {
    const pre = await clientLogin(clientLoginId, CLIENT_PASSWORD);
    assert.equal(pre.status, 200, "old client password logs in before reset");
    const preRefresh = pre.body.refreshToken as string;

    const token = await requestAndGrabToken(
      "/client/auth/request-reset",
      { loginId: clientLoginId },
      clientContactEmail,
    );

    const reset = await api(BASE, "/client/auth/reset", { method: "POST", body: { token, newPassword: NEW_PASSWORD } });
    assert.equal(reset.status, 200, `client reset should succeed (got ${reset.status}: ${JSON.stringify(reset.body)})`);

    assert.equal((await clientLogin(clientLoginId, CLIENT_PASSWORD)).status, 401, "OLD client password no longer works");
    assert.equal((await clientLogin(clientLoginId, NEW_PASSWORD)).status, 200, "NEW client password works");

    const refresh = await api(BASE, "/client/auth/refresh", { method: "POST", body: { refreshToken: preRefresh } });
    assert.equal(refresh.status, 401, "a client refresh token issued before the reset is revoked");

    const replay = await api(BASE, "/client/auth/reset", { method: "POST", body: { token, newPassword: "AnotherPass1!" } });
    assert.equal(replay.status, 400, "a consumed client token cannot be reused");
  });

  it("a forged token → generic 400", async () => {
    const res = await api(BASE, "/client/auth/reset", {
      method: "POST",
      body: { token: randomBytes(24).toString("base64url"), newPassword: NEW_PASSWORD },
    });
    assert.equal(res.status, 400);
  });

  it("an EXPIRED client token → generic 400", async () => {
    const raw = randomBytes(24).toString("base64url");
    await admin.query("select pwreset_request('client', $1, $2, now() - interval '1 hour')", [clientAccountId, sha256(raw)]);
    const res = await api(BASE, "/client/auth/reset", { method: "POST", body: { token: raw, newPassword: NEW_PASSWORD } });
    assert.equal(res.status, 400);
  });

  it("no enumeration — unknown loginId → generic 200, NO email", async () => {
    const unknown = `ghost-${randomUUID().slice(0, 8)}`;
    const before = outboxFiles().length;
    const res = await api(BASE, "/client/auth/request-reset", { method: "POST", body: { loginId: unknown } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    await sleep(600);
    assert.equal(outboxFiles().length, before, "no email for an unknown client login");
  });

  it("newPassword < 8 → 400 validation", async () => {
    const res = await api(BASE, "/client/auth/reset", { method: "POST", body: { token: "whatever", newPassword: "short" } });
    assert.equal(res.status, 400);
  });
});
