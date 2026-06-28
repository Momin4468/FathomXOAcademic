import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { config } from "dotenv";
import pg from "pg";
import { api, waitForHealth } from "./helpers.js";

/**
 * Vault list `clientPartyId` filter — BLACK-BOX HTTP against the COMPILED app
 * (dist/main.js). Proves GET /vault/items?clientPartyId=X narrows the caller's
 * RLS-scoped (held) items to one client, and — the crux — that the filter is a
 * narrowing of what the caller already holds, NEVER a way to surface another
 * party's items the caller does not hold (no per-item ACL bypass via the filter).
 * Requires FEATURE_CREDENTIAL_VAULT=true and a VAULT_ENCRYPTION_KEY.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3232; // dedicated test port
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const VAULT_KEY = randomBytes(32).toString("base64");

const ORG = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // credential_vault:view only

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = "";
let mominToken = ""; // Admin (credential_vault:*), party c1 — auto-holds what it creates

let writerAToken = "";
let writerAParty = "";
let writerBToken = "";
let writerBParty = "";

const createdUserIds: string[] = [];
const createdPartyIds: string[] = [];
const createdItemIds: string[] = [];

let clientA = "";
let clientB = "";

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
  const email = `vcf+${randomUUID()}@fathomxo.test`;
  const body: Record<string, unknown> = { email, password: DEV_PASSWORD };
  if (partyId) body.partyId = partyId;
  const created = await api(BASE, "/platform/users", { method: "POST", token: sysToken, body });
  assert.equal(created.status, 201, `user create should succeed (got ${created.status}: ${JSON.stringify(created.body)})`);
  const userId = created.body.id as string;
  createdUserIds.push(userId);
  const assigned = await api(BASE, `/platform/users/${userId}/roles`, { method: "POST", token: sysToken, body: { roleId } });
  assert.equal(assigned.status, 201, `role assign should succeed (got ${assigned.status})`);
  const li = await login(email, DEV_PASSWORD);
  assert.equal(li.status, 200, "the new user should log in");
  return { token: li.body.accessToken as string, userId };
}

async function makeParty(name: string, type = "client"): Promise<string> {
  const id = randomUUID();
  await admin.query(
    "insert into party (id, org_id, display_name, party_type) values ($1,$2,$3,$4)",
    [id, ORG, name, `{${type}}`],
  );
  createdPartyIds.push(id);
  return id;
}

/** Create an item as `token`; the creator auto-holds it. */
async function createItem(token: string, name: string, clientPartyId?: string): Promise<string> {
  const body: Record<string, unknown> = { name, type: "tool", password: "p" };
  if (clientPartyId) body.clientPartyId = clientPartyId;
  const res = await api(BASE, "/vault/items", { method: "POST", token, body });
  assert.equal(res.status, 201, `item create should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
  createdItemIds.push(res.body.id);
  return res.body.id as string;
}

let mominItemA1 = "";
let mominItemA2 = "";
let mominItemB = "";
let mominItemNoClient = "";
let writerAItemA = "";

before(async () => {
  await admin.connect();
  await startServer();

  const s = await login("sysadmin@fathomxo.local", DEV_PASSWORD);
  assert.equal(s.status, 200);
  sysToken = s.body.accessToken;
  const m = await login("momin@fathomxo.local", DEV_PASSWORD);
  assert.equal(m.status, 200);
  mominToken = m.body.accessToken;

  clientA = await makeParty("VCF Client A");
  clientB = await makeParty("VCF Client B");
  writerAParty = await makeParty("VCF WriterA", "writer");
  writerBParty = await makeParty("VCF WriterB", "writer");
  ({ token: writerAToken } = await makeUserWithRole(WRITER_ROLE, writerAParty));
  ({ token: writerBToken } = await makeUserWithRole(WRITER_ROLE, writerBParty));
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

describe("vault list clientPartyId filter — narrows the caller's held items", () => {
  it("seed: momin (auto-holder) creates 2×clientA, 1×clientB, 1×no-client items", async () => {
    mominItemA1 = await createItem(mominToken, "VCF momA1", clientA);
    mominItemA2 = await createItem(mominToken, "VCF momA2", clientA);
    mominItemB = await createItem(mominToken, "VCF momB", clientB);
    mominItemNoClient = await createItem(mominToken, "VCF momNone");
    assert.ok(mominItemA1 && mominItemA2 && mominItemB && mominItemNoClient);
  });

  it("momin ?clientPartyId=A → exactly the two A items he holds (B + no-client excluded)", async () => {
    const res = await api(BASE, `/vault/items?clientPartyId=${clientA}`, { token: mominToken });
    assert.equal(res.status, 200);
    const ids = (res.body as Array<{ id: string; clientPartyId: string }>);
    const idSet = new Set(ids.map((i) => i.id));
    assert.ok(idSet.has(mominItemA1) && idSet.has(mominItemA2), "both A items present");
    assert.ok(!idSet.has(mominItemB), "the B item is excluded");
    assert.ok(!idSet.has(mominItemNoClient), "the no-client item is excluded");
    for (const row of ids) assert.equal(row.clientPartyId, clientA, "every row is scoped to client A");
  });

  it("momin ?clientPartyId=B → only the B item", async () => {
    const res = await api(BASE, `/vault/items?clientPartyId=${clientB}`, { token: mominToken });
    assert.equal(res.status, 200);
    const idSet = new Set((res.body as Array<{ id: string }>).map((i) => i.id));
    assert.ok(idSet.has(mominItemB));
    assert.ok(!idSet.has(mominItemA1) && !idSet.has(mominItemA2));
  });

  it("the filtered rows are metadata-only (no secret/password/ciphertext/username)", async () => {
    const res = await api(BASE, `/vault/items?clientPartyId=${clientA}`, { token: mominToken });
    for (const row of res.body as Array<Record<string, unknown>>) {
      assert.ok(!("secret" in row), "no secret bundle");
      assert.ok(!("password" in row), "no password");
      assert.ok(!("secretCiphertext" in row) && !("secret_ciphertext" in row), "no ciphertext");
      assert.ok(!("username" in row), "no username");
    }
  });

  it("🔴 the filter cannot surface an item the caller does NOT hold (no ACL bypass)", async () => {
    // Admin creates a clientA-scoped item and shares it ONLY to WriterA (a holder);
    // WriterB does NOT hold it. (WriterA is view-only, so admin owns create+grant.)
    writerAItemA = await createItem(mominToken, "VCF shared-clientA", clientA);
    const g = await api(BASE, `/vault/items/${writerAItemA}/shares`, {
      method: "POST",
      token: mominToken,
      body: { partyId: writerAParty },
    });
    assert.equal(g.status, 201, `grant to WriterA should succeed (got ${g.status}: ${JSON.stringify(g.body)})`);

    // WriterA, filtering by clientA, sees the item shared to them.
    const a = await api(BASE, `/vault/items?clientPartyId=${clientA}`, { token: writerAToken });
    assert.equal(a.status, 200);
    const aIds = new Set((a.body as Array<{ id: string }>).map((i) => i.id));
    assert.ok(aIds.has(writerAItemA), "WriterA sees the clientA item shared to them");
    // RLS-scoped: WriterA must NOT see momin's other clientA items (never shared to WriterA).
    assert.ok(!aIds.has(mominItemA1) && !aIds.has(mominItemA2), "WriterA cannot see momin's unshared clientA items via the filter");

    // WriterB holds nothing for clientA → zero rows even with the matching filter.
    const b = await api(BASE, `/vault/items?clientPartyId=${clientA}`, { token: writerBToken });
    assert.equal(b.status, 200, "a non-holder gets 200 with an empty set, not an error");
    const bIds = new Set((b.body as Array<{ id: string }>).map((i) => i.id));
    assert.ok(!bIds.has(writerAItemA), "the filter must not leak WriterA's item to WriterB");
    assert.ok(!bIds.has(mominItemA1) && !bIds.has(mominItemA2), "nor momin's clientA items");
  });

  it("an unmatched client id → zero rows (200, not an error)", async () => {
    const res = await api(BASE, `/vault/items?clientPartyId=${randomUUID()}`, { token: mominToken });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });

  it("a malformed (non-uuid) clientPartyId → 400 (boundary validation)", async () => {
    const res = await api(BASE, "/vault/items?clientPartyId=not-a-uuid", { token: mominToken });
    assert.equal(res.status, 400);
  });
});
