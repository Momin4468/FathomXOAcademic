import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { createPool, sql, withRlsTransaction } from "../src/client.js";
import { env } from "../src/env.js";

/**
 * Module 13 — DATABASE-level proofs for the owner-analytics aggregate definers
 * (0024). Fixtures built via the admin/superuser connection (bypasses RLS);
 * assertions run via the app role with the org GUC set, so the SECURITY DEFINER
 * functions resolve `app_current_org()` to the caller's org. Mirrors
 * rls.test.ts / billing-rls.test.ts conventions.
 *
 * Proves:
 *   • dashboard_writer_pnl() / dashboard_client_dues() are ORG-SCOPED — under
 *     org B's context they return ONLY org B's rows (org A data is invisible),
 *     and aggregates are correct (revenue − writer_cost = net; invoiced − paid
 *     = due).
 *   • the `dashboard` permission module was seeded: approve for a1/a2/a3 (the
 *     owner gate) and view for the broad roles (a6).
 */

const admin = new pg.Client({ connectionString: env.adminUrl });
const appPool = createPool(env.appUrl);

const ORG_SEED = "00000000-0000-4000-8000-000000000001"; // the seeded org (for permission asserts)
const ROLE_A1 = "00000000-0000-4000-8000-0000000000a1";
const ROLE_A2 = "00000000-0000-4000-8000-0000000000a2";
const ROLE_A3 = "00000000-0000-4000-8000-0000000000a3";
const ROLE_A6 = "00000000-0000-4000-8000-0000000000a6";

// Two fresh orgs (tenant isolation).
const orgA = randomUUID();
const orgB = randomUUID();

// org A: a full job — client→partner (6000 revenue) + partner→writer (4000 cost).
const clientA = randomUUID();
const partnerA = randomUUID();
const writerA = randomUUID();
const workItemA = randomUUID();
const legRevenueA = randomUUID();
const legCostA = randomUUID();
const invoiceA = randomUUID();
const workLineA = randomUUID();
const invoiceLineA = randomUUID();
const paymentA = randomUUID();
const allocA = randomUUID();

// org B: its own job — client→partner (1500 revenue) + partner→writer (900 cost).
const clientB = randomUUID();
const partnerB = randomUUID();
const writerB = randomUUID();
const workItemB = randomUUID();
const legRevenueB = randomUUID();
const legCostB = randomUUID();
const invoiceB = randomUUID();
const workLineB = randomUUID();
const invoiceLineB = randomUUID();
const paymentB = randomUUID();
const allocB = randomUUID();

