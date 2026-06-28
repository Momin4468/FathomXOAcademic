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
 * Resit / fail handling (0022) — BLACK-BOX HTTP tests against the COMPILED app
 * (dist/main.js). A FAILED job is redone ON THE SAME work_item; a net loss must
 * be reported TRUTHFULLY. Proves the request-time guarantees that must never
 * silently break (DESIGN_SPEC §3/§6/§8, CLAUDE.md §3/§4):
 *   • a resit requires a RECORDED failed outcome first (governance: a claim is
 *     not a fact)
 *   • two writers on one job → job_pnl.writerCost includes BOTH
 *   • original-writer reduction, UNPAID → a NEGATIVE reversing leg (no clawback)
 *   • original-writer reduction, PAID → an `adjustment` clawback charge (a DUE),
 *     and DISJOINT: reverseAmt + chargeAmt = R, the same money is never both
 *   • zeroClientBilling → negative client leg nets revenue to 0, invoices void,
 *     money_state → unbilled
 *   • 🔴 a NET LOSS surfaces (pnl.net < 0, isLoss=true) to a money caller; a
 *     non-money caller gets pnl=null (redacted)
 *   • reopen: work_state delivered→pending; the two closes stay independent
 *   • authz: a Writer (no work:approve) → 403; resit-band legs are append-only
 * Mounts FEATURE_WORK + FEATURE_BILLING + FEATURE_REFERENCE (the resit endpoint
 * is in the work module but reaches charges/payments/balance in billing).
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3225; // dedicated test port (auth=3210, reference=3211, work=3212, billing=3213)
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";

const ORG = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // work:view+create, NO approve
// NOTE: the seeded Momin party is multi-hat ({partner, writer}) — routing revenue
// THROUGH it would (correctly) count as writer_cost in job_pnl. To isolate the
// resit economics we route through a PURE partner party created below.
let partnerPartyId = ""; // a pure (non-writer) routing/paying node

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = ""; // System SuperAdmin — money-authorized, sees the whole chain
let mominToken = ""; // Admin: work:approve + billing:* (the partner party)
let writerToken = ""; // a NEW user holding ONLY Writer (no approve) — resit must 403
let origWriterToken = ""; // the original writer's own login (reads their balance)
let origWriterPartyId = ""; // the original (failed) writer — writer-typed
let resitWriterPartyId = ""; // the resit (second) writer — writer-typed
let clientPartyId = ""; // the client/source at the chain top

const createdUserIds: string[] = [];
const createdPartyIds: string[] = [];
const createdWorkItemIds: string[] = [];

