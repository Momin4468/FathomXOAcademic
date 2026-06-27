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
 * Module 2 (work items + lines + copy fan-out + leg chain with derived margins)
 * — BLACK-BOX HTTP tests against the COMPILED app (dist/main.js). Proves the
 * request-time guarantees that must NEVER silently break:
 *   • copy fan-out: 1 producer line → N independent consumer lines (source link)
 *   • leg chain + derived margins, RLS-filtered per caller
 *   • 🔴 the leg-leak guarantee: a downstream party (Emon) can never read the
 *     true client price; a non-party gets zero rows
 *   • work_line money redaction for a Writer (work:view, no approve)
 *   • work-state machine + the governance (→confirmed needs work:approve)
 * Requires FEATURE_WORK=true so the /work routes mount.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3212; // dedicated test port (auth=3210, reference=3211)
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";

const ORG = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // work:view+create, NO approve
const MOMIN_PARTY = "00000000-0000-4000-8000-0000000000c1";
const EMON_PARTY = "00000000-0000-4000-8000-0000000000c2";

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = ""; // System SuperAdmin — sees the whole chain; creates users
let mominToken = ""; // Admin (work:approve) + party Momin
let emonToken = ""; // Admin (work:approve) + party Emon — downstream node
let writerToken = ""; // a NEW user holding ONLY Writer (work:view+create, no approve)
let writerPartyId = ""; // that writer's party — the chain's terminal `to`
let clientPartyId = ""; // a pure-source client party for the chain top

const createdUserIds: string[] = [];
const createdPartyIds: string[] = [];
const createdWorkItemIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: { ...process.env, PORT: String(PORT), FEATURE_WORK: "true", FEATURE_REFERENCE: "true" },
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

