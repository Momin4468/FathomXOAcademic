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
 * Settlement layer (DESIGN_SPEC §4.4) — BLACK-BOX HTTP tests against the COMPILED
 * app (dist/main.js). Mirrors billing-http.test.ts / work-http.test.ts. Proves
 * the request-time guarantees that must NEVER silently break:
 *   • the SHARED partner figure (pool/net who-owes-whom) is identical for both
 *     partners, and reflects §3.1's worked split & commission examples
 *   • 🔴 a billing:view holder who is NOT a partner sees EMPTY settlement
 *     (settlement_legs caller-guard) — no shared figures leak
 *   • dated transfers net the running balance; reverse (approve) is append-only
 *   • platform-fee = pct × the party's earnings; idempotent; surfaces as the
 *     party's DUE in their own balance
 *   • server-side authz: a billing-less Writer is 403
 * Requires FEATURE_BILLING + FEATURE_WORK so /settlement,/work mount.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3218; // dedicated test port (auth=3210 … billing=3213)
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";

const ORG = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // work:view+create, NO billing
const ADMIN_ROLE = "00000000-0000-4000-8000-0000000000a3"; // billing:* + work + ...
const MOMIN_PARTY = "00000000-0000-4000-8000-0000000000c1";
const EMON_PARTY = "00000000-0000-4000-8000-0000000000c2";

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = "";
let mominToken = ""; // Admin + party Momin
let emonToken = ""; // Admin + party Emon
let writerToken = ""; // a NEW user holding ONLY Writer (no billing)
let writerPartyId = ""; // the chain's terminal writer
let clientPartyId = ""; // the source client at the top of the chain
let outsiderToken = ""; // a NEW Admin (billing:view) linked to a FRESH non-partner party
let outsiderPartyId = "";

const createdUserIds: string[] = [];
const createdPartyIds: string[] = [];
const createdWorkItemIds: string[] = [];
const createdDealTermIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT), FEATURE_BILLING: "true", FEATURE_WORK: "true" },
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
  const email = `setluser+${randomUUID()}@fathomxo.test`;
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

async function makeParty(name: string, type: string): Promise<string> {
  const id = randomUUID();
  await admin.query("insert into party (id, org_id, display_name, party_type) values ($1,$2,$3,$4)", [id, ORG, name, `{${type}}`]);
  createdPartyIds.push(id);
  return id;
}

/** Insert a deal_term directly (admin) and track for teardown. */
async function seedDealTerm(opts: {
  fromPartyId: string | null;
  toPartyId: string | null;
  termType: string;
  value: number;
  effectiveFrom?: string;
  effectiveTo?: string | null;
}): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `insert into deal_term (id, org_id, from_party_id, to_party_id, applies_to, term_type, value, effective_from, effective_to)
     values ($1,$2,$3,$4,'default',$5,$6,$7,$8)`,
    [id, ORG, opts.fromPartyId, opts.toPartyId, opts.termType, opts.value, opts.effectiveFrom ?? "2020-01-01", opts.effectiveTo ?? null],
  );
  createdDealTermIds.push(id);
  return id;
}