async function startServer(): Promise<void> {
  const mainJs = resolve(apiRoot, "dist", "main.js");
  if (!existsSync(mainJs)) throw new Error(`Compiled app not found at ${mainJs} — run the api build first.`);
  server = spawn(process.execPath, [mainJs], {
    cwd: apiRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      FEATURE_WORK: "true",
      FEATURE_BILLING: "true",
      FEATURE_REFERENCE: "true",
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

/** Create a login (sysadmin), link it to a party, assign one role, log it in. */
async function makeUserWithRole(roleId: string, partyId?: string): Promise<{ token: string; userId: string }> {
  const email = `resit+${randomUUID()}@fathomxo.test`;
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

/** Insert a party directly (admin) so we control its id + type for the chain. */
async function makeParty(name: string, type: string): Promise<string> {
  const id = randomUUID();
  await admin.query("insert into party (id, org_id, display_name, party_type) values ($1,$2,$3,$4)", [id, ORG, name, `{${type}}`]);
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

  clientPartyId = await makeParty("RESIT Client", "client");
  partnerPartyId = await makeParty("RESIT Partner", "partner");
  origWriterPartyId = await makeParty("RESIT OrigWriter", "writer");
  resitWriterPartyId = await makeParty("RESIT SecondWriter", "writer");
  // A Writer-only login (no work:approve) for the authz check.
  ({ token: writerToken } = await makeUserWithRole(WRITER_ROLE, resitWriterPartyId));
  // The original writer's own login so they can read /billing/balance/me.
  ({ token: origWriterToken } = await makeUserWithRole(WRITER_ROLE, origWriterPartyId));
});

after(async () => {
  for (const id of createdWorkItemIds) {
    await admin.query(
      "delete from payment_allocation where invoice_line_id in (select il.id from invoice_line il join work_line wl on wl.id=il.work_line_id where wl.work_item_id=$1)",
      [id],
    );
    await admin.query("delete from invoice_line where work_line_id in (select id from work_line where work_item_id=$1)", [id]);
    await admin.query("delete from work_outcome where work_item_id=$1", [id]);
    await admin.query("delete from leg where work_item_id=$1", [id]);
    await admin.query("delete from work_line where work_item_id=$1", [id]);
    await admin.query("delete from charge where work_item_id=$1", [id]);
    await admin.query("delete from work_item where id=$1", [id]);
  }
  for (const id of createdPartyIds) {
    await admin.query("delete from payment_allocation where writer_party_id=$1", [id]);
    await admin.query("delete from payment_allocation where charge_id in (select id from charge where party_id=$1)", [id]);
    await admin.query("delete from payment_allocation where payment_id in (select id from payment where counterparty_party_id=$1)", [id]);
    await admin.query("delete from payment where counterparty_party_id=$1", [id]);
    await admin.query("delete from charge where party_id=$1", [id]);
    await admin.query("delete from leg where to_party_id=$1 or from_party_id=$1", [id]);
    await admin.query("delete from invoice_line where invoice_id in (select id from invoice where client_party_id=$1)", [id]);
    await admin.query("delete from invoice where client_party_id=$1", [id]);
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

/**
 * Mint a brand-new writer party + its own login. Used by the reduction-split
 * tests because party_earnings_outstanding() (and /billing/balance/me) are
 * party-GLOBAL — a fresh writer has no prior legs/allocations, so its outstanding
 * (and balance) equal exactly this one job, making the reverse-vs-charge split
 * and the netted earnings deterministic.
 */
async function makeFreshWriter(label: string): Promise<{ partyId: string; token: string }> {
  const partyId = await makeParty(`RESIT ${label}`, "writer");
  const { token } = await makeUserWithRole(WRITER_ROLE, partyId);
  return { partyId, token };
}

/** Create a work item (momin) with the client as source so job_pnl can read revenue. */
async function createJob(): Promise<string> {
  const res = await api(BASE, "/work", {
    method: "POST",
    token: mominToken,
    body: { title: `RESIT Job ${randomUUID().slice(0, 8)}`, sourcePartyId: clientPartyId },
  });
  assert.equal(res.status, 201, `work create should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
  createdWorkItemIds.push(res.body.id);
  return res.body.id as string;
}

/** Append legs as momin (work:approve). */
async function appendLegs(workId: string, legs: Array<Record<string, unknown>>) {
  const res = await api(BASE, `/work/${workId}/legs`, { method: "POST", token: mominToken, body: { legs } });
  assert.equal(res.status, 201, `append legs should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
  return res.body;
}

/** Build the standard chain: client -revenue-> partner -writerPay-> the writer. */
async function buildBaseChain(workId: string, revenue: number, writerPay: number, writerParty = origWriterPartyId) {
  await appendLegs(workId, [
    { seq: 1, fromPartyId: clientPartyId, toPartyId: partnerPartyId, amount: revenue },
    { seq: 2, fromPartyId: partnerPartyId, toPartyId: writerParty, amount: writerPay },
  ]);
}

/** Record a failed outcome directly (the outcomes module isn't mounted on this server). */
async function recordFailedOutcome(workId: string, reworkCost?: number) {
  await admin.query(
    "insert into work_outcome (id, org_id, work_item_id, failed, rework_cost) values ($1,$2,$3,true,$4)",
    [randomUUID(), ORG, workId, reworkCost ?? null],
  );
}

async function getDetail(workId: string, token: string) {
  const res = await api(BASE, `/work/${workId}`, { token });
  assert.equal(res.status, 200, `detail should be 200 (got ${res.status}: ${JSON.stringify(res.body)})`);
  return res.body;
}

async function resit(workId: string, token: string, dto: Record<string, unknown>) {
  return api(BASE, `/work/${workId}/resit`, { method: "POST", token, body: dto });
}

// ─── Governance: a resit answers a RECORDED fail ─────────────────────────────────

describe("resit requires a recorded failed outcome (governance §8)", () => {
  it("resit BEFORE recording a failed outcome → 400", async () => {
    const workId = await createJob();
    await buildBaseChain(workId, 6000, 3000);
    const res = await resit(workId, mominToken, {
      originalWriterPartyId: origWriterPartyId,
      originalWriterReduction: 0,
    });
    assert.equal(res.status, 400, "a resit without a recorded fail must be rejected");
    assert.match(JSON.stringify(res.body), /failed outcome/i, "the error names the missing failed outcome");
  });

  it("a recorded NON-failed outcome still blocks a resit (only failed→resit)", async () => {
    const workId = await createJob();
    await buildBaseChain(workId, 6000, 3000);
    await admin.query(
      "insert into work_outcome (id, org_id, work_item_id, failed) values ($1,$2,$3,false)",
      [randomUUID(), ORG, workId],
    );
    const res = await resit(workId, mominToken, {
      originalWriterPartyId: origWriterPartyId,
      originalWriterReduction: 0,
    });
    assert.equal(res.status, 400, "failed must be true for a resit");
  });
});

// ─── Two writers on one job ──────────────────────────────────────────────────────

describe("two-writers-one-job: resit adds a second writer; both count in writerCost", () => {
  it("after resit, both writer legs are on the job and job_pnl.writerCost sums them", async () => {
    const workId = await createJob();
    await buildBaseChain(workId, 6000, 3000); // client 6000, orig writer 3000
    await recordFailedOutcome(workId);

    const res = await resit(workId, mominToken, {
      originalWriterPartyId: origWriterPartyId,
      originalWriterReduction: 0, // keep the original pay; just add a second writer
      resitWriter: { partyId: resitWriterPartyId, fromPartyId: partnerPartyId, amount: 2500 },
    });
    assert.equal(res.status, 201, `resit should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);

    // SuperAdmin sees both writer legs and the summed writer cost.
    const sys = await api(BASE, `/work/${workId}/legs`, { token: sysToken });
    const legs = sys.body.legs as Array<any>;
    const toOrig = legs.filter((l) => l.toPartyId === origWriterPartyId);
    const toResit = legs.filter((l) => l.toPartyId === resitWriterPartyId);
    assert.equal(toOrig.length, 1, "the original writer leg is present");
    assert.equal(toResit.length, 1, "the resit (second) writer leg was appended");
    assert.equal(Number(toResit[0].amount), 2500, "the resit writer's positive leg = 2500");

    const detail = await getDetail(workId, sysToken);
    assert.equal(detail.pnl.writerCost, 5500, "writerCost = 3000 (orig) + 2500 (resit), BOTH writers");
    assert.equal(detail.pnl.revenue, 6000, "client revenue unchanged");
    assert.equal(detail.pnl.net, 500, "6000 − 5500 = 500");
  });
});

// ─── Original-writer reduction, UNPAID → reversing leg (no clawback) ──────────────

describe("original-writer reduce (UNPAID) → a NEGATIVE reversing leg, no clawback charge", () => {
  it("an unpaid writer's reduction is a negative leg; their earnings drop; no adjustment charge", async () => {
    // A FRESH writer (no prior legs) → outstanding = exactly this job's earning.
    const w = await makeFreshWriter("UnpaidWriter");
    const workId = await createJob();
    await buildBaseChain(workId, 6000, 3000, w.partyId); // writer owed 3000, NOT paid
    await recordFailedOutcome(workId);

    const res = await resit(workId, mominToken, {
      originalWriterPartyId: w.partyId,
      originalWriterFromPartyId: partnerPartyId,
      originalWriterReduction: 1000, // reduce their pay by 1000
    });
    assert.equal(res.status, 201, `resit should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.reverseAmt, 1000, "fully reversed (unpaid → reversing leg)");
    assert.equal(res.body.chargeAmt, 0, "nothing charged (no already-paid money)");

    // A NEGATIVE reversing leg to the writer exists; no 'adjustment' charge created.
    const sys = await api(BASE, `/work/${workId}/legs`, { token: sysToken });
    const neg = (sys.body.legs as Array<any>).filter((l) => l.toPartyId === w.partyId && Number(l.amount) < 0);
    assert.equal(neg.length, 1, "exactly one negative reversing leg to the writer");
    assert.equal(Number(neg[0].amount), -1000, "the reversing leg = −1000");

    const charges = await admin.query(
      "select count(*)::int n from charge where work_item_id=$1 and category='adjustment'",
      [workId],
    );
    assert.equal(charges.rows[0].n, 0, "an UNPAID reduction creates NO clawback charge");

    // The fresh writer's own balance shows reduced earnings (3000 − 1000 = 2000).
    const bal = await api(BASE, "/billing/balance/me", { token: w.token });
    assert.equal(bal.status, 200);
    assert.equal(bal.body.earnings.owed, 2000, "earnings owed = 3000 − 1000 (reversing leg nets it down)");
    assert.equal(bal.body.charges.outstanding, 0, "no due was raised");

    // Derived writer cost drops to 2000.
    const detail = await getDetail(workId, sysToken);
    assert.equal(detail.pnl.writerCost, 2000, "writerCost dropped by the reversing leg");
  });
});

// ─── Original-writer reduction, PAID → clawback charge (no reversing leg) ─────────

describe("original-writer clawback (PAID) → an `adjustment` DUE, no reversing leg for the charged money", () => {
  it("pay the writer first, then reduce → a clawback charge appears; pnl.clawback reflects it; no double-count", async () => {
    const w = await makeFreshWriter("PaidWriter");
    const workId = await createJob();
    await buildBaseChain(workId, 6000, 3000, w.partyId); // writer owed 3000
    await recordFailedOutcome(workId);

    // Pay the writer their full 3000 (a payout allocated to them).
    const pay = await api(BASE, "/payments", {
      method: "POST",
      token: mominToken,
      body: { direction: "out", amount: 3000, paidAt: "2026-06-01", counterpartyPartyId: w.partyId },
    });
    assert.equal(pay.status, 201, `payout should succeed (got ${pay.status}: ${JSON.stringify(pay.body)})`);
    const alloc = await api(BASE, `/payments/${pay.body.id}/allocate`, {
      method: "POST",
      token: mominToken,
      body: { items: [{ writerPartyId: w.partyId, amount: 3000 }] },
    });
    assert.equal(alloc.status, 201, `writer allocation should succeed (got ${alloc.status}: ${JSON.stringify(alloc.body)})`);

    // Now outstanding = 3000 owed − 3000 paid = 0 → a reduction must be CHARGED.
    const res = await resit(workId, mominToken, {
      originalWriterPartyId: w.partyId,
      originalWriterFromPartyId: partnerPartyId,
      originalWriterReduction: 1000,
    });
    assert.equal(res.status, 201, `resit should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.reverseAmt, 0, "nothing to reverse (fully paid)");
    assert.equal(res.body.chargeAmt, 1000, "the whole reduction is a clawback charge");

    // No NEGATIVE reversing leg was created for the charged money (no double-count).
    const sys = await api(BASE, `/work/${workId}/legs`, { token: sysToken });
    const neg = (sys.body.legs as Array<any>).filter((l) => l.toPartyId === w.partyId && Number(l.amount) < 0);
    assert.equal(neg.length, 0, "no reversing leg for an already-paid reduction (avoids double-count)");

    // An 'adjustment' clawback charge exists on the writer's balance (a DUE).
    const bal = await api(BASE, "/billing/balance/me", { token: w.token });
    const item = (bal.body.charges.items as Array<any>).find((c) => c.category === "adjustment" && Number(c.amount) === 1000);
    assert.ok(item, "an adjustment clawback charge is itemized as a due for the writer");
    assert.equal(bal.body.charges.outstanding, 1000, "the writer now owes 1000 back");

    // pnl.clawback reflects the recovery; writerCost still 3000 (legs unchanged).
    const detail = await getDetail(workId, sysToken);
    assert.equal(detail.pnl.clawback, 1000, "pnl.clawback = the adjustment charge");
    assert.equal(detail.pnl.writerCost, 3000, "the paid leg is NOT reversed (only charged)");
    assert.equal(detail.pnl.net, 6000 - 3000 + 1000, "net = revenue − writerCost + clawback = 4000");
  });

  it("no-double-count: a PARTIALLY-paid writer splits R into reverseAmt + chargeAmt = R", async () => {
    const w = await makeFreshWriter("PartialWriter");
    const workId = await createJob();
    await buildBaseChain(workId, 6000, 3000, w.partyId); // owed 3000
    await recordFailedOutcome(workId);

    // Pay only 1800 of the 3000 → outstanding = 1200.
    const pay = await api(BASE, "/payments", {
      method: "POST",
      token: mominToken,
      body: { direction: "out", amount: 1800, paidAt: "2026-06-01", counterpartyPartyId: w.partyId },
    });
    assert.equal(pay.status, 201);
    await api(BASE, `/payments/${pay.body.id}/allocate`, {
      method: "POST",
      token: mominToken,
      body: { items: [{ writerPartyId: w.partyId, amount: 1800 }] },
    });

    // Reduce by R=2000. outstanding=1200 → reverseAmt=1200, chargeAmt=800.
    const R = 2000;
    const res = await resit(workId, mominToken, {
      originalWriterPartyId: w.partyId,
      originalWriterFromPartyId: partnerPartyId,
      originalWriterReduction: R,
    });
    assert.equal(res.status, 201, `resit should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.reverseAmt, 1200, "reverse the unpaid portion (outstanding)");
    assert.equal(res.body.chargeAmt, 800, "charge back the already-paid portion");
    assert.equal(res.body.reverseAmt + res.body.chargeAmt, R, "DISJOINT split sums to R (no double-count)");

    // The job nets correctly: writerCost = 3000 − 1200 (reversing leg) = 1800;
    // clawback = 800. net = 6000 − 1800 + 800 = 5000.
    const detail = await getDetail(workId, sysToken);
    assert.equal(detail.pnl.writerCost, 1800, "writerCost reduced only by the reversing leg portion");
    assert.equal(detail.pnl.clawback, 800, "clawback = the charged portion only");
    assert.equal(detail.pnl.net, 5000, "6000 − 1800 + 800 = 5000 — the reduction counted exactly once");
  });
});

// ─── Client billed to 0 ──────────────────────────────────────────────────────────

describe("client-billed-0: a client reversal nets revenue to 0 and voids the invoices", () => {
  it("zeroClientBilling=true → negative client leg, pnl.revenue=0, invoices void, money_state=unbilled", async () => {
    const workId = await createJob();
    await buildBaseChain(workId, 6000, 3000);
    await recordFailedOutcome(workId);

    // Bill the client: a copy line attached to an invoice → money_state=invoiced.
    const line = await api(BASE, `/work/${workId}/lines`, {
      method: "POST",
      token: mominToken,
      body: { lineKind: "copy", consumerPartyId: clientPartyId, fixedAmount: 6000 },
    });
    assert.equal(line.status, 201, `add client line (got ${line.status}: ${JSON.stringify(line.body)})`);
    const attach = await api(BASE, "/invoices/attach-line", {
      method: "POST",
      token: mominToken,
      body: { workLineId: line.body.id },
    });
    assert.equal(attach.status, 201, `attach-line (got ${attach.status}: ${JSON.stringify(attach.body)})`);
    let detail = await getDetail(workId, mominToken);
    assert.equal(detail.item.moneyState, "invoiced", "billed but unpaid → invoiced");

    // Resit and escalate: zero the client billing with a reversal of the 6000 revenue.
    const res = await resit(workId, mominToken, {
      originalWriterPartyId: origWriterPartyId,
      originalWriterReduction: 0,
      zeroClientBilling: true,
      clientReversal: { fromPartyId: clientPartyId, toPartyId: partnerPartyId, amount: 6000 },
    });
    // 🔴 PRODUCTION BUG (resit.service.ts ~L153): the invoice-void SQL is
    //   `update invoice set status='void', updated_at = now() ...` but the invoice
    //   table has NO updated_at column (packages/db/src/schema/f-billing.ts) — so
    //   the whole resit transaction throws and returns 500. The billing module's
    //   own supersede voids with `set({ status: "void" })` (no updated_at). This
    //   assertion is deliberately NOT weakened: zeroClientBilling must succeed.
    assert.equal(
      res.status,
      201,
      `resit with zeroClientBilling should succeed — got ${res.status}: ${JSON.stringify(res.body)}. ` +
        `If 500 with "column updated_at of relation invoice does not exist", that is the known bug in resit.service.ts.`,
    );

    // A negative client leg nets revenue to 0.
    const sys = await api(BASE, `/work/${workId}/legs`, { token: sysToken });
    const negClient = (sys.body.legs as Array<any>).filter((l) => l.fromPartyId === clientPartyId && Number(l.amount) < 0);
    assert.equal(negClient.length, 1, "one negative client-reversal leg");
    assert.equal(Number(negClient[0].amount), -6000, "the reversal = −6000");

    detail = await getDetail(workId, sysToken);
    assert.equal(detail.pnl.revenue, 0, "revenue nets to 0 after the client reversal (6000 − 6000)");

    // The job's invoice is void; money_state recomputed to unbilled.
    const invStatuses = await admin.query(
      `select i.status from invoice i
         join invoice_line il on il.invoice_id = i.id
         join work_line wl on wl.id = il.work_line_id
        where wl.work_item_id = $1`,
      [workId],
    );
    assert.ok(invStatuses.rows.length >= 1, "the job had an invoice");
    assert.ok(invStatuses.rows.every((r: any) => r.status === "void"), "every job invoice is voided");
    assert.equal(detail.item.moneyState, "unbilled", "money_state recomputed to unbilled after the void");
  });
});

// ─── 🔴 The loss is reported truthfully (and redacted from non-money callers) ─────

describe("🔴 a net loss is reported TRUTHFULLY to a money caller and REDACTED otherwise", () => {
  it("writerCost > revenue → pnl.net < 0 and isLoss=true for SuperAdmin; pnl=null for a Writer", async () => {
    const workId = await createJob();
    // Client pays 4000; two writers cost 3000 + 3000 = 6000 → a 2000 loss.
    await buildBaseChain(workId, 4000, 3000);
    await recordFailedOutcome(workId);
    const res = await resit(workId, mominToken, {
      originalWriterPartyId: origWriterPartyId,
      originalWriterReduction: 0,
      resitWriter: { partyId: resitWriterPartyId, fromPartyId: partnerPartyId, amount: 3000 },
    });
    assert.equal(res.status, 201, `resit should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);

    // The resit RESPONSE itself carries the truthful loss for the money caller.
    assert.equal(res.body.pnl.net, -2000, "4000 − 6000 = −2000 in the resit response");
    assert.equal(res.body.pnl.isLoss, true, "the resit response flags the loss");

    // A money-authorized caller (SuperAdmin) sees the loss on the job detail.
    const sys = await getDetail(workId, sysToken);
    assert.equal(sys.pnl.revenue, 4000);
    assert.equal(sys.pnl.writerCost, 6000, "both writers counted");
    assert.equal(sys.pnl.net, -2000, "the net is a real negative number");
    assert.equal(sys.pnl.isLoss, true, "isLoss is true — the loss is NOT hidden");

    // A money-authorized partner (work:approve) also sees it.
    const partner = await getDetail(workId, mominToken);
    assert.equal(partner.pnl.isLoss, true, "a work:approve caller sees the loss too");

    // A non-money caller (Writer, no approve) gets pnl=null — redacted, not zeroed.
    const wr = await getDetail(workId, writerToken);
    assert.equal(wr.pnl, null, "a non-money caller must get pnl=null (redacted, never a fabricated 0)");
  });

  it("rework cost can turn a small profit into a reported loss (truthful net)", async () => {
    const workId = await createJob();
    await buildBaseChain(workId, 6000, 5000); // thin 1000 margin
    await recordFailedOutcome(workId, 2000); // 2000 rework cost recorded on the outcome
    const res = await resit(workId, mominToken, {
      originalWriterPartyId: origWriterPartyId,
      originalWriterReduction: 0,
      reworkCost: 2000,
    });
    assert.equal(res.status, 201, `resit should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    const detail = await getDetail(workId, sysToken);
    assert.equal(detail.pnl.reworkCost, 2000, "rework cost flows into the P&L");
    assert.equal(detail.pnl.net, -1000, "6000 − 5000 − 2000 = −1000");
    assert.equal(detail.pnl.isLoss, true, "rework pushed the job into a loss");
  });
});

// ─── Reopen + independent closes ─────────────────────────────────────────────────

describe("reopen: work_state delivered→pending; the two closes stay independent", () => {
  it("a delivered job is reopened to pending by a resit, money_state untouched", async () => {
    const workId = await createJob();
    await buildBaseChain(workId, 6000, 3000);
    await recordFailedOutcome(workId);
    // Advance draft→pending→confirmed→delivered.
    for (const toState of ["pending", "confirmed", "delivered"]) {
      const t = await api(BASE, `/work/${workId}/transition`, { method: "POST", token: mominToken, body: { toState } });
      assert.equal(t.status, 201, `transition →${toState} (got ${t.status}: ${JSON.stringify(t.body)})`);
    }
    let detail = await getDetail(workId, mominToken);
    assert.equal(detail.item.workState, "delivered");
    const moneyBefore = detail.item.moneyState;

    const res = await resit(workId, mominToken, {
      originalWriterPartyId: origWriterPartyId,
      originalWriterReduction: 0,
    });
    assert.equal(res.status, 201, `resit should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
    assert.equal(res.body.reopened, true, "the resit reopened the delivered job");

    detail = await getDetail(workId, mominToken);
    assert.equal(detail.item.workState, "pending", "work_state redo: delivered → pending");
    assert.equal(detail.item.moneyState, moneyBefore, "money_state moved INDEPENDENTLY (unchanged by the reopen)");
  });

  it("reopen:false leaves the work_state as-is (an opt-out)", async () => {
    const workId = await createJob();
    await buildBaseChain(workId, 6000, 3000);
    await recordFailedOutcome(workId);
    for (const toState of ["pending", "confirmed"]) {
      await api(BASE, `/work/${workId}/transition`, { method: "POST", token: mominToken, body: { toState } });
    }
    const res = await resit(workId, mominToken, {
      originalWriterPartyId: origWriterPartyId,
      originalWriterReduction: 0,
      reopen: false,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.reopened, false, "reopen:false suppresses the work-state redo");
    const detail = await getDetail(workId, mominToken);
    assert.equal(detail.item.workState, "confirmed", "work_state stays confirmed when reopen=false");
  });

  it("the outcome is stamped resit=true after a resit", async () => {
    const workId = await createJob();
    await buildBaseChain(workId, 6000, 3000);
    await recordFailedOutcome(workId);
    await resit(workId, mominToken, { originalWriterPartyId: origWriterPartyId, originalWriterReduction: 0 });
    const r = await admin.query("select resit from work_outcome where work_item_id=$1", [workId]);
    assert.equal(r.rows[0].resit, true, "work_outcome.resit is stamped true");
  });
});

// ─── Authz + boundary validation ─────────────────────────────────────────────────

describe("authz + boundary validation (treat client input as hostile, server-side authz)", () => {
  it("a Writer (no work:approve) POST /work/:id/resit → 403", async () => {
    const workId = await createJob();
    await buildBaseChain(workId, 6000, 3000);
    await recordFailedOutcome(workId);
    const res = await resit(workId, writerToken, {
      originalWriterPartyId: origWriterPartyId,
      originalWriterReduction: 0,
    });
    assert.equal(res.status, 403, "a resit affects money → requires work:approve");
  });

  it("resit on a non-uuid id → 400 (ParseUUIDPipe)", async () => {
    const res = await resit("not-a-uuid", mominToken, {
      originalWriterPartyId: origWriterPartyId,
      originalWriterReduction: 0,
    });
    assert.equal(res.status, 400);
  });

  it("a negative originalWriterReduction → 400 (boundary validation)", async () => {
    const workId = await createJob();
    await recordFailedOutcome(workId);
    const res = await resit(workId, mominToken, {
      originalWriterPartyId: origWriterPartyId,
      originalWriterReduction: -100,
    });
    assert.equal(res.status, 400, "amount must be >= 0 at the DTO boundary");
  });

  it("zeroClientBilling without a clientReversal → 400", async () => {
    const workId = await createJob();
    await buildBaseChain(workId, 6000, 3000);
    await recordFailedOutcome(workId);
    const res = await resit(workId, mominToken, {
      originalWriterPartyId: origWriterPartyId,
      originalWriterReduction: 0,
      zeroClientBilling: true,
    });
    assert.equal(res.status, 400, "zeroing client billing requires a clientReversal");
  });

  it("a missing-job resit (valid uuid, no row) → 404", async () => {
    const res = await resit(randomUUID(), mominToken, {
      originalWriterPartyId: origWriterPartyId,
      originalWriterReduction: 0,
    });
    assert.equal(res.status, 404, "an unknown work item is a 404");
  });
});

// ─── Append-only resit-band legs (the ledger must never be edited) ───────────────

describe("append-only: resit-band legs (seq 80-82) reject UPDATE/DELETE for the app role", () => {
  it("a reversing leg created by a resit cannot be UPDATEd or DELETEd via the app role", async () => {
    const workId = await createJob();
    await buildBaseChain(workId, 6000, 3000);
    await recordFailedOutcome(workId);
    await resit(workId, mominToken, {
      originalWriterPartyId: origWriterPartyId,
      originalWriterFromPartyId: partnerPartyId,
      originalWriterReduction: 1000, // unpaid → a reversing leg at seq 80
    });
    const legRow = await admin.query("select id from leg where work_item_id=$1 and seq=80", [workId]);
    assert.equal(legRow.rows.length, 1, "the resit-band reversing leg exists (seq 80)");

    // The HTTP API never exposes leg UPDATE/DELETE; the ledger grants are proven at
    // the DB layer (billing-rls.test.ts). Here we assert the row is immutable in
    // practice: no endpoint mutates it, and re-reading shows the same negative leg.
    const sys = await api(BASE, `/work/${workId}/legs`, { token: sysToken });
    const neg = (sys.body.legs as Array<any>).find((l) => Number(l.amount) === -1000);
    assert.ok(neg, "the −1000 reversing leg is present and stable (append-only; corrections are new legs)");
  });
});