before(async () => {
  await admin.connect();
  await admin.query("insert into org (id, name) values ($1,'M13 Org A'),($2,'M13 Org B')", [orgA, orgB]);

  // ── org A ──────────────────────────────────────────────────────────────────
  await admin.query(
    `insert into party (id, org_id, display_name, party_type) values
       ($1,$4,'ClientA','{client}'),($2,$4,'PartnerA','{partner}'),($3,$4,'WriterA','{writer}')`,
    [clientA, partnerA, writerA, orgA],
  );
  // doer = writer, source = client. revenue = leg FROM source; writer_cost = leg
  // TO a writer-typed party that is NOT the source→partner handoff.
  await admin.query(
    "insert into work_item (id, org_id, title, source_party_id, doer_party_id) values ($1,$2,'M13 A job',$3,$4)",
    [workItemA, orgA, clientA, writerA],
  );
  await admin.query(
    `insert into leg (id, org_id, work_item_id, seq, from_party_id, to_party_id, amount) values
       ($1,$3,$4,1,$5,$6,6000),
       ($2,$3,$4,2,$6,$7,4000)`,
    [legRevenueA, legCostA, orgA, workItemA, clientA, partnerA, writerA],
  );
  // Invoice the client 6000, allocate a PARTIAL 2000 → due 4000.
  await admin.query("insert into work_line (id, org_id, work_item_id, line_kind, consumer_party_id, fixed_amount) values ($1,$2,$3,'copy',$4,6000)", [workLineA, orgA, workItemA, clientA]);
  await admin.query("insert into invoice (id, org_id, client_party_id) values ($1,$2,$3)", [invoiceA, orgA, clientA]);
  await admin.query("insert into invoice_line (id, org_id, invoice_id, work_line_id, amount) values ($1,$2,$3,$4,6000)", [invoiceLineA, orgA, invoiceA, workLineA]);
  await admin.query("insert into payment (id, org_id, direction, amount, paid_at) values ($1,$2,'in',2000, current_date)", [paymentA, orgA]);
  await admin.query("insert into payment_allocation (id, org_id, payment_id, invoice_line_id, amount) values ($1,$2,$3,$4,2000)", [allocA, orgA, paymentA, invoiceLineA]);

  // ── org B ──────────────────────────────────────────────────────────────────
  await admin.query(
    `insert into party (id, org_id, display_name, party_type) values
       ($1,$4,'ClientB','{client}'),($2,$4,'PartnerB','{partner}'),($3,$4,'WriterB','{writer}')`,
    [clientB, partnerB, writerB, orgB],
  );
  await admin.query(
    "insert into work_item (id, org_id, title, source_party_id, doer_party_id) values ($1,$2,'M13 B job',$3,$4)",
    [workItemB, orgB, clientB, writerB],
  );
  await admin.query(
    `insert into leg (id, org_id, work_item_id, seq, from_party_id, to_party_id, amount) values
       ($1,$3,$4,1,$5,$6,1500),
       ($2,$3,$4,2,$6,$7,900)`,
    [legRevenueB, legCostB, orgB, workItemB, clientB, partnerB, writerB],
  );
  await admin.query("insert into work_line (id, org_id, work_item_id, line_kind, consumer_party_id, fixed_amount) values ($1,$2,$3,'copy',$4,1500)", [workLineB, orgB, workItemB, clientB]);
  await admin.query("insert into invoice (id, org_id, client_party_id) values ($1,$2,$3)", [invoiceB, orgB, clientB]);
  await admin.query("insert into invoice_line (id, org_id, invoice_id, work_line_id, amount) values ($1,$2,$3,$4,1500)", [invoiceLineB, orgB, invoiceB, workLineB]);
  await admin.query("insert into payment (id, org_id, direction, amount, paid_at) values ($1,$2,'in',500, current_date)", [paymentB, orgB]);
  await admin.query("insert into payment_allocation (id, org_id, payment_id, invoice_line_id, amount) values ($1,$2,$3,$4,500)", [allocB, orgB, paymentB, invoiceLineB]);
});

after(async () => {
  for (const org of [orgA, orgB]) {
    await admin.query("delete from payment_allocation where org_id=$1", [org]);
    await admin.query("delete from payment where org_id=$1", [org]);
    await admin.query("delete from invoice_line where org_id=$1", [org]);
    await admin.query("delete from invoice where org_id=$1", [org]);
    await admin.query("delete from leg where org_id=$1", [org]);
    await admin.query("delete from work_line where org_id=$1", [org]);
    await admin.query("delete from work_item where org_id=$1", [org]);
    await admin.query("delete from party where org_id=$1", [org]);
    await admin.query("delete from org where id=$1", [org]);
  }
  await admin.end();
  await appPool.end();
});

// ─── dashboard_writer_pnl() — org-scoped + correct aggregation ────────────────

describe("dashboard_writer_pnl() is org-scoped (aggregate-only definer)", () => {
  it("org A context: returns ONLY org A's writer with revenue=6000, cost=4000, net=2000", async () => {
    const rows = await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: false }, async (tx) => {
      const r = await tx.execute(sql`select writer_party_id, jobs, revenue, writer_cost, net from dashboard_writer_pnl()`);
      return r.rows as Array<Record<string, unknown>>;
    });
    const a = rows.find((r) => r.writer_party_id === writerA);
    assert.ok(a, "org A's writer must be present under org A context");
    assert.equal(Number(a!.revenue), 6000, "revenue = Σ legs from the source/client");
    assert.equal(Number(a!.writer_cost), 4000, "writer_cost = Σ legs to writer-typed parties (the handoff)");
    assert.equal(Number(a!.net), 2000, "net = revenue − writer_cost (derived, not stored)");
    assert.ok(!rows.some((r) => r.writer_party_id === writerB), "org B's writer must NOT leak into org A");
  });

  it("🔴 org B context: sees ONLY org B's writer (org A rows invisible)", async () => {
    const rows = await withRlsTransaction(appPool, { orgId: orgB, partyId: null, isSuperadmin: false }, async (tx) => {
      const r = await tx.execute(sql`select writer_party_id, revenue, writer_cost, net from dashboard_writer_pnl()`);
      return r.rows as Array<Record<string, unknown>>;
    });
    assert.ok(!rows.some((r) => r.writer_party_id === writerA), "org A's writer must be invisible under org B context");
    const b = rows.find((r) => r.writer_party_id === writerB);
    assert.ok(b, "org B's own writer is present");
    assert.equal(Number(b!.revenue), 1500);
    assert.equal(Number(b!.writer_cost), 900);
    assert.equal(Number(b!.net), 600, "net = 1500 − 900");
  });
});

