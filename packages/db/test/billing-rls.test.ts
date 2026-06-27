import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { createPool, sql, withRlsTransaction } from "../src/client.js";
import { env } from "../src/env.js";

/**
 * Module 5 — DATABASE-level proofs for the billing ledger (CLAUDE.md §3/§4,
 * SCHEMA §F + 0009). Fixtures built via the admin/superuser connection (bypasses
 * RLS + append-only grants); assertions run via the app role (RLS + grants
 * ENFORCED). Mirrors rls.test.ts conventions.
 *
 * Proves:
 *   • append-only: UPDATE/DELETE on payment, payment_allocation, charge are
 *     rejected for the app role (corrections must be reversing entries).
 *   • charge structural opacity: a writer sees ONLY their own dues; another
 *     writer gets ZERO rows (not an error); SuperAdmin sees all.
 *   • tenant isolation on charge.
 */

const admin = new pg.Client({ connectionString: env.adminUrl });
const appPool = createPool(env.appUrl);

const orgA = randomUUID();
const orgB = randomUUID();
const writerA = randomUUID();
const writerB = randomUUID();
const clientA = randomUUID();
const workItemA = randomUUID();
const workLineA = randomUUID();
const invoiceA = randomUUID();
const invoiceLineA = randomUUID();
const paymentA = randomUUID();
const allocA = randomUUID();
const chargeA = randomUUID(); // a due on writerA
// org B
const partyB = randomUUID();
const chargeB = randomUUID();

before(async () => {
  await admin.connect();
  await admin.query("insert into org (id, name) values ($1,'M5 Org A'),($2,'M5 Org B')", [orgA, orgB]);
  await admin.query(
    `insert into party (id, org_id, display_name, party_type) values
       ($1,$4,'WriterA','{writer}'),($2,$4,'WriterB','{writer}'),($3,$4,'ClientA','{client}')`,
    [writerA, writerB, clientA, orgA],
  );
  await admin.query("insert into party (id, org_id, display_name, party_type) values ($1,$2,'PartyB','{writer}')", [partyB, orgB]);

  await admin.query("insert into work_item (id, org_id, title) values ($1,$2,'M5 job')", [workItemA, orgA]);
  await admin.query(
    "insert into work_line (id, org_id, work_item_id, line_kind, consumer_party_id, fixed_amount) values ($1,$2,$3,'copy',$4,6000)",
    [workLineA, orgA, workItemA, clientA],
  );
  await admin.query(
    "insert into invoice (id, org_id, client_party_id) values ($1,$2,$3)",
    [invoiceA, orgA, clientA],
  );
  await admin.query(
    "insert into invoice_line (id, org_id, invoice_id, work_line_id, amount) values ($1,$2,$3,$4,6000)",
    [invoiceLineA, orgA, invoiceA, workLineA],
  );
  await admin.query(
    "insert into payment (id, org_id, direction, amount, paid_at) values ($1,$2,'in',6000, current_date)",
    [paymentA, orgA],
  );
  await admin.query(
    "insert into payment_allocation (id, org_id, payment_id, invoice_line_id, amount) values ($1,$2,$3,$4,3000)",
    [allocA, orgA, paymentA, invoiceLineA],
  );
  // A platform-fee charge that writerA OWES the business.
  await admin.query(
    "insert into charge (id, org_id, party_id, category, amount, reason) values ($1,$2,$3,'platform_fee',500,'monthly tool fee')",
    [chargeA, orgA, writerA],
  );
  // Org B charge (tenant isolation).
  await admin.query(
    "insert into charge (id, org_id, party_id, category, amount) values ($1,$2,$3,'platform_fee',999)",
    [chargeB, orgB, partyB],
  );
});

after(async () => {
  for (const org of [orgA, orgB]) {
    await admin.query("delete from payment_allocation where org_id=$1", [org]);
    await admin.query("delete from charge where org_id=$1", [org]);
    await admin.query("delete from payment where org_id=$1", [org]);
    await admin.query("delete from invoice_line where org_id=$1", [org]);
    await admin.query("delete from invoice where org_id=$1", [org]);
    await admin.query("delete from work_line where org_id=$1", [org]);
    await admin.query("delete from work_item where org_id=$1", [org]);
    await admin.query("delete from party where org_id=$1", [org]);
    await admin.query("delete from org where id=$1", [org]);
  }
  await admin.end();
  await appPool.end();
});

