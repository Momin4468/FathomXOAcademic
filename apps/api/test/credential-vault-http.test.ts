import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { config } from "dotenv";
import pg from "pg";
import { authenticator } from "otplib";
import { api, waitForHealth } from "./helpers.js";

/**
 * Module 8 (credential vault) — BLACK-BOX HTTP against the COMPILED app
 * (dist/main.js). Proves the request-time guarantees (DESIGN_SPEC §8, CLAUDE.md §4):
 *   • secrets encrypted at rest — the ciphertext column never contains plaintext;
 *   • list is METADATA ONLY (never a secret/password);
 *   • per-item ACL holds over HTTP — a holder sees only their shared items;
 *   • reveal is holder-only (RLS 404) + 2FA-gated (403 no-2FA / 401 bad code) +
 *     audited, and the audit row never contains the plaintext;
 *   • revoke removes access (list + reveal);
 *   • authz: a Writer (view-only) cannot create/grant/manage;
 *   • boundary validation (bad enum, non-6-digit totp, non-uuid).
 * Requires FEATURE_CREDENTIAL_VAULT=true and a valid VAULT_ENCRYPTION_KEY.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3220; // dedicated test port
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const VAULT_KEY = randomBytes(32).toString("base64"); // AES-256 key for this run

const ORG = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // credential_vault:view only

const PLAINTEXT_PW = "s3cr3t";
const PLAINTEXT_NOTES = "x-very-secret-note";

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = "";
let mominToken = ""; // Admin (credential_vault:*)

let writerAToken = "";
let writerAUserId = "";
let writerAParty = "";
let writerBToken = "";
let writerBUserId = "";
let writerBParty = "";

const createdUserIds: string[] = [];
const createdPartyIds: string[] = [];
const createdItemIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      FEATURE_CREDENTIAL_VAULT: "true",
      VAULT_ENCRYPTION_KEY: VAULT_KEY,
    },
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
  const email = `vaultuser+${randomUUID()}@fathomxo.test`;
  const body: Record<string, unknown> = { email, password: DEV_PASSWORD };
  if (partyId) body.partyId = partyId;
  const created = await api(BASE, "/platform/users", { method: "POST", token: sysToken, body });
  assert.equal(created.status, 201, `user create should succeed (got ${created.status}: ${JSON.stringify(created.body)})`);
  const userId = created.body.id as string;
  createdUserIds.push(userId);
  const assigned = await api(BASE, `/platform/users/${userId}/roles`, {
    method: "POST",
    token: sysToken,
    body: { roleId },
  });
  assert.equal(assigned.status, 201, `role assign should succeed (got ${assigned.status})`);
  const li = await login(email, DEV_PASSWORD);
  assert.equal(li.status, 200, "the new user should log in");
  return { token: li.body.accessToken as string, userId };
}

async function makeParty(name: string): Promise<string> {
  const id = randomUUID();
  await admin.query(
    "insert into party (id, org_id, display_name, party_type) values ($1,$2,$3,'{writer}')",
    [id, ORG, name],
  );
  createdPartyIds.push(id);
  return id;
}

/** Enrol a known 2FA secret for a user via the admin client; return the secret. */
async function enrol2fa(userId: string): Promise<string> {
  const secret = authenticator.generateSecret();
  await admin.query("update user_account set twofa_secret=$1 where id=$2", [secret, userId]);
  return secret;
}