before(async () => {
  await admin.connect();
  await startServer();

  sysToken = (await login("sysadmin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  mominToken = (await login("momin@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  emonToken = (await login("emon@fathomxo.local", DEV_PASSWORD)).body.accessToken;
  assert.ok(sysToken && mominToken && emonToken, "seeded logins succeed");

  clientPartyId = await makeParty("SETLTEST Client", "client");
  writerPartyId = await makeParty("SETLTEST Writer", "writer");
  ({ token: writerToken } = await makeUserWithRole(WRITER_ROLE, writerPartyId));

  outsiderPartyId = await makeParty("SETLTEST Outsider", "partner");
  ({ token: outsiderToken } = await makeUserWithRole(ADMIN_ROLE, outsiderPartyId));
});

after(async () => {
  for (const id of createdWorkItemIds) {
    await admin.query("delete from charge where work_item_id=$1", [id]);
    await admin.query("delete from leg where work_item_id=$1", [id]);
    await admin.query("delete from work_line where work_item_id=$1", [id]);
    await admin.query("delete from work_item where id=$1", [id]);
  }
  // Settlement transfers involving any test party.
  for (const p of [MOMIN_PARTY, EMON_PARTY, ...createdPartyIds]) {
    await admin.query("delete from settlement_transfer where from_party_id=$1 or to_party_id=$1", [p]);
    await admin.query("delete from charge where party_id=$1", [p]);
    await admin.query("delete from leg where from_party_id=$1 or to_party_id=$1", [p]);
  }
  for (const id of createdDealTermIds) {
    await admin.query("delete from deal_term where id=$1", [id]);
  }
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
});

/** Create a work item (momin) and track it. */
async function createWorkItem(): Promise<string> {
  const res = await api(BASE, "/work", { method: "POST", token: mominToken, body: { title: `SETLTEST Job ${randomUUID().slice(0, 8)}` } });
  assert.equal(res.status, 201, `work create should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
  createdWorkItemIds.push(res.body.id);
  return res.body.id as string;
}

/** Build a 3-leg chain with explicit amounts (momin holds work:approve). */
async function buildChain(top: string, mid: string, down: string, terminal: string, amounts: [number, number, number]): Promise<string> {
  const workId = await createWorkItem();
  const res = await api(BASE, `/work/${workId}/legs`, {
    method: "POST",
    token: mominToken,
    body: {
      legs: [
        { seq: 1, fromPartyId: top, toPartyId: mid, amount: amounts[0] },
        { seq: 2, fromPartyId: mid, toPartyId: down, amount: amounts[1] },
        { seq: 3, fromPartyId: down, toPartyId: terminal, amount: amounts[2] },
      ],
    },
  });
  assert.equal(res.status, 201, `build legs should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
  return workId;
}

// ─── The SHARED partner figure (split example) ───────────────────────────────────

describe("settlement summary — the SHARED figure is identical for both partners (§3.1 split)", () => {
  before(async () => {
    await seedDealTerm({ fromPartyId: MOMIN_PARTY, toPartyId: EMON_PARTY, termType: "split_pct", value: 50 });
    // Client→Momin→Emon→Writer 6000/5000/3000 → pool=2000, Emon owes Momin 1000.
    await buildChain(clientPartyId, MOMIN_PARTY, EMON_PARTY, writerPartyId, [6000, 5000, 3000]);
  });

  it("Momin: jobCount≥1, totalPool 2000, Emon owes Momin 1000", async () => {
    const res = await api(BASE, `/settlement?partnerA=${MOMIN_PARTY}&partnerB=${EMON_PARTY}`, { token: mominToken });
    assert.equal(res.status, 200, `summary should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.ok(res.body.jobCount >= 1, "at least the one shared job");
    assert.equal(Number(res.body.totalPool), 2000, "shared pool = 5000 − 3000");
    assert.equal(res.body.net.owedBy, EMON_PARTY, "Emon (downstream) owes");
    assert.equal(res.body.net.owedTo, MOMIN_PARTY, "Momin (upstream) is owed");
    assert.equal(Number(res.body.net.amount), 1000, "50% × 2000");
  });

  it("🔴 Emon sees the IDENTICAL shared figures (no private leg, just the pool)", async () => {
    const res = await api(BASE, `/settlement?partnerA=${MOMIN_PARTY}&partnerB=${EMON_PARTY}`, { token: emonToken });
    assert.equal(res.status, 200);
    assert.equal(Number(res.body.totalPool), 2000, "Emon sees the same pool");
    assert.equal(res.body.net.owedBy, EMON_PARTY);
    assert.equal(Number(res.body.net.amount), 1000);
    // The 6000 client price must never appear in the shared response.
    assert.ok(!JSON.stringify(res.body).includes("6000"), "the true client price (6000) must not leak to Emon");
  });
});

// ─── Transfers net the running balance ───────────────────────────────────────────

describe("dated transfers net the partner balance to settled", () => {
  it("recording Emon→Momin 1000 settles the split case", async () => {
    const rec = await api(BASE, "/settlement/transfers", {
      method: "POST",
      token: mominToken,
      body: { fromPartyId: EMON_PARTY, toPartyId: MOMIN_PARTY, amount: 1000, transferredAt: "2026-06-10" },
    });
    assert.equal(rec.status, 201, `record transfer should succeed (got ${rec.status}: ${JSON.stringify(rec.body)})`);

    const sum = await api(BASE, `/settlement?partnerA=${MOMIN_PARTY}&partnerB=${EMON_PARTY}`, { token: mominToken });
    assert.equal(Number(sum.body.net.amount), 0, "the 1000 transfer cancels the 1000 owed");
    assert.equal(sum.body.net.owedBy, null, "fully settled — nobody owes");
  });

  it("Emon sees the transfer in /settlement/transfers", async () => {
    const res = await api(BASE, `/settlement/transfers?partyId=${MOMIN_PARTY}`, { token: emonToken });
    assert.equal(res.status, 200);
    const found = (res.body as Array<any>).some(
      (t) => t.fromPartyId === EMON_PARTY && t.toPartyId === MOMIN_PARTY && Number(t.amount) === 1000,
    );
    assert.ok(found, "the partner transfer is visible to the counterparty");
  });

  it("reverse (approve) is append-only; double-reverse → 400", async () => {
    const rec = await api(BASE, "/settlement/transfers", {
      method: "POST",
      token: mominToken,
      body: { fromPartyId: MOMIN_PARTY, toPartyId: EMON_PARTY, amount: 200, transferredAt: "2026-06-11" },
    });
    assert.equal(rec.status, 201);
    const originalId = rec.body.id as string;

    const rev = await api(BASE, "/settlement/transfers/reverse", { method: "POST", token: mominToken, body: { originalId, reason: "mistake" } });
    assert.equal(rev.status, 201, `reverse should succeed (got ${rev.status}: ${JSON.stringify(rev.body)})`);

    const again = await api(BASE, "/settlement/transfers/reverse", { method: "POST", token: mominToken, body: { originalId } });
    assert.equal(again.status, 400, "a transfer already reversed cannot be reversed again");
  });
});

// ─── Commission example (independent pair / fresh state) ─────────────────────────

describe("settlement summary — commission example (§3.1): Momin owes Emon 400", () => {
  // Use a FRESH partner pair so this job's math is isolated from the split case.
  let p1 = ""; // upstream Emon-analogue (gets commission)
  let p2 = ""; // downstream Momin-analogue (pays commission)

  before(async () => {
    p1 = await makeParty("SETLTEST CommUp", "partner");
    p2 = await makeParty("SETLTEST CommDown", "partner");
    // commission_pct=20 on p1→p2 (upstream p1 → downstream p2).
    await seedDealTerm({ fromPartyId: p1, toPartyId: p2, termType: "commission_pct", value: 20 });
    // Client→p1→p2→Writer 6000/5000/3000 → pool=2000, downstream p2 owes p1 20%×2000=400.
    await buildChain(clientPartyId, p1, p2, writerPartyId, [6000, 5000, 3000]);
  });

  it("for the (p1,p2) pair, p2 owes p1 400 from that job", async () => {
    // Call as SuperAdmin: momin's party is not in {p1,p2}, so the settlement_legs
    // caller-guard would (correctly) hide the pool from momin. SuperAdmin bypasses
    // the guard, so the commission math is observable here.
    const res = await api(BASE, `/settlement?partnerA=${p1}&partnerB=${p2}`, { token: sysToken });
    assert.equal(res.status, 200, `summary should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(Number(res.body.totalPool), 2000, "pool = 5000 − 3000");
    assert.equal(res.body.net.owedBy, p2, "downstream owes the commission");
    assert.equal(res.body.net.owedTo, p1, "upstream is owed the commission");
    assert.equal(Number(res.body.net.amount), 400, "20% × 2000");
  });
});

// ─── Platform fee ────────────────────────────────────────────────────────────────

describe("platform fee = pct × the party's earnings; surfaces as the party's DUE; idempotent", () => {
  let workId = "";

  before(async () => {
    // Global platform_fee term (from/to null), 10%.
    await seedDealTerm({ fromPartyId: null, toPartyId: null, termType: "platform_fee", value: 10 });
    // A chain giving the writer 3000 earnings on this job.
    workId = await buildChain(clientPartyId, MOMIN_PARTY, EMON_PARTY, writerPartyId, [6000, 5000, 3000]);
  });

  it("POST /settlement/platform-fee charges 10% × 3000 = 300", async () => {
    const res = await api(BASE, "/settlement/platform-fee", { method: "POST", token: mominToken, body: { partyId: writerPartyId, workItemId: workId } });
    assert.equal(res.status, 201, `apply fee should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(Number(res.body.amount), 300, "10% × 3000 earnings");
  });

  it("🔴 the Writer's own balance includes the 300 platform_fee due", async () => {
    const bal = await api(BASE, "/billing/balance/me", { token: writerToken });
    assert.equal(bal.status, 200);
    const item = (bal.body.charges.items as Array<any>).find((c) => c.category === "platform_fee" && Number(c.due) === 300);
    assert.ok(item, "the platform fee is itemized in the writer's own balance");
    assert.ok(Number(bal.body.charges.outstanding) >= 300, "the 300 due is counted as outstanding");
  });

  it("applying the same platform fee again → 400 (idempotency)", async () => {
    const res = await api(BASE, "/settlement/platform-fee", { method: "POST", token: mominToken, body: { partyId: writerPartyId, workItemId: workId } });
    assert.equal(res.status, 400, "a second live platform_fee on the same party+job is refused");
  });
});

// ─── Authz / opacity at HTTP ─────────────────────────────────────────────────────

describe("authz + opacity at HTTP", () => {
  it("a billing-less Writer GET /settlement → 403", async () => {
    const res = await api(BASE, `/settlement?partnerA=${MOMIN_PARTY}&partnerB=${EMON_PARTY}`, { token: writerToken });
    assert.equal(res.status, 403, "viewing settlement needs billing:view");
  });

  it("🔴 a billing:view Admin who is NOT a partner → 200 but EMPTY (caller-guard excludes them)", async () => {
    const res = await api(BASE, `/settlement?partnerA=${MOMIN_PARTY}&partnerB=${EMON_PARTY}`, { token: outsiderToken });
    assert.equal(res.status, 200, "an authorized non-partner is allowed to call, but sees nothing");
    assert.equal(res.body.jobCount, 0, "settlement_legs caller-guard yields zero shared rows for a non-partner");
    assert.equal(Number(res.body.net.amount), 0, "no shared figures for a non-partner");
    assert.equal(res.body.net.owedBy, null);
    assert.ok(!JSON.stringify(res.body).includes("6000"), "no private price reaches a non-partner viewer");
  });
});