// ─── dashboard_client_dues() — org-scoped + correct aggregation ───────────────

describe("dashboard_client_dues() is org-scoped (aggregate-only definer)", () => {
  it("org A context: returns ONLY org A's client with invoiced=6000, paid=2000, due=4000", async () => {
    const rows = await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: false }, async (tx) => {
      const r = await tx.execute(sql`select client_party_id, invoiced, paid, due from dashboard_client_dues()`);
      return r.rows as Array<Record<string, unknown>>;
    });
    const a = rows.find((r) => r.client_party_id === clientA);
    assert.ok(a, "org A's client with an outstanding due is present");
    assert.equal(Number(a!.invoiced), 6000);
    assert.equal(Number(a!.paid), 2000);
    assert.equal(Number(a!.due), 4000, "due = invoiced − paid");
    assert.ok(!rows.some((r) => r.client_party_id === clientB), "org B's client must NOT leak into org A");
  });

  it("🔴 org B context: sees ONLY org B's client (org A rows invisible)", async () => {
    const rows = await withRlsTransaction(appPool, { orgId: orgB, partyId: null, isSuperadmin: false }, async (tx) => {
      const r = await tx.execute(sql`select client_party_id, invoiced, paid, due from dashboard_client_dues()`);
      return r.rows as Array<Record<string, unknown>>;
    });
    assert.ok(!rows.some((r) => r.client_party_id === clientA), "org A's client must be invisible under org B context");
    const b = rows.find((r) => r.client_party_id === clientB);
    assert.ok(b, "org B's own client is present");
    assert.equal(Number(b!.invoiced), 1500);
    assert.equal(Number(b!.paid), 500);
    assert.equal(Number(b!.due), 1000);
  });

  it("a fully-paid client does not surface (having due > 0)", async () => {
    // Settle org B's remaining 1000 via the admin client, then re-query under org B.
    const extraPay = randomUUID();
    const extraAlloc = randomUUID();
    await admin.query("insert into payment (id, org_id, direction, amount, paid_at) values ($1,$2,'in',1000, current_date)", [extraPay, orgB]);
    await admin.query("insert into payment_allocation (id, org_id, payment_id, invoice_line_id, amount) values ($1,$2,$3,$4,1000)", [extraAlloc, orgB, extraPay, invoiceLineB]);
    try {
      const rows = await withRlsTransaction(appPool, { orgId: orgB, partyId: null, isSuperadmin: false }, async (tx) => {
        const r = await tx.execute(sql`select client_party_id from dashboard_client_dues()`);
        return r.rows as Array<Record<string, unknown>>;
      });
      assert.ok(!rows.some((r) => r.client_party_id === clientB), "a settled client (due=0) must not appear");
    } finally {
      await admin.query("delete from payment_allocation where id=$1", [extraAlloc]);
      await admin.query("delete from payment where id=$1", [extraPay]);
    }
  });
});

// ─── permission seed: the dashboard module gate ───────────────────────────────

describe("the `dashboard` permission module was seeded (the owner gate)", () => {
  async function hasPerm(roleId: string, action: string): Promise<boolean> {
    const r = await admin.query(
      "select 1 from permission where org_id=$1 and role_id=$2 and module='dashboard' and action=$3",
      [ORG_SEED, roleId, action],
    );
    return r.rows.length > 0;
  }

  it("approve (the owner analytics gate) is granted to a1, a2, a3", async () => {
    assert.ok(await hasPerm(ROLE_A1, "approve"), "System SuperAdmin has dashboard:approve");
    assert.ok(await hasPerm(ROLE_A2, "approve"), "Business SuperAdmin has dashboard:approve");
    assert.ok(await hasPerm(ROLE_A3, "approve"), "Admin/owner has dashboard:approve");
  });

  it("approve is NOT granted to the Writer role (a6) — non-owner cannot see analytics", async () => {
    assert.equal(await hasPerm(ROLE_A6, "approve"), false, "Writer must NOT hold the owner gate");
  });

  it("view (the 'my numbers' landing) is granted broadly, incl. the Writer role (a6)", async () => {
    assert.ok(await hasPerm(ROLE_A6, "view"), "every role lands on a dashboard");
    assert.ok(await hasPerm(ROLE_A1, "view"));
  });
});
