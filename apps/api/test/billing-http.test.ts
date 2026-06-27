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
 * Module 5 (invoicing + payments/allocation + bidirectional charges) — BLACK-BOX
 * HTTP tests against the COMPILED app (dist/main.js). Proves the request-time
 * guarantees that must NEVER silently break:
 *   • live-grouping (N lines → one open invoice; auto-join)
 *   • partial-within-job AND bulk-across-jobs allocation; derived paid/due
 *   • the two parallel closes move INDEPENDENTLY
 *   • 🔴 a party-owes-business charge surfaces as an itemized DUE in that party's
 *     balance, nets against earnings, and is opaque to other parties
 *   • estimate → supersede (void but retained)
 *   • server-side authz: a Writer (no billing perm) is 403 on money writes
 * Requires FEATURE_BILLING + FEATURE_WORK so /invoices,/payments,/charges,/work mount.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) config({ path: rootEnv });

const PORT = 3213; // dedicated test port (auth=3210, reference=3211, work=3212)
const BASE = `http://localhost:${PORT}`;
const DEV_PASSWORD = "Password123!";

const ORG = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLE = "00000000-0000-4000-8000-0000000000a6"; // work:view+create, NO billing
const ADMIN_ROLE = "00000000-0000-4000-8000-0000000000a3"; // billing:* + work + ...

let server: ChildProcess;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL_ADMIN });

let sysToken = ""; // System SuperAdmin
let mominToken = ""; // Admin: billing:view/create/edit/approve
let writerToken = ""; // a NEW user holding ONLY Writer (no billing) — money-writes must 403
let writerPartyId = ""; // the chain's terminal `to` AND a charge target
let otherWriterToken = ""; // a second writer-party (charge-opacity check)
let otherWriterPartyId = "";
let clientPartyId = ""; // the client at the top of the chain

const createdUserIds: string[] = [];
const createdPartyIds: string[] = [];
const createdWorkItemIds: string[] = [];

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

