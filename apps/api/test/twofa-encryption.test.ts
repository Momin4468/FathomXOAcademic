import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { config } from "dotenv";
import bcrypt from "bcryptjs";
import pg from "pg";
import { api, makeBase32Secret, totpCode, waitForHealth } from "./helpers.js";

/**
 * Change 3 — 2FA secret encryption at rest (EncryptionService.seal/open, global
 * CryptoModule). BLACK-BOX HTTP against the COMPILED app (dist/main.js); mirrors
 * auth-http.test.ts + credential-vault-http.test.ts. Proves:
 *   • enroll + enable seals the secret: the stored twofa_secret starts with
 *     `enc:` and is NOT the raw base32 secret;
 *   • login with a correct TOTP (computed from the enrolled secret) succeeds; a
 *     wrong TOTP fails — i.e. open() decrypts the sealed value before verify;
 *   • back-compat: a PLAINTEXT-seeded twofa_secret still logs in with the right
 *     TOTP, and is LAZILY re-sealed to `enc:` on that success (key required).
 * Needs a fixed base64 32-byte VAULT_ENCRYPTION_KEY (a seal/open-of-sealed runs).
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3232; // dedicated test port for the twofa-encryption suite
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const VAULT_KEY = randomBytes(32).toString("base64"); // fixed AES-256 key for this run

const ORG = "00000000-0000-4000-8000-000000000001";

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = "";

// A fresh user we drive through enroll → enable (sealed-path).
let enrolUserId = "";
let enrolEmail = "";
let enrolToken = "";

// A legacy user seeded with a PLAINTEXT base32 secret (back-compat path).
const legacyUserId = randomUUID();
const legacyEmail = `twofa-legacy+${randomUUID()}@fathomxo.test`;
const legacySecret = makeBase32Secret();

const createdUserIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT), VAULT_ENCRYPTION_KEY: VAULT_KEY },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (d) => {
    const s = String(d);
    if (/error/i.test(s)) process.stderr.write(`[api] ${s}`);
  });
  await waitForHealth(BASE);
}

async function login(email: string, password: string, totp?: string) {
  return api(BASE, "/auth/login", { method: "POST", body: { email, password, totp } });
}

async function readTwofaSecret(userId: string): Promise<string | null> {
  const r = await admin.query("select twofa_secret from user_account where id=$1", [userId]);
  return (r.rows[0]?.twofa_secret as string | null) ?? null;
}

before(async () => {
  await admin.connect();
  await startServer();

  sysToken = (await login("sysadmin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  assert.ok(sysToken, "sysadmin should log in");

  // A fresh user for the enroll→enable sealed path.
  enrolEmail = `twofa-enrol+${randomUUID()}@fathomxo.test`;
  const created = await api(BASE, "/platform/users", { method: "POST", token: sysToken, body: { email: enrolEmail, password: DEV_PASSWORD } });
  assert.equal(created.status, 201, `user create should succeed (got ${created.status}: ${JSON.stringify(created.body)})`);
  enrolUserId = created.body.id as string;
  createdUserIds.push(enrolUserId);
  enrolToken = (await login(enrolEmail, DEV_PASSWORD)).body.accessToken;
  assert.ok(enrolToken, "the fresh user should log in (no 2FA yet)");

  // A legacy user with a PLAINTEXT base32 secret seeded directly (like auth-http).
  const hash = await bcrypt.hash(DEV_PASSWORD, 12);
  await admin.query(
    `insert into user_account (id, org_id, email, password_hash, status, twofa_secret)
     values ($1,$2,$3,$4,'active',$5)`,
    [legacyUserId, ORG, legacyEmail, hash, legacySecret],
  );
  createdUserIds.push(legacyUserId);
});

after(async () => {
  for (const id of createdUserIds) {
    await admin.query("delete from audit_log where actor_user_id=$1", [id]);
    await admin.query("delete from auth_refresh_token where user_id=$1", [id]);
    await admin.query("delete from user_role where user_id=$1", [id]);
    await admin.query("delete from user_account where id=$1", [id]);
  }
  await admin.end();
  if (server && !server.killed) server.kill();
});

// ─── Sealed path: enroll → enable stores enc:, login round-trips ──────────────

describe("🔴 2FA secret is sealed at rest (enroll → enable)", () => {
  let secret = "";

  it("enroll returns a base32 secret; enable (with a valid code) succeeds", async () => {
    const enroll = await api(BASE, "/auth/2fa/enroll", { method: "POST", token: enrolToken });
    assert.equal(enroll.status, 200, `enroll should succeed (got ${enroll.status}: ${JSON.stringify(enroll.body)})`);
    secret = enroll.body.secret as string;
    assert.ok(secret && secret.length > 0, "a secret is returned");

    // Retry once across a 30s TOTP boundary so enable is deterministic.
    let enable = await api(BASE, "/auth/2fa/enable", { method: "POST", token: enrolToken, body: { secret, code: totpCode(secret) } });
    if (enable.status !== 200) {
      enable = await api(BASE, "/auth/2fa/enable", { method: "POST", token: enrolToken, body: { secret, code: totpCode(secret) } });
    }
    assert.equal(enable.status, 200, `enable should succeed (got ${enable.status}: ${JSON.stringify(enable.body)})`);
  });

  it("the stored twofa_secret is `enc:`-sealed and is NOT the raw secret", async () => {
    const stored = await readTwofaSecret(enrolUserId);
    assert.ok(stored, "a secret is persisted");
    assert.ok(stored!.startsWith("enc:"), `stored secret must be sealed with the enc: marker (got: ${stored!.slice(0, 8)}…)`);
    assert.notEqual(stored, secret, "the stored value must not equal the raw secret");
    assert.ok(!stored!.includes(secret), "the raw base32 secret must not appear in the stored ciphertext");
  });

  it("login with the correct TOTP succeeds (open() decrypts before verify)", async () => {
    // Retry once across a TOTP boundary.
    let ok = await login(enrolEmail, DEV_PASSWORD, totpCode(secret));
    if (ok.status !== 200) ok = await login(enrolEmail, DEV_PASSWORD, totpCode(secret));
    assert.equal(ok.status, 200, `a valid TOTP against the sealed secret must succeed (got ${ok.status})`);
    assert.ok(ok.body.accessToken, "tokens are issued");
  });

  it("login with a wrong TOTP fails", async () => {
    const valid = totpCode(secret);
    let wrong = "000000";
    if (wrong === valid) wrong = "111111";
    const bad = await login(enrolEmail, DEV_PASSWORD, wrong);
    assert.equal(bad.status, 401, "a wrong TOTP must be rejected");

    const none = await login(enrolEmail, DEV_PASSWORD);
    assert.equal(none.status, 401, "a 2FA account must require a TOTP");
  });
});

// ─── Back-compat: a legacy plaintext secret still works + is lazily re-sealed ──

describe("🔴 back-compat — a legacy plaintext twofa_secret logs in and is lazily re-sealed", () => {
  it("the seeded secret is plaintext (NOT enc:) before any login", async () => {
    const stored = await readTwofaSecret(legacyUserId);
    assert.equal(stored, legacySecret, "the legacy secret is stored as raw plaintext");
    assert.ok(!stored!.startsWith("enc:"), "precondition: not yet sealed");
  });

  it("login with the right TOTP succeeds against the legacy plaintext secret", async () => {
    let ok = await login(legacyEmail, DEV_PASSWORD, totpCode(legacySecret));
    if (ok.status !== 200) ok = await login(legacyEmail, DEV_PASSWORD, totpCode(legacySecret));
    assert.equal(ok.status, 200, `a legacy plaintext 2FA login must still succeed (got ${ok.status})`);
  });

  it("after that successful login the secret is lazily re-sealed to `enc:` (still verifies)", async () => {
    // The re-seal is best-effort/async within the login tx; poll briefly.
    let stored: string | null = null;
    for (let i = 0; i < 20; i++) {
      stored = await readTwofaSecret(legacyUserId);
      if (stored && stored.startsWith("enc:")) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(stored!.startsWith("enc:"), `the legacy secret must be re-sealed on login (got: ${stored!.slice(0, 8)}…)`);
    assert.ok(!stored!.includes(legacySecret), "the raw plaintext must no longer be present");

    // And the now-sealed value still authenticates with the same secret.
    let again = await login(legacyEmail, DEV_PASSWORD, totpCode(legacySecret));
    if (again.status !== 200) again = await login(legacyEmail, DEV_PASSWORD, totpCode(legacySecret));
    assert.equal(again.status, 200, "the re-sealed secret still verifies the same TOTP");
  });
});
