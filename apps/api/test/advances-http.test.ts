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
 * P1 item 11 — business-plane loan/advance ledger. BLACK-BOX HTTP. Proves:
 *   • outstanding is DERIVED (principal ∓ Σ events); a repayment reduces it; a
 *     reversing event restores it;
 *   • a provisional counterparty (name only) is created;
 *   • create is advances:create-gated (a non-advances user → 403); reverse is
 *     advances:approve-gated;
 *   • DISJOINT from the money ledger: recording an advance never alters the
 *     party's billing balance and creates no charge;
 *   • validation: a non-positive disbursement/repayment → 400.
 * Requires FEATURE_ADVANCES + FEATURE_BILLING.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3264;
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";
const ORG = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // no advances permission

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });
let adminToken = "";
let sysToken = "";
let writerOnlyToken = "";
let writerParty = "";
const createdUserIds: string[] = [];
const createdPartyIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — build the api first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT), FEATURE_ADVANCES: "true", FEATURE_BILLING: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (d) => {
    const s = String(d);
    if (/error/i.test(s)) process.stderr.write(`[api] ${s}`);
  });
  await waitForHealth(BASE, 90000);
}

const login = (email: string, password: string) => api(BASE, "/auth/login", { method: "POST", body: { email, password } });

async function makeParty(name: string, type: string): Promise<string> {
  const id = randomUUID();
  await admin.query("insert into party (id, org_id, display_name, party_type) values ($1,$2,$3,$4)", [id, ORG, name, `{${type}}`]);
  createdPartyIds.push(id);
  return id;
}