/** Create a login (sysadmin), link it to a party, assign one role, log it in. */
async function makeUserWithRole(roleId: string, partyId?: string): Promise<{ token: string; userId: string }> {
  const email = `m2user+${randomUUID()}@fathomxo.test`;
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

/** Insert a party directly (admin) so we control its id for the chain. */
async function makeParty(name: string, type: string): Promise<string> {
  const id = randomUUID();
  await admin.query(
    "insert into party (id, org_id, display_name, party_type) values ($1,$2,$3,$4)",
    [id, ORG, name, `{${type}}`],
  );
  createdPartyIds.push(id);
  return id;
}

before(async () => {
  await admin.connect();
  await startServer();

  const s = await login("sysadmin@fathomxo.local", DEV_PASSWORD);
  assert.equal(s.status, 200, "sysadmin should log in");
  sysToken = s.body.accessToken;

  const m = await login("momin@fathomxo.local", DEV_PASSWORD);
  assert.equal(m.status, 200, "momin should log in");
  mominToken = m.body.accessToken;

  const e = await login("emon@fathomxo.local", DEV_PASSWORD);
  assert.equal(e.status, 200, "emon should log in");
  emonToken = e.body.accessToken;

  // The chain top is a pure client (source); the terminal is a writer-as-party.
  clientPartyId = await makeParty("M2TEST Client", "client");
  writerPartyId = await makeParty("M2TEST Writer", "writer");
  ({ token: writerToken } = await makeUserWithRole(WRITER_ROLE, writerPartyId));
});

after(async () => {
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
  for (const id of createdPartyIds) {
    await admin.query("delete from party where id=$1", [id]);
  }
  await admin.end();
  if (server && !server.killed) server.kill();
});

/** Create a bare work item (as momin) and track it for teardown. */
async function createWorkItem(extra: Record<string, unknown> = {}): Promise<string> {
  const res = await api(BASE, "/work", {
    method: "POST",
    token: mominToken,
    body: { title: `M2TEST Job ${randomUUID().slice(0, 8)}`, ...extra },
  });
  assert.equal(res.status, 201, `work create should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
  createdWorkItemIds.push(res.body.id);
  return res.body.id as string;
}

// ─── Copy fan-out ───────────────────────────────────────────────────────────────

describe("copy fan-out: 1 producer entry → N independent consumer lines (§3.2)", () => {
  let workId = "";
  let producerLineId = "";
  let consumerLineIds: string[] = [];

  it("POST /work/:id/fan-out produces 1 producer line + N consumer lines linked by source", async () => {
    workId = await createWorkItem();
    const res = await api(BASE, `/work/${workId}/fan-out`, {
      method: "POST",
      token: mominToken,
      body: {
        producer: { writerPartyId, wordCount: 4000, writerRate: 0.5 },
        consumers: [
          { consumerPartyId: clientPartyId, wordCount: 4000, clientRate: 1.5 }, // 6000
          { consumerPartyId: EMON_PARTY, wordCount: 4000, clientRate: 2.0 }, // 8000 — independent price
        ],
      },
    });
    assert.equal(res.status, 201, `fan-out should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    producerLineId = res.body.producerLineId;
    consumerLineIds = res.body.consumerLineIds;
    assert.ok(producerLineId, "a producer line id must be returned");
    assert.equal(consumerLineIds.length, 2, "two consumer lines for two consumers");
  });

  it("the detail view shows one producer-side line and N consumer-side lines pointing back to it", async () => {
    const detail = await api(BASE, `/work/${workId}`, { token: sysToken });
    assert.equal(detail.status, 200);
    const lines = detail.body.lines as Array<any>;
    const producers = lines.filter((l) => l.side === "producer");
    const consumers = lines.filter((l) => l.side === "consumer");
    assert.equal(producers.length, 1, "exactly one producer line (writer side)");
    assert.equal(consumers.length, 2, "N fanned consumer lines (client side)");
    for (const c of consumers) {
      assert.equal(c.sourceLineId, producerLineId, "each consumer.sourceLineId = the producer line id");
      assert.equal(c.writerPartyId, null, "a consumer line is never also producer-side");
      assert.equal(c.unitCount, 1, "each fanned copy is a single unit");
    }
    // The producer's unit_count = number of copies (one writer payable across all).
    assert.equal(producers[0].unitCount, 2, "producer unit_count = number of consumer copies");
    assert.equal(producers[0].consumerPartyId, null, "the producer line carries no consumer");
  });

  it("each consumer line carries its OWN independent client price (no shared rate)", async () => {
    const detail = await api(BASE, `/work/${workId}`, { token: sysToken });
    const consumers = (detail.body.lines as Array<any>).filter((l) => l.side === "consumer");
    const amounts = consumers.map((c) => c.amount).sort((a, b) => a - b);
    assert.deepEqual(amounts, [6000, 8000], "fan-out prices are independent (4000×1.5, 4000×2.0)");
  });
});

// ─── Leg chain + derived margins (HTTP, RLS-filtered per caller) ─────────────────

