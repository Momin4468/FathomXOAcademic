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
 * P0 item 3 — per-partner running settlement balance (self view). GET
 * /channels/settlement-balance/mine returns the CALLER's own
 * owed = (profit_share accrued to them) − (net settlement transfers received).
 * Proves: a partner with a fixed per-job share over N jobs, minus a partial
 * transfer, nets to the exact figure; and §4.4 opacity — a non-sharer sees only
 * their own (zero) balance and no other party's figure leaks (the endpoint is
 * self-only + the my_profit_share definer is caller-guarded).
 * Requires FEATURE_CHANNELS + FEATURE_WORK.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3258;
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const ORG = "00000000-0000-4000-8000-000000000001";
const ADMIN_ROLE = "00000000-0000-4000-8000-0000000000a3"; // has channels:view/approve + work
const MOMIN_PARTY = "00000000-0000-4000-8000-0000000000c1";

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
let sysToken = "";
let mominToken = "";
let antuToken = "";
let observerToken = "";
let antuParty = "";
let observerParty = "";
let channelParty = "";
const createdUserIds: string[] = [];
const createdWorkItemIds: string[] = [];
const createdPartyIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — build the api first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT), FEATURE_CHANNELS: "true", FEATURE_WORK: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (d) => {
    const s = String(d);
    if (/error/i.test(s)) process.stderr.write(`[api] ${s}`);
  });
  await waitForHealth(BASE);
}
const login = (email: string, password: string) => api(BASE, "/auth/login", { method: "POST", body: { email, password } });

async function makeParty(name: string, type: string): Promise<string> {
  const id = randomUUID();
  await admin.query("insert into party (id, org_id, display_name, party_type) values ($1,$2,$3,$4)", [id, ORG, name, `{${type}}`]);
  createdPartyIds.push(id);
  return id;
}
async function makeUserWithRole(partyId: string): Promise<string> {
  const email = `m3set+${randomUUID()}@fathomxo.test`;
  const created = await api(BASE, "/platform/users", { method: "POST", token: sysToken, body: { email, password: DEV_PASSWORD, partyId } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  createdUserIds.push(created.body.id);
  const assigned = await api(BASE, `/platform/users/${created.body.id}/roles`, { method: "POST", token: sysToken, body: { roleId: ADMIN_ROLE } });
  assert.equal(assigned.status, 201);
  const li = await login(email, DEV_PASSWORD);
  assert.equal(li.status, 200);
  return li.body.accessToken;
}
async function createSourcedJob(): Promise<void> {
  const res = await api(BASE, "/work", { method: "POST", token: mominToken, body: { title: `M3 job ${randomUUID().slice(0, 8)}`, sourcePartyId: channelParty } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  createdWorkItemIds.push(res.body.id);
}

before(async () => {
  await admin.connect();
  await startServer();
  const s = await login("sysadmin@fathomxo.local", DEV_PASSWORD);
  assert.equal(s.status, 200);
  sysToken = s.body.accessToken;
  const m = await login("momin@fathomxo.local", DEV_PASSWORD);
  assert.equal(m.status, 200);
  mominToken = m.body.accessToken;

  antuParty = await makeParty("M3 Antu", "partner");
  observerParty = await makeParty("M3 Observer", "writer");
  channelParty = await makeParty("M3 Channel", "channel");
  antuToken = await makeUserWithRole(antuParty);
  observerToken = await makeUserWithRole(observerParty);

  // A fixed per-job profit share to Antu, scoped to the channel (value 1000/job).
  const term = await api(BASE, "/channels/profit-shares", {
    method: "POST",
    token: mominToken,
    body: { toPartyId: antuParty, basis: "fixed", value: 1000, sourcePartyId: channelParty, effectiveFrom: "2026-01-01" },
  });
  assert.equal(term.status, 201, `set profit-share term (got ${term.status}: ${JSON.stringify(term.body)})`);

  // Two jobs sourced from that channel → Antu accrues 1000 × 2 = 2000.
  await createSourcedJob();
  await createSourcedJob();

  // The business has paid Antu 700 (a dated settlement transfer, Momin→Antu).
  await admin.query(
    "insert into settlement_transfer (id, org_id, from_party_id, to_party_id, amount, transferred_at) values ($1,$2,$3,$4,700,'2026-06-01')",
    [randomUUID(), ORG, MOMIN_PARTY, antuParty],
  );
});

after(async () => {
  await admin.query("delete from settlement_transfer where to_party_id=$1", [antuParty]);
  await admin.query("delete from deal_term where to_party_id=$1", [antuParty]);
  for (const id of createdWorkItemIds) {
    await admin.query("delete from leg where work_item_id=$1", [id]);
    await admin.query("delete from work_line where work_item_id=$1", [id]);
    await admin.query("delete from work_item where id=$1", [id]);
  }
  for (const id of createdUserIds) {
    await admin.query("delete from audit_log where actor_user_id=$1", [id]);
    await admin.query("delete from auth_refresh_token where user_id=$1", [id]);
    await admin.query("delete from user_role where user_id=$1", [id]);
    await admin.query("delete from user_account where id=$1", [id]);
  }
  for (const id of createdPartyIds) await admin.query("delete from party where id=$1", [id]);
  await admin.end();
  if (server && !server.killed) server.kill();
});

describe("per-partner settlement balance (self view; §4.4-opaque)", () => {
  it("a partner's owed = accrued − transfers received (2×1000 − 700 = 1300)", async () => {
    const res = await api(BASE, "/channels/settlement-balance/mine", { token: antuToken });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.accrued, 2000, "2 jobs × ৳1000 fixed share");
    assert.equal(res.body.received, 700, "the ৳700 transfer received");
    assert.equal(res.body.owed, 1300, "still owed 2000 − 700");
  });

  it("a non-sharer sees only their own (zero) balance — no other party's figure leaks", async () => {
    const res = await api(BASE, "/channels/settlement-balance/mine", { token: observerToken });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.accrued, 0);
    assert.equal(res.body.received, 0);
    assert.equal(res.body.owed, 0);
    assert.ok(!JSON.stringify(res.body).includes("2000"), "Antu's accrual never appears in another caller's response");
  });
});