async function createItem(token: string, name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await api(BASE, "/vault/items", {
    method: "POST",
    token,
    body: { name, type: "tool", username: "acx", password: PLAINTEXT_PW, notes: PLAINTEXT_NOTES, ...extra },
  });
  assert.equal(res.status, 201, `item create should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
  createdItemIds.push(res.body.id);
  return res.body.id as string;
}

let item1 = "";
let item2 = "";
let item3 = "";

before(async () => {
  await admin.connect();
  await startServer();

  const s = await login("sysadmin@fathomxo.local", DEV_PASSWORD);
  assert.equal(s.status, 200, "sysadmin should log in");
  sysToken = s.body.accessToken;

  const m = await login("momin@fathomxo.local", DEV_PASSWORD);
  assert.equal(m.status, 200, "momin should log in");
  mominToken = m.body.accessToken;

  writerAParty = await makeParty("VAULT WriterA");
  writerBParty = await makeParty("VAULT WriterB");
  ({ token: writerAToken, userId: writerAUserId } = await makeUserWithRole(WRITER_ROLE, writerAParty));
  ({ token: writerBToken, userId: writerBUserId } = await makeUserWithRole(WRITER_ROLE, writerBParty));
});

after(async () => {
  for (const id of createdItemIds) {
    await admin.query("delete from credential_share where credential_id=$1", [id]);
    await admin.query("delete from audit_log where entity_id=$1", [id]);
    await admin.query("delete from credential_vault_item where id=$1", [id]);
  }
  for (const id of createdUserIds) {
    await admin.query("delete from audit_log where actor_user_id=$1", [id]);
    await admin.query("delete from auth_refresh_token where user_id=$1", [id]);
    await admin.query("delete from user_role where user_id=$1", [id]);
    await admin.query("delete from user_account where id=$1", [id]);
  }
  for (const id of createdPartyIds) {
    await admin.query("delete from credential_share where party_id=$1", [id]);
    await admin.query("delete from party where id=$1", [id]);
  }
  await admin.end();
  if (server && !server.killed) server.kill();
});

// ─── 1. Create (admin) ───────────────────────────────────────────────────────

describe("create — admin POST /vault/items", () => {
  it("creates 3 items → 201 {id}", async () => {
    item1 = await createItem(mominToken, "AcademyCX #1");
    item2 = await createItem(mominToken, "AcademyCX #2");
    item3 = await createItem(mominToken, "AcademyCX #3");
    assert.ok(item1 && item2 && item3);
  });
});

// ─── 2. Encryption at rest (the crux) ────────────────────────────────────────

describe("🔴 secrets encrypted at rest — no plaintext in the DB", () => {
  it("the ciphertext column does NOT contain the plaintext password/notes", async () => {
    const r = await admin.query(
      "select secret_ciphertext, secret_iv, secret_tag from credential_vault_item where id=$1",
      [item1],
    );
    const row = r.rows[0];
    assert.ok(row, "the row exists");
    assert.ok(!row.secret_ciphertext.includes(PLAINTEXT_PW), "ciphertext must not contain the password");
    assert.ok(!row.secret_ciphertext.includes(PLAINTEXT_NOTES), "ciphertext must not contain the notes");
    assert.notEqual(row.secret_ciphertext, PLAINTEXT_PW);
    assert.ok(row.secret_iv && row.secret_tag, "iv + auth tag are present (GCM)");
    // base64-shaped ciphertext (no raw plaintext)
    assert.match(row.secret_ciphertext, /^[A-Za-z0-9+/]+=*$/, "ciphertext is base64");
  });
});

// ─── 3. Grant + per-item ACL over HTTP + metadata-only list ──────────────────

describe("🔴 per-item ACL over HTTP + metadata-only listing", () => {
  it("admin grants WriterA {item1,item2} and WriterB {item1,item2,item3}", async () => {
    for (const id of [item1, item2]) {
      const g = await api(BASE, `/vault/items/${id}/shares`, { method: "POST", token: mominToken, body: { partyId: writerAParty } });
      assert.equal(g.status, 201, `grant A should succeed (got ${g.status}: ${JSON.stringify(g.body)})`);
    }
    for (const id of [item1, item2, item3]) {
      const g = await api(BASE, `/vault/items/${id}/shares`, { method: "POST", token: mominToken, body: { partyId: writerBParty } });
      assert.equal(g.status, 201, `grant B should succeed (got ${g.status}: ${JSON.stringify(g.body)})`);
    }
  });

  it("WriterA GET /vault/items → exactly the 2 shared items", async () => {
    const res = await api(BASE, "/vault/items", { token: writerAToken });
    assert.equal(res.status, 200);
    const ids = (res.body as Array<{ id: string }>).map((i) => i.id);
    assert.deepEqual(new Set(ids), new Set([item1, item2]), `WriterA should see only item1,item2 (got ${JSON.stringify(ids)})`);
  });

  it("WriterB GET /vault/items → exactly the 3 shared items", async () => {
    const res = await api(BASE, "/vault/items", { token: writerBToken });
    assert.equal(res.status, 200);
    const ids = (res.body as Array<{ id: string }>).map((i) => i.id);
    assert.deepEqual(new Set(ids), new Set([item1, item2, item3]));
  });

  it("the list rows carry NO secret/password/ciphertext field (metadata only)", async () => {
    const res = await api(BASE, "/vault/items", { token: writerBToken });
    for (const row of res.body as Array<Record<string, unknown>>) {
      assert.ok(!("secret" in row), "no secret bundle in list");
      assert.ok(!("password" in row), "no password in list");
      assert.ok(!("secretCiphertext" in row) && !("secret_ciphertext" in row), "no ciphertext in list");
      assert.ok(!("username" in row), "no username in list");
    }
  });
});

// ─── 4. Reveal happy path (holder + valid current TOTP) ──────────────────────

describe("🔴 reveal — holder + valid current TOTP returns the secret", () => {
  it("WriterA (2FA enrolled) reveal item1 returns the real decrypted secret", async () => {
    const secret = await enrol2fa(writerAUserId);
    const res = await api(BASE, `/vault/items/${item1}/reveal`, {
      method: "POST",
      token: writerAToken,
      body: { totp: authenticator.generate(secret) },
    });
    assert.ok(res.status >= 200 && res.status < 300, `reveal should be a 2xx (got ${res.status}: ${JSON.stringify(res.body)})`);
    // The security-critical guarantee: the secret decrypts and round-trips.
    assert.equal(res.body.secret.password, PLAINTEXT_PW, "the decrypted password round-trips");
    assert.equal(res.body.secret.notes, PLAINTEXT_NOTES);
    assert.equal(res.body.id, item1);
  });

  // CONTRACT (DESIGN_SPEC §8): reveal is a read action and MUST return 200, not
  // 201 Created (no resource is created). Pinned to the spec — fails loudly if the
  // controller keeps NestJS's default POST 201.
  it("reveal returns HTTP 200 per the spec (not 201 Created)", async () => {
    const secret = await enrol2fa(writerAUserId);
    // Retry once if we land on a 30s TOTP boundary (401), so the status compare is deterministic.
    let res = await api(BASE, `/vault/items/${item1}/reveal`, {
      method: "POST",
      token: writerAToken,
      body: { totp: authenticator.generate(secret) },
    });
    if (res.status === 401) {
      res = await api(BASE, `/vault/items/${item1}/reveal`, {
        method: "POST",
        token: writerAToken,
        body: { totp: authenticator.generate(secret) },
      });
    }
    assert.equal(res.status, 200, `reveal must return 200 per spec (got ${res.status}) — controller lacks @HttpCode(200)`);
  });
});

// ─── 5. Reveal denials ───────────────────────────────────────────────────────

describe("reveal denials — wrong code / no 2FA / not a holder", () => {
  it("WriterA reveal with a WRONG totp → 401", async () => {
    const secret = await enrol2fa(writerAUserId);
    const valid = authenticator.generate(secret);
    let wrong = "000000";
    if (wrong === valid) wrong = "111111";
    const res = await api(BASE, `/vault/items/${item1}/reveal`, {
      method: "POST",
      token: writerAToken,
      body: { totp: wrong },
    });
    assert.equal(res.status, 401, `a wrong totp must be rejected (got ${res.status})`);
  });

  it("WriterB (no 2FA enrolled) reveal → 403", async () => {
    // ensure WriterB has no 2FA secret
    await admin.query("update user_account set twofa_secret=null where id=$1", [writerBUserId]);
    const res = await api(BASE, `/vault/items/${item1}/reveal`, {
      method: "POST",
      token: writerBToken,
      body: { totp: "123456" },
    });
    assert.equal(res.status, 403, `no-2FA must be forbidden, not unauthorized (got ${res.status})`);
  });

  it("🔴 WriterA reveal an item NOT shared to them (item3) → 404 (RLS opacity)", async () => {
    const secret = await enrol2fa(writerAUserId);
    const res = await api(BASE, `/vault/items/${item3}/reveal`, {
      method: "POST",
      token: writerAToken,
      body: { totp: authenticator.generate(secret) },
    });
    assert.equal(res.status, 404, `a non-holder must get 404 (zero rows), got ${res.status}`);
  });
});

// ─── 6. Audit (success is recorded; no plaintext in the audit detail) ────────

describe("🔴 reveal is audited — and the audit row holds no plaintext", () => {
  it("a successful reveal of item1 wrote vault.secret_revealed with no secret in detail", async () => {
    // perform a fresh successful reveal to be sure the row exists
    const secret = await enrol2fa(writerAUserId);
    const ok = await api(BASE, `/vault/items/${item1}/reveal`, {
      method: "POST",
      token: writerAToken,
      body: { totp: authenticator.generate(secret) },
    });
    assert.ok(ok.status >= 200 && ok.status < 300, `reveal should be 2xx (got ${ok.status})`);

    const r = await admin.query(
      "select detail_json from audit_log where action='vault.secret_revealed' and entity_id=$1 order by at desc limit 1",
      [item1],
    );
    assert.ok(r.rows.length === 1, "an audit row for the reveal exists");
    const detail = JSON.stringify(r.rows[0].detail_json ?? {});
    assert.ok(!detail.includes(PLAINTEXT_PW), "audit detail must not contain the password");
    assert.ok(!detail.includes(PLAINTEXT_NOTES), "audit detail must not contain the notes");
  });
});

// ─── 7. Revoke removes access ────────────────────────────────────────────────

describe("revoke removes access — list + reveal", () => {
  it("admin revokes WriterA's item1 share; WriterA no longer lists or can reveal item1", async () => {
    // find the share id for (item1, writerA)
    const shares = await api(BASE, `/vault/items/${item1}/shares`, { token: mominToken });
    assert.equal(shares.status, 200);
    // share id isn't returned by manageShares (party-level) — fetch directly.
    const sr = await admin.query(
      "select id from credential_share where credential_id=$1 and party_id=$2 and revoked_at is null",
      [item1, writerAParty],
    );
    assert.ok(sr.rows.length === 1, "an active share exists to revoke");
    const shareId = sr.rows[0].id;

    const rev = await api(BASE, `/vault/shares/${shareId}/revoke`, { method: "POST", token: mominToken });
    assert.equal(rev.status, 201, `revoke should succeed (got ${rev.status}: ${JSON.stringify(rev.body)})`);

    const list = await api(BASE, "/vault/items", { token: writerAToken });
    const ids = (list.body as Array<{ id: string }>).map((i) => i.id);
    assert.ok(!ids.includes(item1), "item1 dropped from WriterA's list after revoke");

    const secret = await enrol2fa(writerAUserId);
    const reveal = await api(BASE, `/vault/items/${item1}/reveal`, {
      method: "POST",
      token: writerAToken,
      body: { totp: authenticator.generate(secret) },
    });
    assert.equal(reveal.status, 404, "a revoked holder must get 404 on reveal");
  });
});

// ─── 8. Authz — a view-only Writer cannot create/grant/manage ────────────────

describe("🔴 authz — Writer (credential_vault:view only) cannot create/grant/manage", () => {
  it("Writer POST /vault/items (create) → 403", async () => {
    const res = await api(BASE, "/vault/items", {
      method: "POST",
      token: writerBToken,
      body: { name: "nope", type: "tool", password: "p" },
    });
    assert.equal(res.status, 403, "credential_vault:create is required");
  });

  it("Writer POST /vault/items/:id/shares (grant) → 403", async () => {
    const res = await api(BASE, `/vault/items/${item2}/shares`, {
      method: "POST",
      token: writerBToken,
      body: { partyId: writerAParty },
    });
    assert.equal(res.status, 403, "credential_vault:approve is required to grant");
  });

  it("Writer GET /vault/manage/items → 403", async () => {
    const res = await api(BASE, "/vault/manage/items", { token: writerBToken });
    assert.equal(res.status, 403, "credential_vault:approve is required for manage list");
  });
});

// ─── 9. Boundary validation ──────────────────────────────────────────────────

describe("boundary validation (treat client input as hostile, CLAUDE.md §4)", () => {
  it("POST /vault/items with type not in enum → 400", async () => {
    const res = await api(BASE, "/vault/items", {
      method: "POST",
      token: mominToken,
      body: { name: "bad", type: "hackertype", password: "p" },
    });
    assert.equal(res.status, 400, "an out-of-enum type must be rejected");
  });

  it("POST /vault/items/:id/reveal with a non-6-digit totp → 400", async () => {
    const res = await api(BASE, `/vault/items/${item1}/reveal`, {
      method: "POST",
      token: writerAToken,
      body: { totp: "12345" },
    });
    assert.equal(res.status, 400, "totp must be exactly 6 digits");
  });

  it("reveal with a non-uuid id → 400 (ParseUUIDPipe)", async () => {
    const res = await api(BASE, "/vault/items/not-a-uuid/reveal", {
      method: "POST",
      token: writerAToken,
      body: { totp: "123456" },
    });
    assert.equal(res.status, 400);
  });
});
