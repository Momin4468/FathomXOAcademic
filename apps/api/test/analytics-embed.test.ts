import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { config } from "dotenv";
import pg from "pg";
import { api, waitForHealth } from "./helpers.js";

/**
 * Migration 0029 (analytics/BI plane, §8) — BLACK-BOX HTTP tests for the signed
 * Metabase embed endpoint GET /analytics/embed against the COMPILED app
 * (dist/main.js). Proves the role-scope LOCK that must never break:
 *   • an analytics approver (owner) → owner dashboard, locked org_id ONLY.
 *   • a party-linked non-approver (member) → member dashboard, locked org_id +
 *     their OWN party_id. A writer can never obtain the owner dashboard/scope.
 *   • a no-party non-approver → 404 (nothing to show).
 *   • the embed token is genuinely HS256-signed with METABASE_EMBED_SECRET
 *     (recomputing the sig with the right secret matches; a wrong secret does not).
 *   • unauthenticated → 401; and with the embed env UNSET the endpoint fails
 *     CLOSED (404, "not configured").
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3229; // dedicated test port
const PORT_UNSET = 3230; // second spawn with embed env unset
const BASE = `http://localhost:${PORT}`;
const BASE_UNSET = `http://localhost:${PORT_UNSET}`;
const DEV_PASSWORD = "Password123!";

const ORG = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // dashboard:view, NO approve

const EMBED_SECRET = "test_embed_secret_at_least_32_chars_long_xx"; // >= 32 chars
const OWNER_DASHBOARD = 7;
const MEMBER_DASHBOARD = 9;

const mainJs = resolve(apiRoot, "dist", "main.js");

const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let server: ChildProcess;
let serverUnset: ChildProcess;

let sysToken = ""; // System SuperAdmin — owner, canAdhoc
let mominToken = ""; // Admin (dashboard:approve) — owner, no adhoc
let memberToken = ""; // a party-linked Writer (non-approver) — member scope
let noPartyToken = ""; // a Writer with NO party (non-approver) — 404
let memberPartyId = ""; // the member writer's own party

const createdUserIds: string[] = [];
const createdPartyIds: string[] = [];

function spawnServer(port: number, withEmbedEnv: boolean): ChildProcess {
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  const embedEnv = withEmbedEnv
    ? {
        METABASE_SITE_URL: "http://localhost:3000",
        METABASE_EMBED_SECRET: EMBED_SECRET,
        METABASE_DASHBOARD_OWNER: String(OWNER_DASHBOARD),
        METABASE_DASHBOARD_MEMBER: String(MEMBER_DASHBOARD),
      }
    : {};
  const child = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(port),
      FEATURE_DASHBOARD: "true",
      ...embedEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr?.on("data", (d) => {
    const s = String(d);
    if (/error/i.test(s)) process.stderr.write(`[api:${port}] ${s}`);
  });
  return child;
}

async function login(base: string, email: string, password: string) {
  return api(base, "/auth/login", { method: "POST", body: { email, password } });
}

/** Create a login (sysadmin), optionally link a party, assign one role, log in. */
async function makeUserWithRole(roleId: string, partyId?: string): Promise<{ token: string; userId: string }> {
  const email = `m0029+${randomUUID()}@fathomxo.test`;
  const body: Record<string, unknown> = { email, password: DEV_PASSWORD };
  if (partyId) body.partyId = partyId;
  const created = await api(BASE, "/platform/users", { method: "POST", token: sysToken, body });
  assert.equal(created.status, 201, `user create should succeed (got ${created.status}: ${JSON.stringify(created.body)})`);
  const userId = created.body.id as string;
  createdUserIds.push(userId);
  const assigned = await api(BASE, `/platform/users/${userId}/roles`, { method: "POST", token: sysToken, body: { roleId } });
  assert.equal(assigned.status, 201, `role assign should succeed (got ${assigned.status})`);
  const li = await login(BASE, email, DEV_PASSWORD);
  assert.equal(li.status, 200, "the new user should log in");
  return { token: li.body.accessToken as string, userId };
}

async function makeParty(name: string, type: string): Promise<string> {
  const id = randomUUID();
  await admin.query("insert into party (id, org_id, display_name, party_type) values ($1,$2,$3,$4)", [id, ORG, name, `{${type}}`]);
  createdPartyIds.push(id);
  return id;
}

// ── JWT helpers (decode + verify the Metabase HS256 embed token) ───────────────

