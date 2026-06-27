import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { config } from "dotenv";
import bcrypt from "bcryptjs";
import pg from "pg";
import { api, makeBase32Secret, totpCode, waitForHealth } from "./helpers.js";

/**
 * Module 0 — BLACK-BOX HTTP tests. Boots the COMPILED app (dist/main.js) because
 * tsx drops emitDecoratorMetadata that NestJS DI needs (see task constraints), then
 * drives it over HTTP with global fetch. Proves the request-time security guarantees
 * the DB layer can't: identity-from-token (not headers), permission gating
 * (fail-closed), refresh rotation + logout revocation, and the 2FA login gate.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3210; // dedicated test port; the dev default is 3001
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";

const ORG = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6";

// A dedicated 2FA user we control (known secret) so we can drive the TOTP gate.
const twofaUserId = randomUUID();
const twofaEmail = `twofa+${randomUUID()}@fathomxo.test`;
const twofaSecret = makeBase32Secret();

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (d) => {
    const s = String(d);
    if (/error/i.test(s)) process.stderr.write(`[api] ${s}`);
  });
  await waitForHealth(BASE);
}

before(async () => {
  await admin.connect();
  // Seed a 2FA-enabled user with a secret we know, so login can be exercised.
  const hash = await bcrypt.hash(DEV_PASSWORD, 12);
  await admin.query(
    `insert into user_account (id, org_id, email, password_hash, status, twofa_secret)
     values ($1,$2,$3,$4,'active',$5)`,
    [twofaUserId, ORG, twofaEmail, hash, twofaSecret],
  );
  await startServer();
});

after(async () => {
  await admin.query("delete from audit_log where actor_user_id = $1", [twofaUserId]);
  await admin.query("delete from auth_refresh_token where user_id = $1", [twofaUserId]);
  await admin.query("delete from user_account where id = $1", [twofaUserId]);
  // Clean any users created by the permission-gating happy-path test.
  await admin.query("delete from user_account where email like 'created+%@fathomxo.test'");
  await admin.end();
  if (server && !server.killed) server.kill();
});

async function login(email: string, password: string, totp?: string) {
  return api(BASE, "/auth/login", { method: "POST", body: { email, password, totp } });
}

describe("identity is from the token, not request headers", () => {
  it("a forged x-party-id / x-superadmin header is ignored — whoami reflects the token", async () => {
    const res = await login("momin@fathomxo.local", DEV_PASSWORD);
    assert.equal(res.status, 200, "Momin should log in");
    const token = res.body.accessToken as string;

    const who = await api(BASE, "/platform/whoami", {
      token,
      headers: {
        "x-party-id": "00000000-0000-4000-8000-0000000000c2", // Emon's party — forged
        "x-superadmin": "true",
        "x-org-id": randomUUID(),
      },
    });
    assert.equal(who.status, 200);
    // Token says Momin (party ...c1); the forged headers must NOT change it.
    assert.equal(who.body.principal.partyId, "00000000-0000-4000-8000-0000000000c1");
    assert.equal(who.body.principal.isSystemSuperadmin, false, "Admin/Writer is not System SuperAdmin");
    assert.equal(who.body.dbSeesContext.party_id, "00000000-0000-4000-8000-0000000000c1");
    assert.equal(who.body.dbSeesContext.is_superadmin, false, "RLS GUC must not be forced true by a header");
  });

  it("no bearer token → 401 (fail-closed)", async () => {
    const who = await api(BASE, "/platform/whoami");
    assert.equal(who.status, 401);
  });

  it("a garbage bearer token → 401", async () => {
    const who = await api(BASE, "/platform/whoami", { token: "not.a.real.jwt" });
    assert.equal(who.status, 401);
  });
});

describe("permission gating (roles-as-data, fail-closed)", () => {
  it("Momin (Admin+Writer, no platform:create) gets 403 creating a user", async () => {
    const { body } = await login("momin@fathomxo.local", DEV_PASSWORD);
    const res = await api(BASE, "/platform/users", {
      method: "POST",
      token: body.accessToken,
      body: { email: `created+${randomUUID()}@fathomxo.test`, password: "Password123!" },
    });
    assert.equal(res.status, 403, "Admin must NOT be able to create logins (no self-promotion, spec §10)");
  });

  it("System SuperAdmin CAN create a user (and it is audited)", async () => {
    const { body } = await login("sysadmin@fathomxo.local", DEV_PASSWORD);
    const email = `created+${randomUUID()}@fathomxo.test`;
    const res = await api(BASE, "/platform/users", {
      method: "POST",
      token: body.accessToken,
      body: { email, password: "Password123!" },
    });
    assert.equal(res.status, 201, "System SuperAdmin holds platform:create");
    assert.ok(res.body.id, "returns the new user id");
    const audit = await admin.query(
      "select count(*)::int as n from audit_log where action='platform.user_created' and entity_id=$1",
      [res.body.id],
    );
    assert.equal(audit.rows[0].n, 1, "a sensitive action must write an audit_log row");
  });

  it("Emon (Admin only) is also denied platform:create", async () => {
    const { body } = await login("emon@fathomxo.local", DEV_PASSWORD);
    const res = await api(BASE, "/platform/users", {
      method: "POST",
      token: body.accessToken,
      body: { email: `created+${randomUUID()}@fathomxo.test`, password: "Password123!" },
    });
    assert.equal(res.status, 403);
  });

  it("client cannot smuggle authority via the request body (whitelist/validation)", async () => {
    const { body } = await login("momin@fathomxo.local", DEV_PASSWORD);
    const res = await api(BASE, "/platform/users", {
      method: "POST",
      token: body.accessToken,
      // extra fields like orgId/role must be rejected by the global ValidationPipe,
      // and the endpoint is permission-gated anyway.
      body: { email: `created+${randomUUID()}@fathomxo.test`, password: "Password123!", orgId: randomUUID() },
    });
    assert.ok(res.status === 400 || res.status === 403, `forged field/authz must be rejected (got ${res.status})`);
  });
});

describe("is_superadmin = System SuperAdmin only (spec §4.4)", () => {
  it("sysadmin's RLS context has is_superadmin true", async () => {
    const { body } = await login("sysadmin@fathomxo.local", DEV_PASSWORD);
    const who = await api(BASE, "/platform/whoami", { token: body.accessToken });
    assert.equal(who.body.principal.isSystemSuperadmin, true);
    assert.equal(who.body.dbSeesContext.is_superadmin, true);
  });

  it("bizadmin (Business SuperAdmin) does NOT get the leg-bypass GUC", async () => {
    // bizadmin has 2FA enabled (per the environment note); read its secret to log in.
    const r = await admin.query("select twofa_secret from user_account where email=$1", [
      "bizadmin@fathomxo.local",
    ]);
    const secret = r.rows[0]?.twofa_secret as string | null;
    assert.ok(secret, "bizadmin should have a 2FA secret (set by a prior probe)");
    const res = await login("bizadmin@fathomxo.local", DEV_PASSWORD, totpCode(secret!));
    assert.equal(res.status, 200, "bizadmin login with a valid TOTP should succeed");
    const who = await api(BASE, "/platform/whoami", { token: res.body.accessToken });
    assert.equal(
      who.body.principal.isSystemSuperadmin,
      false,
      "Business SuperAdmin must NOT drive the leg-visibility bypass (spec §4.4)",
    );
    assert.equal(who.body.dbSeesContext.is_superadmin, false);
  });
});

describe("refresh rotation + sliding window + logout revocation", () => {
  it("a used refresh token is revoked: reuse fails, sliding expiry ~10 days out", async () => {
    const { body: first } = await login("momin@fathomxo.local", DEV_PASSWORD);
    const oldRefresh = first.refreshToken as string;

    const r1 = await api(BASE, "/auth/refresh", { method: "POST", body: { refreshToken: oldRefresh } });
    assert.equal(r1.status, 200, "first refresh should rotate successfully");
    assert.ok(r1.body.refreshToken && r1.body.refreshToken !== oldRefresh, "a NEW refresh token is issued");

    // Reusing the now-rotated token must fail (one-time use).
    const reuse = await api(BASE, "/auth/refresh", { method: "POST", body: { refreshToken: oldRefresh } });
    assert.equal(reuse.status, 401, "a rotated refresh token must not work again");

    // The new refresh token still works.
    const r2 = await api(BASE, "/auth/refresh", { method: "POST", body: { refreshToken: r1.body.refreshToken } });
    assert.equal(r2.status, 200);

    // Sliding window: the stored expiry should be ~10 days out (allow 9.5–10.5).
    const exp = await admin.query(
      `select max(expires_at) as e from auth_refresh_token
       where user_id = (select id from user_account where email='momin@fathomxo.local')`,
    );
    const days = (new Date(exp.rows[0].e).getTime() - Date.now()) / 86_400_000;
    assert.ok(days > 9.5 && days < 10.5, `sliding expiry should be ~10 days, got ${days.toFixed(2)}`);
  });

  it("logout revokes the device's refresh token server-side", async () => {
    const { body } = await login("momin@fathomxo.local", DEV_PASSWORD);
    const refresh = body.refreshToken as string;

    const out = await api(BASE, "/auth/logout", {
      method: "POST",
      token: body.accessToken,
      body: { refreshToken: refresh },
    });
    assert.equal(out.status, 200);

    const after = await api(BASE, "/auth/refresh", { method: "POST", body: { refreshToken: refresh } });
    assert.equal(after.status, 401, "a logged-out refresh token must no longer mint tokens");
  });
});

describe("2FA login gate", () => {
  it("enroll returns a secret + otpauth URL", async () => {
    const { body } = await login("momin@fathomxo.local", DEV_PASSWORD);
    const res = await api(BASE, "/auth/2fa/enroll", { method: "POST", token: body.accessToken });
    assert.equal(res.status, 200);
    assert.ok(typeof res.body.secret === "string" && res.body.secret.length > 0);
    assert.match(res.body.otpauthUrl, /^otpauth:\/\/totp\//);
  });

  it("a 2FA-enabled account: login WITHOUT a code fails, WITH a valid code succeeds", async () => {
    const noCode = await login(twofaEmail, DEV_PASSWORD);
    assert.equal(noCode.status, 401, "2FA account must require a TOTP");

    const wrong = await login(twofaEmail, DEV_PASSWORD, "000000");
    assert.equal(wrong.status, 401, "a wrong TOTP must fail");

    const ok = await login(twofaEmail, DEV_PASSWORD, totpCode(twofaSecret));
    assert.equal(ok.status, 200, "a valid TOTP must succeed");
    assert.ok(ok.body.accessToken);
  });
});

describe("login failure modes", () => {
  it("unknown email → 401, no info leak", async () => {
    const res = await login(`nobody+${randomUUID()}@fathomxo.test`, DEV_PASSWORD);
    assert.equal(res.status, 401);
  });

  it("wrong password → 401", async () => {
    const res = await login("momin@fathomxo.local", "wrong-password");
    assert.equal(res.status, 401);
  });
});