describe("leg chain + derived margins — RLS-filtered per caller (SCHEMA §D)", () => {
  let workId = "";

  it("admin builds the chain Client→Momin→Emon→Writer (6000/5000/3000)", async () => {
    workId = await createWorkItem();
    const res = await api(BASE, `/work/${workId}/legs`, {
      method: "POST",
      token: mominToken, // Admin holds work:approve
      body: {
        legs: [
          { seq: 1, fromPartyId: clientPartyId, toPartyId: MOMIN_PARTY, amount: 6000 },
          { seq: 2, fromPartyId: MOMIN_PARTY, toPartyId: EMON_PARTY, amount: 5000 },
          { seq: 3, fromPartyId: EMON_PARTY, toPartyId: writerPartyId, amount: 3000 },
        ],
      },
    });
    assert.equal(res.status, 201, `append legs should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.legIds.length, 3);
  });

  it("SuperAdmin sees all 3 legs and BOTH node margins (Momin=1000, Emon=2000)", async () => {
    const res = await api(BASE, `/work/${workId}/legs`, { token: sysToken });
    assert.equal(res.status, 200);
    assert.deepEqual((res.body.legs as Array<any>).map((l) => l.seq), [1, 2, 3]);
    const margins = new Map((res.body.margins as Array<any>).map((m) => [m.partyId, m.margin]));
    assert.equal(margins.get(MOMIN_PARTY), 1000, "Momin margin = 6000−5000");
    assert.equal(margins.get(EMON_PARTY), 2000, "Emon margin = 5000−3000");
    assert.equal((res.body.margins as Array<any>).length, 2, "only the two intermediaries");
  });

  it("Momin sees legs 1 & 2 only and a single margin = 1000", async () => {
    const res = await api(BASE, `/work/${workId}/legs`, { token: mominToken });
    assert.equal(res.status, 200);
    assert.deepEqual((res.body.legs as Array<any>).map((l) => l.seq), [1, 2]);
    assert.equal((res.body.margins as Array<any>).length, 1);
    assert.equal(res.body.margins[0].partyId, MOMIN_PARTY);
    assert.equal(res.body.margins[0].margin, 1000);
  });

  it("the writer sees ONLY the final leg and gets NO margin (one-sided end)", async () => {
    const res = await api(BASE, `/work/${workId}/legs`, { token: writerToken });
    assert.equal(res.status, 200);
    assert.deepEqual((res.body.legs as Array<any>).map((l) => l.seq), [3]);
    assert.deepEqual(res.body.margins, [], "a terminal node has no derivable margin");
  });
});

// ─── 🔴 MANDATORY leg-leak (HTTP) ───────────────────────────────────────────────

describe("🔴 MANDATORY leg-leak (HTTP) — true client price never reaches a downstream party", () => {
  let workId = "";

  before(async () => {
    workId = await createWorkItem();
    const res = await api(BASE, `/work/${workId}/legs`, {
      method: "POST",
      token: mominToken,
      body: {
        legs: [
          { seq: 1, fromPartyId: clientPartyId, toPartyId: MOMIN_PARTY, amount: 6000 },
          { seq: 2, fromPartyId: MOMIN_PARTY, toPartyId: EMON_PARTY, amount: 5000 },
          { seq: 3, fromPartyId: EMON_PARTY, toPartyId: writerPartyId, amount: 3000 },
        ],
      },
    });
    assert.equal(res.status, 201);
  });

  it("Emon GET /work/:id/legs returns seq 2 & 3 but NOT seq 1 (the 6000 client price)", async () => {
    const res = await api(BASE, `/work/${workId}/legs`, { token: emonToken });
    assert.equal(res.status, 200, "non-owned legs are filtered, not an error");
    const legs = res.body.legs as Array<any>;
    assert.deepEqual(legs.map((l) => l.seq), [2, 3], "Emon's two legs only");
    assert.ok(!legs.some((l) => Number(l.amount) === 6000), "the 6000 client price must NOT be present");
    assert.ok(!legs.some((l) => l.seq === 1), "seq 1 must be absent (zero rows)");
    assert.ok(!legs.some((l) => l.fromPartyId === clientPartyId), "no leg with from=Client may surface");
    assert.ok(!legs.some((l) => l.toPartyId === MOMIN_PARTY), "the →Momin (top) leg must not surface");
  });

  it("Emon's job-detail also omits seq 1 and yields only Emon's margin (2000)", async () => {
    const res = await api(BASE, `/work/${workId}`, { token: emonToken });
    assert.equal(res.status, 200);
    const legs = res.body.legs as Array<any>;
    assert.deepEqual(legs.map((l) => l.seq), [2, 3]);
    assert.ok(!legs.some((l) => Number(l.amount) === 6000), "detail must not leak the client price either");
    assert.deepEqual((res.body.margins as Array<any>).map((m) => m.partyId), [EMON_PARTY]);
    assert.equal(res.body.margins[0].margin, 2000);
  });

  it("the writer (terminal party, not on the top legs) sees neither 6000 nor 5000", async () => {
    const res = await api(BASE, `/work/${workId}/legs`, { token: writerToken });
    const legs = res.body.legs as Array<any>;
    assert.ok(!legs.some((l) => Number(l.amount) === 6000), "client price hidden from writer");
    assert.ok(!legs.some((l) => Number(l.amount) === 5000), "the Momin→Emon price is also hidden from writer");
    assert.deepEqual(legs.map((l) => l.seq), [3]);
  });
});

// ─── work_line money redaction for a Writer (work:view, no approve) ──────────────

describe("work_line money redaction — Writer (no approve) cannot see client money", () => {
  let workId = "";

  before(async () => {
    workId = await createWorkItem();
    const res = await api(BASE, `/work/${workId}/fan-out`, {
      method: "POST",
      token: mominToken,
      body: {
        producer: { writerPartyId, wordCount: 4000, writerRate: 0.5 },
        consumers: [{ consumerPartyId: clientPartyId, wordCount: 4000, clientRate: 1.5 }],
      },
    });
    assert.equal(res.status, 201);
  });

  it("Writer GET /work/:id sees the consumer line structure but NOT clientRate/amount", async () => {
    const res = await api(BASE, `/work/${workId}`, { token: writerToken });
    assert.equal(res.status, 200);
    const lines = res.body.lines as Array<any>;
    assert.ok(lines.length >= 1, "the line structure is visible (capture-first)");
    for (const l of lines) {
      assert.ok(!("clientRate" in l), "clientRate must be absent for a non-approver");
      assert.ok(!("writerRate" in l), "writerRate must be absent for a non-approver");
      assert.ok(!("fixedAmount" in l), "fixedAmount must be absent for a non-approver");
      assert.ok(!("amount" in l), "the derived money amount must be absent for a non-approver");
    }
  });

  it("momin (work:approve) GET /work/:id sees clientRate + computed amount", async () => {
    const res = await api(BASE, `/work/${workId}`, { token: mominToken });
    assert.equal(res.status, 200);
    const consumer = (res.body.lines as Array<any>).find((l) => l.side === "consumer");
    assert.ok(consumer, "a consumer line exists");
    assert.equal(Number(consumer.clientRate), 1.5, "approver sees the client rate");
    assert.equal(consumer.amount, 6000, "approver sees the derived amount (4000×1.5)");
  });

  it("the fan-out RESPONSE itself never returns money to a Writer who triggers it", async () => {
    // A Writer holds work:create, so may fan-out — but the response must not leak money.
    const wId = await createWorkItem();
    const res = await api(BASE, `/work/${wId}/fan-out`, {
      method: "POST",
      token: writerToken,
      body: {
        producer: { writerPartyId, writerRate: 0.5 },
        consumers: [{ consumerPartyId: clientPartyId, clientRate: 9.99 }],
      },
    });
    assert.equal(res.status, 201, "a Writer may fan-out (work:create)");
    const blob = JSON.stringify(res.body);
    assert.ok(!/9\.99|clientRate|writerRate|"amount"/.test(blob), `fan-out response must not echo money to a Writer: ${blob}`);
  });

  it("the list endpoint never carries any money fields (spec-only projection)", async () => {
    const res = await api(BASE, `/work`, { token: writerToken });
    assert.equal(res.status, 200);
    const blob = JSON.stringify(res.body);
    assert.ok(!/clientRate|writerRate|"amount"/.test(blob), "the list projection must be money-free");
  });
});

// ─── Work-state machine + governance (→confirmed needs work:approve) ────────────

describe("work-state machine + governance (CLAUDE.md §3.7/§3.8)", () => {
  it("a non-adjacent transition (draft→delivered) is rejected with 400", async () => {
    const id = await createWorkItem();
    const res = await api(BASE, `/work/${id}/transition`, {
      method: "POST",
      token: mominToken,
      body: { toState: "delivered" },
    });
    assert.equal(res.status, 400, "the state machine only allows adjacent forward steps");
  });

  it("a Writer (no work:approve) cannot move a job →confirmed (403); claim stays unconfirmed", async () => {
    const id = await createWorkItem();
    // Advance draft→pending first (Writer holds work:create but not edit?) — use momin to set up.
    const toPending = await api(BASE, `/work/${id}/transition`, {
      method: "POST",
      token: mominToken,
      body: { toState: "pending" },
    });
    assert.equal(toPending.status, 201, "draft→pending is a valid adjacent step");
    // Writer attempts pending→confirmed: blocked because confirming needs work:approve.
    const denied = await api(BASE, `/work/${id}/transition`, {
      method: "POST",
      token: writerToken,
      body: { toState: "confirmed" },
    });
    assert.ok(denied.status === 403, `confirming must require work:approve (got ${denied.status})`);
    // The work item must still be unconfirmed (a claim is not a fact).
    const detail = await api(BASE, `/work/${id}`, { token: mominToken });
    assert.equal(detail.body.item.workState, "pending", "an unauthorized confirm must not advance state");
    assert.equal(detail.body.item.confirmedBy, null, "confirmed_by must remain unset");
  });

  it("momin (work:approve) confirms → state=confirmed, confirmed_by set, audit row written", async () => {
    const id = await createWorkItem();
    await api(BASE, `/work/${id}/transition`, { method: "POST", token: mominToken, body: { toState: "pending" } });
    const res = await api(BASE, `/work/${id}/transition`, {
      method: "POST",
      token: mominToken,
      body: { toState: "confirmed" },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.workState, "confirmed");
    assert.ok(res.body.confirmedBy, "confirmed_by must be stamped on the governance step");

    const audit = await admin.query(
      "select count(*)::int n from audit_log where action='work.state_changed' and entity_id=$1",
      [id],
    );
    assert.ok(audit.rows[0].n >= 1, "the state change must be audited immutably");
  });

  it("the two closes are independent: confirming work does NOT change money_state", async () => {
    const id = await createWorkItem();
    const before = await api(BASE, `/work/${id}`, { token: mominToken });
    assert.equal(before.body.item.moneyState, "unbilled");
    await api(BASE, `/work/${id}/transition`, { method: "POST", token: mominToken, body: { toState: "pending" } });
    await api(BASE, `/work/${id}/transition`, { method: "POST", token: mominToken, body: { toState: "confirmed" } });
    const after = await api(BASE, `/work/${id}`, { token: mominToken });
    assert.equal(after.body.item.moneyState, "unbilled", "work-state and money-state move independently");
  });
});

// ─── Boundary validation + server-side authz (CLAUDE.md §4) ──────────────────────

describe("boundary validation + authz (treat client input as hostile)", () => {
  it("POST /work with an empty title → 400", async () => {
    const res = await api(BASE, "/work", { method: "POST", token: mominToken, body: { title: "" } });
    assert.equal(res.status, 400);
  });

  it("fan-out with zero consumers → 400 (ArrayMinSize)", async () => {
    const id = await createWorkItem();
    const res = await api(BASE, `/work/${id}/fan-out`, {
      method: "POST",
      token: mominToken,
      body: { producer: { writerPartyId }, consumers: [] },
    });
    assert.equal(res.status, 400);
  });

  it("a transition to an out-of-enum state → 400", async () => {
    const id = await createWorkItem();
    const res = await api(BASE, `/work/${id}/transition`, {
      method: "POST",
      token: mominToken,
      body: { toState: "shipped" },
    });
    assert.equal(res.status, 400);
  });

  it("a Writer (no work:approve) cannot append legs → 403 (server-side authz)", async () => {
    const id = await createWorkItem();
    const res = await api(BASE, `/work/${id}/legs`, {
      method: "POST",
      token: writerToken,
      body: { legs: [{ seq: 1, fromPartyId: clientPartyId, toPartyId: writerPartyId, amount: 100 }] },
    });
    assert.equal(res.status, 403, "building the money chain requires work:approve");
  });

  it("GET /work/:id with a non-uuid → 400 (ParseUUIDPipe)", async () => {
    const res = await api(BASE, "/work/not-a-uuid", { token: mominToken });
    assert.equal(res.status, 400);
  });
});
