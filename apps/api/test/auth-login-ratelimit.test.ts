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
import { api, waitForHealth } from "./helpers.js";

/**
 * Login brute-force rate limiting (CLAUDE.md §4). BLACK-BOX HTTP against the
 * COMPILED app, spawned with LOW limits so the thresholds are cheap to reach:
 *   AUTH_LOGIN_RATE_MAX=3     — per (IP + email)
 *   AUTH_LOGIN_IP_RATE_MAX=5  — broader per IP
 * The perceived client IP is driven by the X-Forwarded-For header (clientIpOf
 * reads the first hop), so one process can simulate many IPs. Proves: under the
 * limit succeeds; over the limit returns a generic 429; and neither a different IP
 * nor a different email is blocked by another's attempts.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3252; // dedicated test port
const BASE = `http://localhost:${PORT}`;
const PASSWORD = "Password123!";
const IPEMAIL_MAX = 3;
const IP_MAX = 5;
const ORG = "00000000-0000-4000-8000-000000000001";

const userId = randomUUID();
const email = `ratelimit+${randomUUID()}@fathomxo.test`;

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

/** One login attempt from a given (simulated) IP via X-Forwarded-For. */
function attempt(loginEmail: string, password: string, ip: string) {
  return api(BASE, "/auth/login", { method: "POST", body: { email: loginEmail, password }, headers: { "x-forwarded-for": ip } });
}

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      AUTH_LOGIN_RATE_MAX: String(IPEMAIL_MAX),
      AUTH_LOGIN_IP_RATE_MAX: String(IP_MAX),
      AUTH_LOGIN_RATE_WINDOW_MS: String(15 * 60 * 1000), // long window: never resets mid-test
    },
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
  const hash = await bcrypt.hash(PASSWORD, 12);
  await admin.query(
    `insert into user_account (id, org_id, email, password_hash, status) values ($1,$2,$3,$4,'active')`,
    [userId, ORG, email, hash],
  );
  await startServer();
});

after(async () => {
  await admin.query("delete from audit_log where actor_user_id = $1", [userId]);
  await admin.query("delete from auth_refresh_token where user_id = $1", [userId]);
  await admin.query("delete from user_account where id = $1", [userId]);
  await admin.end();
  if (server && !server.killed) server.kill();
});

describe("login rate limit — per (IP + email)", () => {
  it("a valid login under the limit succeeds (200)", async () => {
    const res = await attempt(email, PASSWORD, "10.1.0.1");
    assert.equal(res.status, 200, `valid creds under the limit should log in (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.ok(res.body.accessToken, "returns a token");
  });

  it("wrong-password attempts under the limit return 401 (not 429), then the next is a generic 429", async () => {
    const ip = "10.2.0.1";
    for (let i = 0; i < IPEMAIL_MAX; i++) {
      const r = await attempt(email, "wrong-password", ip);
      assert.equal(r.status, 401, `attempt ${i + 1} is under the limit → 401 (got ${r.status})`);
    }
    const over = await attempt(email, "wrong-password", ip);
    assert.equal(over.status, 429, `attempt ${IPEMAIL_MAX + 1} exceeds the per-(IP+email) limit → 429 (got ${over.status})`);
    // Generic message — must not reveal whether the email exists.
    const msg = Array.isArray(over.body?.message) ? over.body.message.join(" ") : String(over.body?.message ?? "");
    assert.match(msg, /too many/i, "429 carries a generic 'too many attempts' message");
    assert.ok(!msg.toLowerCase().includes(email.toLowerCase()), "429 message does not echo the email");
    assert.ok(!/exist|not found|unknown|invalid cred/i.test(msg), "429 message reveals nothing about the account");
  });

  it("a DIFFERENT email from the same IP is not blocked by the first email's limit", async () => {
    const ip = "10.3.0.1";
    // Exhaust the per-(IP+email) budget for `email` on this IP.
    for (let i = 0; i < IPEMAIL_MAX; i++) await attempt(email, "wrong-password", ip);
    assert.equal((await attempt(email, "wrong-password", ip)).status, 429, "first email is now limited on this IP");
    // A different email on the SAME IP still gets through (its own IP+email bucket).
    const other = await attempt(`other+${randomUUID()}@fathomxo.test`, "whatever", ip);
    assert.notEqual(other.status, 429, `a different email on the same IP is not blocked (got ${other.status})`);
    assert.equal(other.status, 401, "unknown email → 401, not rate-limited");
  });

  it("a DIFFERENT IP is not blocked by another IP's attempts on the same email", async () => {
    // `email` has been hammered on 10.2.0.1 / 10.3.0.1 above; a fresh IP is unaffected.
    const fresh = await attempt(email, "wrong-password", "10.4.0.1");
    assert.equal(fresh.status, 401, `a fresh IP is not rate-limited by other IPs' attempts (got ${fresh.status})`);
  });
});

describe("login rate limit — broader per-IP layer (credential stuffing)", () => {
  it("spreading attempts across many emails still trips the per-IP limit; a different IP is unaffected", async () => {
    const ip = "10.9.0.1";
    // 3 emails × 2 attempts = 6 from one IP. No single (IP+email) reaches 3, but the
    // IP total exceeds IP_MAX=5, so the 6th is 429 from the per-IP layer.
    const emails = [`s1+${randomUUID()}@x.test`, `s2+${randomUUID()}@x.test`, `s3+${randomUUID()}@x.test`];
    const statuses: number[] = [];
    for (const e of emails) {
      for (let i = 0; i < 2; i++) statuses.push((await attempt(e, "wrong-password", ip)).status);
    }
    assert.equal(statuses.slice(0, IP_MAX).every((s) => s === 401), true, `the first ${IP_MAX} attempts are under the per-IP limit → 401 (${statuses})`);
    assert.equal(statuses[IP_MAX], 429, `attempt ${IP_MAX + 1} across emails trips the per-IP limit → 429 (${statuses})`);

    // A different IP is unaffected by the stuffing source.
    const otherIp = await attempt(`s9+${randomUUID()}@x.test`, "wrong-password", "10.9.0.2");
    assert.notEqual(otherIp.status, 429, `a different IP is not blocked by the stuffing IP (got ${otherIp.status})`);
  });
});