function b64urlDecode(seg: string): Buffer {
  const pad = seg.length % 4 === 0 ? "" : "=".repeat(4 - (seg.length % 4));
  return Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Extract the JWT from an embed URL like `.../embed/dashboard/<jwt>#bordered=...`. */
function tokenFromUrl(url: string): string {
  const m = url.match(/\/embed\/dashboard\/([^#?]+)/);
  assert.ok(m, `embed url must contain /embed/dashboard/<token>: ${url}`);
  return m![1];
}

function recomputeSig(token: string, secret: string): string {
  const [header, payload] = token.split(".");
  return b64url(createHmac("sha256", secret).update(`${header}.${payload}`).digest());
}

function decodePayload(token: string): any {
  const [, payload] = token.split(".");
  return JSON.parse(b64urlDecode(payload).toString("utf8"));
}

before(async () => {
  await admin.connect();
  server = spawnServer(PORT, true);
  await waitForHealth(BASE);

  const s = await login(BASE, "sysadmin@fathomxo.local", DEV_PASSWORD);
  assert.equal(s.status, 200);
  sysToken = s.body.accessToken;

  const m = await login(BASE, "momin@fathomxo.local", DEV_PASSWORD);
  assert.equal(m.status, 200);
  mominToken = m.body.accessToken;

  // A party-linked non-approver (the MEMBER path).
  memberPartyId = await makeParty("M0029 MemberWriter", "writer");
  ({ token: memberToken } = await makeUserWithRole(WRITER_ROLE, memberPartyId));

  // A no-party non-approver (must 404 from the embed endpoint).
  ({ token: noPartyToken } = await makeUserWithRole(WRITER_ROLE));
});

after(async () => {
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
  if (serverUnset && !serverUnset.killed) serverUnset.kill();
});

// ── owner scope (approver) ─────────────────────────────────────────────────────

describe("GET /analytics/embed — owner scope (analytics approver)", () => {
  it("momin (approver) → 200, scope:'owner', owner dashboard, org_id-only locked params", async () => {
    const res = await api(BASE, "/analytics/embed", { token: mominToken });
    assert.equal(res.status, 200, `approver should get an embed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.scope, "owner", "an approver gets the owner scope");
    assert.ok(typeof res.body.url === "string" && res.body.url.includes("/embed/dashboard/"), "url is a Metabase embed url");

    const token = tokenFromUrl(res.body.url);
    const payload = decodePayload(token);
    assert.equal(payload.resource.dashboard, OWNER_DASHBOARD, "owner dashboard id is locked into the token");
    assert.deepEqual(Object.keys(payload.params).sort(), ["org_id"], "owner params lock org_id ONLY (no party_id)");
    assert.equal(payload.params.org_id, ORG, "org_id is the viewer's org");
    assert.equal(payload.params.party_id, undefined, "an owner token must NOT carry party_id");
    assert.ok(payload.exp * 1000 > Date.now(), "exp is in the future");

    // The token is genuinely signed with the test secret.
    assert.equal(recomputeSig(token, EMBED_SECRET), token.split(".")[2], "HS256 sig matches the embed secret");
  });

  it("sysadmin (System SuperAdmin) → scope:'owner', canAdhoc:true, adhocUrl present", async () => {
    const res = await api(BASE, "/analytics/embed", { token: sysToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.scope, "owner");
    assert.equal(res.body.canAdhoc, true, "the System SuperAdmin gets the ad-hoc explorer");
    assert.ok(typeof res.body.adhocUrl === "string" && res.body.adhocUrl.length > 0, "adhocUrl is present");
  });
});

// ── member scope (party-linked non-approver) ───────────────────────────────────

describe("GET /analytics/embed — member scope (party-linked non-approver)", () => {
  it("a Writer → scope:'member', member dashboard, locked org_id + their OWN party_id, no adhoc", async () => {
    const res = await api(BASE, "/analytics/embed", { token: memberToken });
    assert.equal(res.status, 200, `a party-linked member should get an embed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.scope, "member", "a non-approver gets the member scope");
    assert.equal(res.body.canAdhoc, false, "a member never gets ad-hoc");

    const token = tokenFromUrl(res.body.url);
    const payload = decodePayload(token);
    assert.equal(payload.resource.dashboard, MEMBER_DASHBOARD, "member dashboard id is locked");
    assert.deepEqual(Object.keys(payload.params).sort(), ["org_id", "party_id"], "member params lock BOTH org_id and party_id");
    assert.equal(payload.params.org_id, ORG, "org_id is the viewer's org");
    assert.equal(payload.params.party_id, memberPartyId, "party_id is locked to the member's OWN party (self-scope)");
    assert.equal(recomputeSig(token, EMBED_SECRET), token.split(".")[2], "HS256 sig matches");
  });

  it("🔴 a Writer can NOT obtain the owner dashboard or owner scope", async () => {
    const res = await api(BASE, "/analytics/embed", { token: memberToken });
    assert.notEqual(res.body.scope, "owner", "a writer must never get owner scope");
    const payload = decodePayload(tokenFromUrl(res.body.url));
    assert.notEqual(payload.resource.dashboard, OWNER_DASHBOARD, "a writer must never get the owner dashboard id");
  });

  it("a no-party non-approver → 404 (nothing to show)", async () => {
    const res = await api(BASE, "/analytics/embed", { token: noPartyToken });
    assert.equal(res.status, 404, `a no-party non-approver gets 404 (got ${res.status}: ${JSON.stringify(res.body)})`);
  });
});

// ── signature integrity + auth ─────────────────────────────────────────────────

describe("GET /analytics/embed — signature integrity & auth", () => {
  it("recomputing the sig with a WRONG secret does NOT match (proves it is actually signed)", async () => {
    const res = await api(BASE, "/analytics/embed", { token: mominToken });
    const token = tokenFromUrl(res.body.url);
    const realSig = token.split(".")[2];
    assert.notEqual(recomputeSig(token, "the_wrong_secret_also_32_chars_long_yyyy"), realSig, "a wrong secret must not verify");
    assert.equal(recomputeSig(token, EMBED_SECRET), realSig, "the right secret verifies");
  });

  it("unauthenticated (no token) → 401", async () => {
    const res = await api(BASE, "/analytics/embed", {});
    assert.equal(res.status, 401, `no token must be rejected (got ${res.status})`);
  });
});

// ── fails closed when not configured ───────────────────────────────────────────

describe("GET /analytics/embed — fails closed when the embed env is UNSET", () => {
  before(async () => {
    serverUnset = spawnServer(PORT_UNSET, false);
    await waitForHealth(BASE_UNSET);
  });

  it("with no METABASE_EMBED_SECRET → 404 (not configured), even for an owner", async () => {
    const s = await login(BASE_UNSET, "sysadmin@fathomxo.local", DEV_PASSWORD);
    assert.equal(s.status, 200);
    const res = await api(BASE_UNSET, "/analytics/embed", { token: s.body.accessToken });
    assert.equal(res.status, 404, `unconfigured analytics must fail closed with 404 (got ${res.status}: ${JSON.stringify(res.body)})`);
  });
});