// ─── Append-only (no UPDATE/DELETE grants for the app role) ──────────────────────

describe("append-only money ledger — payment", () => {
  it("rejects UPDATE on payment", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
        await tx.execute(sql`update payment set amount = 1 where id = ${paymentA}`);
      }),
      /permission denied/i,
    );
  });
  it("rejects DELETE on payment", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
        await tx.execute(sql`delete from payment where id = ${paymentA}`);
      }),
      /permission denied/i,
    );
  });
});

describe("append-only money ledger — payment_allocation", () => {
  it("rejects UPDATE on payment_allocation", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
        await tx.execute(sql`update payment_allocation set amount = 1 where id = ${allocA}`);
      }),
      /permission denied/i,
    );
  });
  it("rejects DELETE on payment_allocation", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
        await tx.execute(sql`delete from payment_allocation where id = ${allocA}`);
      }),
      /permission denied/i,
    );
  });
  it("ALLOWS INSERT on payment_allocation (links are appended, never edited)", async () => {
    const id = randomUUID();
    await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
      await tx.execute(sql`
        insert into payment_allocation (id, org_id, payment_id, invoice_line_id, amount)
        values (${id}, ${orgA}, ${paymentA}, ${invoiceLineA}, 100)
      `);
    });
    await admin.query("delete from payment_allocation where id=$1", [id]);
  });
});

describe("append-only money ledger — charge (party→business due)", () => {
  it("rejects UPDATE on charge", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: writerA, isSuperadmin: false }, async (tx) => {
        await tx.execute(sql`update charge set amount = 1 where id = ${chargeA}`);
      }),
      /permission denied/i,
    );
  });
  it("rejects DELETE on charge", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: writerA, isSuperadmin: false }, async (tx) => {
        await tx.execute(sql`delete from charge where id = ${chargeA}`);
      }),
      /permission denied/i,
    );
  });
  it("ALLOWS INSERT on charge (corrections are reversing entries)", async () => {
    const id = randomUUID();
    await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
      await tx.execute(sql`
        insert into charge (id, org_id, party_id, category, amount, reverses_charge_id)
        values (${id}, ${orgA}, ${writerA}, 'adjustment', -500, ${chargeA})
      `);
    });
    await admin.query("delete from charge where id=$1", [id]);
  });
});

// ─── Charge structural opacity (a writer sees only their OWN dues) ───────────────

async function chargeIdsVisibleTo(partyId: string | null, isSuperadmin: boolean) {
  return withRlsTransaction(appPool, { orgId: orgA, partyId, isSuperadmin }, async (tx) => {
    const res = await tx.execute(sql`select id from charge where id = ${chargeA}`);
    return (res.rows as Array<{ id: string }>).map((r) => r.id);
  });
}

describe("charge opacity — a party sees only their own dues", () => {
  it("WriterA (the owing party) sees their own charge", async () => {
    assert.deepEqual(await chargeIdsVisibleTo(writerA, false), [chargeA]);
  });

  it("🔴 WriterB sees ZERO rows for WriterA's charge (not an error)", async () => {
    assert.deepEqual(await chargeIdsVisibleTo(writerB, false), [], "another writer's due must be invisible");
  });

  it("SuperAdmin sees WriterA's charge", async () => {
    assert.deepEqual(await chargeIdsVisibleTo(null, true), [chargeA]);
  });

  it("tenant isolation: org A context cannot see org B's charge (even as SuperAdmin)", async () => {
    const count = await withRlsTransaction(
      appPool,
      { orgId: orgA, partyId: null, isSuperadmin: true },
      async (tx) => {
        const res = await tx.execute(sql`select count(*)::int as n from charge where id = ${chargeB}`);
        return (res.rows[0] as { n: number }).n;
      },
    );
    assert.equal(count, 0, "org B's charge must be invisible under org A context");
  });
});