/** Create a login (sysadmin), link it to a party, assign one role, log it in. */
async function makeUserWithRole(roleId: string, partyId?: string): Promise<{ token: string; userId: string }> {
  const email = `m5user+${randomUUID()}@fathomxo.test`;
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

before(async () => {
  await admin.connect();
  await startServer();

  const s = await login("sysadmin@fathomxo.local", DEV_PASSWORD);
  assert.equal(s.status, 200);
  sysToken = s.body.accessToken;

  const m = await login("momin@fathomxo.local", DEV_PASSWORD);
  assert.equal(m.status, 200);
  mominToken = m.body.accessToken;

  clientPartyId = await makeParty("M5TEST Client", "client");
  writerPartyId = await makeParty("M5TEST Writer", "writer");
  otherWriterPartyId = await makeParty("M5TEST OtherWriter", "writer");
  ({ token: writerToken } = await makeUserWithRole(WRITER_ROLE, writerPartyId));
  // The other writer needs a login + a balance-readable role; Writer role lacks
  // billing, but /billing/balance/me is open to any authenticated party.
  ({ token: otherWriterToken } = await makeUserWithRole(WRITER_ROLE, otherWriterPartyId));
});

after(async () => {
  for (const id of createdWorkItemIds) {
    await admin.query("delete from payment_allocation where invoice_line_id in (select il.id from invoice_line il join work_line wl on wl.id=il.work_line_id where wl.work_item_id=$1)", [id]);
    await admin.query("delete from invoice_line where work_line_id in (select id from work_line where work_item_id=$1)", [id]);
    await admin.query("delete from leg where work_item_id=$1", [id]);
    await admin.query("delete from work_line where work_item_id=$1", [id]);
    await admin.query("delete from work_item where id=$1", [id]);
  }
  for (const id of createdPartyIds) {
    // Allocations first (they reference payments, invoice_lines, charges).
    await admin.query("delete from payment_allocation where charge_id in (select id from charge where party_id=$1)", [id]);
    await admin.query("delete from payment_allocation where writer_party_id=$1", [id]);
    await admin.query(
      "delete from payment_allocation where invoice_line_id in (select il.id from invoice_line il join invoice i on i.id=il.invoice_id where i.client_party_id=$1)",
      [id],
    );
    await admin.query("delete from payment_allocation where payment_id in (select id from payment where counterparty_party_id=$1)", [id]);
    // Then the payments that name this party as counterparty.
    await admin.query("delete from payment where counterparty_party_id=$1", [id]);
    // Charges, legs, and the client's invoices (+ their lines).
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

/** Create a work item (momin) and track it for teardown. */
async function createWorkItem(): Promise<string> {
  const res = await api(BASE, "/work", { method: "POST", token: mominToken, body: { title: `M5TEST Job ${randomUUID().slice(0, 8)}` } });
  assert.equal(res.status, 201, `work create should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
  createdWorkItemIds.push(res.body.id);
  return res.body.id as string;
}

/** Add a billable consumer (client) line via the work module; returns its id. */
async function addClientLine(workId: string, amount: number, consumer = clientPartyId): Promise<string> {
  const res = await api(BASE, `/work/${workId}/lines`, {
    method: "POST",
    token: mominToken,
    body: { lineKind: "copy", consumerPartyId: consumer, fixedAmount: amount },
  });
  assert.equal(res.status, 201, `add line should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
  return res.body.id as string;
}

/** Attach a work line to the client's open invoice; return the invoice_line id. */
async function attachLine(workLineId: string, invoiceId?: string): Promise<{ invoiceLineId: string; invoiceId: string }> {
  const res = await api(BASE, "/invoices/attach-line", {
    method: "POST",
    token: mominToken,
    body: { workLineId, ...(invoiceId ? { invoiceId } : {}) },
  });
  assert.equal(res.status, 201, `attach-line should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
  return { invoiceLineId: res.body.id, invoiceId: res.body.invoiceId };
}

async function recordPayment(direction: "in" | "out", amount: number, counterparty?: string): Promise<string> {
  const res = await api(BASE, "/payments", {
    method: "POST",
    token: mominToken,
    body: { direction, amount, paidAt: "2026-06-01", ...(counterparty ? { counterpartyPartyId: counterparty } : {}) },
  });
  assert.equal(res.status, 201, `record payment should succeed (got ${res.status}: ${JSON.stringify(res.body)})`);
  return res.body.id as string;
}

// ─── Live grouping ───────────────────────────────────────────────────────────────

describe("invoice live-grouping (N billable lines auto-join one open invoice §6)", () => {
  it("attaching multiple client lines lands them all on ONE open invoice", async () => {
    const workId = await createWorkItem();
    const l1 = await addClientLine(workId, 1000);
    const l2 = await addClientLine(workId, 2000);
    const a1 = await attachLine(l1);
    const a2 = await attachLine(l2);
    assert.equal(a1.invoiceId, a2.invoiceId, "both lines join the client's single open invoice");

    // A third (and a 4th) auto-join the same open invoice.
    const l3 = await addClientLine(workId, 3000);
    const l4 = await addClientLine(workId, 500);
    const a3 = await attachLine(l3);
    const a4 = await attachLine(l4);
    assert.equal(a3.invoiceId, a1.invoiceId, "3rd line auto-joins the open invoice");
    assert.equal(a4.invoiceId, a1.invoiceId, "4th line auto-joins the open invoice");

    const inv = await api(BASE, `/invoices/${a1.invoiceId}`, { token: mominToken });
    assert.equal(inv.status, 200);
    assert.equal((inv.body.lines as Array<any>).length, 4, "all four lines grouped");
  });
});

// ─── Partial-within-a-job allocation ────────────────────────────────────────────

describe("partial allocation within a job (6000 line; pay 3000 → due 3000; then settle)", () => {
  let workId = "";
  let invoiceLineId = "";

  it("a half payment leaves due=3000 and money_state=partial", async () => {
    workId = await createWorkItem();
    const line = await addClientLine(workId, 6000);
    ({ invoiceLineId } = await attachLine(line));

    // Before any payment: billed=6000, allocated=0 → invoiced.
    let detail = await api(BASE, `/work/${workId}`, { token: mominToken });
    assert.equal(detail.body.item.moneyState, "invoiced", "billed but unpaid → invoiced");

    const payId = await recordPayment("in", 3000, clientPartyId);
    const alloc = await api(BASE, `/payments/${payId}/allocate`, {
      method: "POST",
      token: mominToken,
      body: { items: [{ invoiceLineId, amount: 3000 }] },
    });
    assert.equal(alloc.status, 201, `allocate should succeed (got ${alloc.status}: ${JSON.stringify(alloc.body)})`);

    const inv = await api(BASE, `/invoices/${(await attachLineInvoice(invoiceLineId))}`, { token: mominToken });
    const il = (inv.body.lines as Array<any>).find((l) => l.id === invoiceLineId);
    assert.equal(il.paid, 3000, "derived paid = 3000");
    assert.equal(il.due, 3000, "derived due = amount − paid = 3000");

    detail = await api(BASE, `/work/${workId}`, { token: mominToken });
    assert.equal(detail.body.item.moneyState, "partial", "0 < allocated < billed → partial");
  });

  it("paying the remainder settles the line (due=0, money_state=settled)", async () => {
    const payId = await recordPayment("in", 3000, clientPartyId);
    const alloc = await api(BASE, `/payments/${payId}/allocate`, {
      method: "POST",
      token: mominToken,
      body: { items: [{ invoiceLineId, amount: 3000 }] },
    });
    assert.equal(alloc.status, 201);

    const detail = await api(BASE, `/work/${workId}`, { token: mominToken });
    assert.equal(detail.body.item.moneyState, "settled", "allocated == billed → settled");
  });
});

/** Helper: find the invoice id holding a given invoice line (via list of the client). */
async function attachLineInvoice(invoiceLineId: string): Promise<string> {
  const res = await admin.query("select invoice_id from invoice_line where id=$1", [invoiceLineId]);
  return res.rows[0].invoice_id as string;
}

// ─── Bulk-across-jobs allocation ────────────────────────────────────────────────

describe("bulk allocation across ≥3 jobs in one call (each line's paid/due correct)", () => {
  it("one payment is split across three jobs' lines atomically", async () => {
    const jobs: Array<{ workId: string; invoiceLineId: string; amount: number }> = [];
    for (const amt of [1000, 2000, 3000]) {
      const workId = await createWorkItem();
      const line = await addClientLine(workId, amt);
      const { invoiceLineId } = await attachLine(line);
      jobs.push({ workId, invoiceLineId, amount: amt });
    }

    const payId = await recordPayment("in", 6000, clientPartyId);
    const alloc = await api(BASE, `/payments/${payId}/allocate`, {
      method: "POST",
      token: mominToken,
      body: { items: jobs.map((j) => ({ invoiceLineId: j.invoiceLineId, amount: j.amount })) },
    });
    assert.equal(alloc.status, 201, `bulk allocate should succeed (got ${alloc.status}: ${JSON.stringify(alloc.body)})`);

    for (const j of jobs) {
      const invId = await attachLineInvoice(j.invoiceLineId);
      const inv = await api(BASE, `/invoices/${invId}`, { token: mominToken });
      const il = (inv.body.lines as Array<any>).find((l) => l.id === j.invoiceLineId);
      assert.equal(il.paid, j.amount, `job ${j.amount}: derived paid = full`);
      assert.equal(il.due, 0, `job ${j.amount}: due = 0`);
      const detail = await api(BASE, `/work/${j.workId}`, { token: mominToken });
      assert.equal(detail.body.item.moneyState, "settled", `job ${j.amount} settled by the bulk payment`);
    }
  });

  it("over-allocating a payment → 400 (cannot allocate more than the event)", async () => {
    const workId = await createWorkItem();
    const line = await addClientLine(workId, 5000);
    const { invoiceLineId } = await attachLine(line);
    const payId = await recordPayment("in", 1000, clientPartyId);
    const alloc = await api(BASE, `/payments/${payId}/allocate`, {
      method: "POST",
      token: mominToken,
      body: { items: [{ invoiceLineId, amount: 5000 }] },
    });
    assert.equal(alloc.status, 400, "allocations may not exceed the payment amount");
  });
});

// ─── Estimate → supersede ────────────────────────────────────────────────────────

describe("estimate → supersede (final supersedes estimate; estimate voided but GETtable)", () => {
  it("a final invoice references the estimate, which becomes void yet still readable", async () => {
    const workId = await createWorkItem();
    const line = await addClientLine(workId, 4000);
    const est = await api(BASE, "/invoices", { method: "POST", token: mominToken, body: { clientPartyId, isEstimate: true } });
    assert.equal(est.status, 201);
    const estimateId = est.body.id as string;
    await attachLine(line, estimateId);

    const sup = await api(BASE, `/invoices/${estimateId}/supersede`, { method: "POST", token: mominToken });
    assert.equal(sup.status, 201, `supersede should succeed (got ${sup.status}: ${JSON.stringify(sup.body)})`);
    assert.equal(sup.body.supersedesInvoiceId, estimateId, "final.supersedesInvoiceId = the estimate");
    assert.equal(sup.body.isEstimate, false, "the superseding invoice is final");

    const estAfter = await api(BASE, `/invoices/${estimateId}`, { token: mominToken });
    assert.equal(estAfter.status, 200, "the estimate is retained in history (still GETtable)");
    assert.equal(estAfter.body.invoice.status, "void", "the estimate is voided, not deleted");
  });
});

// ─── Two parallel closes ─────────────────────────────────────────────────────────

describe("two parallel closes move independently (work-state vs money-state)", () => {
  it("invoicing + full allocation moves money_state but NOT work_state", async () => {
    const workId = await createWorkItem();
    const before = await api(BASE, `/work/${workId}`, { token: mominToken });
    const workStateBefore = before.body.item.workState;
    assert.equal(before.body.item.moneyState, "unbilled");

    const line = await addClientLine(workId, 4000);
    const { invoiceLineId } = await attachLine(line);
    const payId = await recordPayment("in", 4000, clientPartyId);
    await api(BASE, `/payments/${payId}/allocate`, { method: "POST", token: mominToken, body: { items: [{ invoiceLineId, amount: 4000 }] } });

    const after = await api(BASE, `/work/${workId}`, { token: mominToken });
    assert.equal(after.body.item.moneyState, "settled", "money close advanced to settled");
    assert.equal(after.body.item.workState, workStateBefore, "the WORK close did NOT move when money moved");
  });

  it("a work_state transition leaves money_state unchanged", async () => {
    const workId = await createWorkItem();
    // bill + partially pay so money_state=partial.
    const line = await addClientLine(workId, 4000);
    const { invoiceLineId } = await attachLine(line);
    const payId = await recordPayment("in", 1000, clientPartyId);
    await api(BASE, `/payments/${payId}/allocate`, { method: "POST", token: mominToken, body: { items: [{ invoiceLineId, amount: 1000 }] } });
    let detail = await api(BASE, `/work/${workId}`, { token: mominToken });
    assert.equal(detail.body.item.moneyState, "partial");

    // advance work draft→pending→confirmed.
    await api(BASE, `/work/${workId}/transition`, { method: "POST", token: mominToken, body: { toState: "pending" } });
    await api(BASE, `/work/${workId}/transition`, { method: "POST", token: mominToken, body: { toState: "confirmed" } });

    detail = await api(BASE, `/work/${workId}`, { token: mominToken });
    assert.equal(detail.body.item.workState, "confirmed", "work close advanced");
    assert.equal(detail.body.item.moneyState, "partial", "the MONEY close did NOT move when work moved");
  });
});

// ─── 🔴 Bidirectional charge as a DUE (the headline ask) ─────────────────────────

describe("🔴 bidirectional charge surfaces as a DUE in the party's balance", () => {
  let workId = "";

  it("a writer with an earnings leg AND a platform_fee charge sees both, netted", async () => {
    // Earnings: a leg of 3000 TO the writer.
    workId = await createWorkItem();
    const legs = await api(BASE, `/work/${workId}/legs`, {
      method: "POST",
      token: mominToken,
      body: { legs: [{ seq: 1, fromPartyId: clientPartyId, toPartyId: writerPartyId, amount: 3000 }] },
    });
    assert.equal(legs.status, 201, `append leg should succeed (got ${legs.status}: ${JSON.stringify(legs.body)})`);

    // Charge: a 500 platform fee the writer OWES the business.
    const charge = await api(BASE, "/charges", {
      method: "POST",
      token: mominToken,
      body: { partyId: writerPartyId, category: "platform_fee", amount: 500, reason: "monthly tool fee" },
    });
    assert.equal(charge.status, 201, `create charge should succeed (got ${charge.status}: ${JSON.stringify(charge.body)})`);

    const bal = await api(BASE, "/billing/balance/me", { token: writerToken });
    assert.equal(bal.status, 200, "any authenticated party may read their own balance");
    assert.equal(bal.body.earnings.owed, 3000, "earnings owed = the leg to the writer");
    assert.equal(bal.body.charges.outstanding, 500, "the platform fee is an outstanding due");
    const item = (bal.body.charges.items as Array<any>).find((c) => c.category === "platform_fee");
    assert.ok(item, "the charge is itemized in the balance");
    assert.equal(Number(item.due), 500, "the itemized due = the charge amount");
    assert.equal(bal.body.net, 2500, "net = earningsOutstanding(3000) − chargesOutstanding(500)");
  });

  it("a payment from the writer allocated to the charge drives chargesOutstanding → 0", async () => {
    // Find the charge id from the writer's own balance (RLS-scoped to them).
    const balBefore = await api(BASE, "/billing/balance/me", { token: writerToken });
    const chargeId = (balBefore.body.charges.items as Array<any>).find((c) => c.category === "platform_fee").id as string;

    const payId = await recordPayment("in", 500, writerPartyId);
    const alloc = await api(BASE, `/payments/${payId}/allocate`, {
      method: "POST",
      token: mominToken,
      body: { items: [{ chargeId, amount: 500 }] },
    });
    assert.equal(alloc.status, 201, `allocate to charge should succeed (got ${alloc.status}: ${JSON.stringify(alloc.body)})`);

    const bal = await api(BASE, "/billing/balance/me", { token: writerToken });
    assert.equal(bal.body.charges.outstanding, 0, "the charge is now settled");
    assert.equal(bal.body.net, 3000, "net back to full earnings once the due is paid");
  });

  it("🔴 a DIFFERENT writer's balance does NOT include that charge (opacity)", async () => {
    const bal = await api(BASE, "/billing/balance/me", { token: otherWriterToken });
    assert.equal(bal.status, 200);
    assert.equal(bal.body.charges.owed, 0, "another party never sees this charge");
    assert.deepEqual(bal.body.charges.items, [], "no charge items leak across parties");
  });
});

// ─── Server-side authz (a Writer has NO billing perm) ────────────────────────────

describe("server-side authz — a Writer (no billing perm) cannot write money", () => {
  it("POST /invoices → 403 for a Writer", async () => {
    const res = await api(BASE, "/invoices", { method: "POST", token: writerToken, body: { clientPartyId } });
    assert.equal(res.status, 403, "creating an invoice needs billing:create");
  });

  it("POST /payments → 403 for a Writer", async () => {
    const res = await api(BASE, "/payments", { method: "POST", token: writerToken, body: { direction: "in", amount: 100, paidAt: "2026-06-01" } });
    assert.equal(res.status, 403, "recording a payment needs billing:create");
  });

  it("POST /charges → 403 for a Writer", async () => {
    const res = await api(BASE, "/charges", { method: "POST", token: writerToken, body: { partyId: writerPartyId, category: "platform_fee", amount: 100 } });
    assert.equal(res.status, 403, "creating a charge needs billing:create");
  });

  it("momin (billing:create) IS allowed to create an invoice", async () => {
    const res = await api(BASE, "/invoices", { method: "POST", token: mominToken, body: { clientPartyId } });
    assert.equal(res.status, 201, "an authorized admin may create an invoice");
  });

  it("reversing a payment requires billing:approve (Writer → 403)", async () => {
    const payId = await recordPayment("in", 100, clientPartyId);
    const res = await api(BASE, `/payments/${payId}/reverse`, { method: "POST", token: writerToken, body: { reason: "x" } });
    assert.equal(res.status, 403, "reversal is an approve-gated correction");
  });
});

// ─── Boundary validation + audit ─────────────────────────────────────────────────

describe("boundary validation + immutable audit of money writes", () => {
  it("POST /payments with a negative amount → 400", async () => {
    const res = await api(BASE, "/payments", { method: "POST", token: mominToken, body: { direction: "in", amount: -50, paidAt: "2026-06-01" } });
    assert.equal(res.status, 400, "amount must be >= 0 (validated at the boundary)");
  });

  it("POST /charges with an out-of-enum category → 400", async () => {
    const res = await api(BASE, "/charges", { method: "POST", token: mominToken, body: { partyId: writerPartyId, category: "bribe", amount: 100 } });
    assert.equal(res.status, 400, "category is an enum, validated at the boundary");
  });

  it("allocate with a non-uuid payment id → 400 (ParseUUIDPipe)", async () => {
    const res = await api(BASE, "/payments/not-a-uuid/allocate", { method: "POST", token: mominToken, body: { items: [{ chargeId: randomUUID(), amount: 1 }] } });
    assert.equal(res.status, 400);
  });

  it("each money write leaves an immutable audit row", async () => {
    const payId = await recordPayment("in", 250, clientPartyId);
    const audit = await admin.query("select count(*)::int n from audit_log where action='billing.payment_recorded' and entity_id=$1", [payId]);
    assert.ok(audit.rows[0].n >= 1, "recording a payment must be audited");
  });
});