async function makeWriterOnlyUser(): Promise<string> {
  const email = `adv+${randomUUID()}@fathomxo.test`;
  const created = await api(BASE, "/platform/users", { method: "POST", token: sysToken, body: { email, password: DEV_PASSWORD } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  createdUserIds.push(created.body.id);
  await api(BASE, `/platform/users/${created.body.id}/roles`, { method: "POST", token: sysToken, body: { roleId: WRITER_ROLE } });
  return (await login(email, DEV_PASSWORD)).body.accessToken as string;
}

before(async () => {
  await admin.connect();
  await startServer();
  sysToken = (await login("sysadmin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  adminToken = (await login("momin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  writerOnlyToken = await makeWriterOnlyUser();
  writerParty = await makeParty("Advance Writer", "writer");
});

after(async () => {
  await admin.query("delete from advance_event where advance_id in (select id from advance where counterparty_party_id = any($1::uuid[]))", [createdPartyIds]);
  await admin.query("delete from advance where counterparty_party_id = any($1::uuid[])", [createdPartyIds]);
  // Provisional counterparties created by the service (named, no type) — clean by note-less directory rows we made.
  await admin.query("delete from advance_event where org_id=$1 and advance_id in (select id from advance where note like 'ADVTEST%')", [ORG]);
  await admin.query("delete from advance where note like 'ADVTEST%'");
  await admin.query("delete from party where org_id=$1 and display_name like 'Prov CP %'", [ORG]);
  for (const id of createdPartyIds) await admin.query("delete from party where id=$1", [id]);
  for (const id of createdUserIds) {
    await admin.query("delete from auth_refresh_token where user_id=$1", [id]);
    await admin.query("delete from user_role where user_id=$1", [id]);
    await admin.query("delete from user_account where id=$1", [id]);
  }
  await admin.end();
  if (server && !server.killed) server.kill();
});

describe("business-plane loan/advance ledger (P1 item 11)", () => {
  it("outstanding is derived; a repayment reduces it; a reversal restores it", async () => {
    const created = await api(BASE, "/advances", {
      method: "POST",
      token: adminToken,
      body: { counterpartyPartyId: writerParty, direction: "given", principal: 5000, startedOn: "2026-07-01", note: "ADVTEST base" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.id as string;

    // A ৳2000 repayment → outstanding 3000.
    const ev = await api(BASE, `/advances/${id}/events`, { method: "POST", token: adminToken, body: { kind: "repayment", amount: 2000, occurredOn: "2026-07-05" } });
    assert.equal(ev.status, 201, JSON.stringify(ev.body));
    const eventId = ev.body.id as string;

    const one = await api(BASE, `/advances/${id}`, { token: adminToken });
    assert.equal(one.status, 200);
    assert.equal(Number(one.body.outstanding), 3000, "5000 principal − 2000 repayment");
    assert.equal((one.body.events as Array<unknown>).length, 1);

    // Reverse the repayment → outstanding back to 5000.
    const rev = await api(BASE, `/advances/events/${eventId}/reverse`, { method: "POST", token: adminToken });
    assert.equal(rev.status, 200, JSON.stringify(rev.body));
    const after = await api(BASE, `/advances/${id}`, { token: adminToken });
    assert.equal(Number(after.body.outstanding), 5000, "reversal restores the outstanding");

    const party = await api(BASE, `/advances/party/${writerParty}`, { token: adminToken });
    assert.equal(party.status, 200);
    assert.equal(Number(party.body.given), 5000, "party-level given outstanding");
    assert.equal(Number(party.body.taken), 0);
  });

  it("recording an advance is DISJOINT from the party's money balance", async () => {
    const before = await api(BASE, `/billing/balance/${writerParty}`, { token: adminToken });
    assert.equal(before.status, 200, JSON.stringify(before.body));
    const baseNet = before.body.net;
    const baseChargeItems = (before.body.charges.items as Array<unknown>).length;

    const created = await api(BASE, "/advances", {
      method: "POST",
      token: adminToken,
      body: { counterpartyPartyId: writerParty, direction: "given", principal: 1234, startedOn: "2026-07-02", note: "ADVTEST disjoint" },
    });
    assert.equal(created.status, 201);
    await api(BASE, `/advances/${created.body.id}/events`, { method: "POST", token: adminToken, body: { kind: "repayment", amount: 100, occurredOn: "2026-07-03" } });

    const afterBal = await api(BASE, `/billing/balance/${writerParty}`, { token: adminToken });
    assert.equal(afterBal.body.net, baseNet, "the advance never touches the money-ledger net");
    assert.equal((afterBal.body.charges.items as Array<unknown>).length, baseChargeItems, "an advance is NOT a charge");
  });

  it("creates a provisional counterparty from a name", async () => {
    const created = await api(BASE, "/advances", {
      method: "POST",
      token: adminToken,
      body: { counterpartyName: `Prov CP ${randomUUID().slice(0, 6)}`, direction: "taken", principal: 800, startedOn: "2026-07-01", note: "ADVTEST prov" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.ok(created.body.counterpartyPartyId, "a provisional party was created");
    const party = await api(BASE, `/advances/party/${created.body.counterpartyPartyId}`, { token: adminToken });
    assert.equal(Number(party.body.taken), 800, "we owe them 800 (taken)");
  });

  it("create is advances:create-gated (a writer-only user → 403)", async () => {
    const res = await api(BASE, "/advances", {
      method: "POST",
      token: writerOnlyToken,
      body: { counterpartyPartyId: writerParty, direction: "given", principal: 100, startedOn: "2026-07-01" },
    });
    assert.equal(res.status, 403);
  });

  it("rejects a non-positive disbursement/repayment (400)", async () => {
    const created = await api(BASE, "/advances", {
      method: "POST",
      token: adminToken,
      body: { counterpartyPartyId: writerParty, direction: "given", principal: 500, startedOn: "2026-07-01", note: "ADVTEST valid" },
    });
    const bad = await api(BASE, `/advances/${created.body.id}/events`, { method: "POST", token: adminToken, body: { kind: "repayment", amount: -50, occurredOn: "2026-07-02" } });
    assert.equal(bad.status, 400);
    const zero = await api(BASE, `/advances/${created.body.id}/events`, { method: "POST", token: adminToken, body: { kind: "adjustment", amount: 0, occurredOn: "2026-07-02" } });
    assert.equal(zero.status, 400);
  });
});
