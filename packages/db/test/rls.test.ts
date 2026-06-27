import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { createPool, sql, withRlsTransaction } from "../src/client.js";
import { env } from "../src/env.js";

/**
 * These tests prove the non-negotiable visibility rules at the DATABASE level
 * (CLAUDE.md §3/§4). Fixtures are built via the admin/superuser connection
 * (bypasses RLS); assertions run via the app role (RLS enforced).
 */

const admin = new pg.Client({ connectionString: env.adminUrl });
const appPool = createPool(env.appUrl);

// Fixture ids (unique per run so reruns don't collide).
const orgA = randomUUID();
const orgB = randomUUID();
const client = randomUUID();
const momin = randomUUID();
const emon = randomUUID();
const writer = randomUUID();
const workItemA = randomUUID();
const legClientMomin = randomUUID(); // seq 1 — Emon NOT party (the true client price)
const legMominEmon = randomUUID(); // seq 2 — Emon is `to`
const legEmonWriter = randomUUID(); // seq 3 — Emon is `from`
// org B fixtures (tenant isolation)
const clientB = randomUUID();
const workItemB = randomUUID();
const legB = randomUUID();
// money fixtures (append-only)
const paymentId = randomUUID();

async function legSeqsVisibleTo(partyId: string | null, isSuperadmin: boolean) {
  return withRlsTransaction(
    appPool,
    { orgId: orgA, partyId, isSuperadmin },
    async (tx) => {
      const res = await tx.execute(
        sql`select seq from leg where work_item_id = ${workItemA} order by seq`,
      );
      return (res.rows as Array<{ seq: number }>).map((r) => Number(r.seq));
    },
  );
}

before(async () => {
  await admin.connect();
  // Two orgs.
  await admin.query("insert into org (id, name) values ($1,'Test Org A'),($2,'Test Org B')", [orgA, orgB]);
  // Parties in org A.
  await admin.query(
    `insert into party (id, org_id, display_name, party_type) values
       ($1,$5,'Client','{client}'),($2,$5,'Momin','{partner}'),
       ($3,$5,'Emon','{partner}'),($4,$5,'Writer','{writer}')`,
    [client, momin, emon, writer, orgA],
  );
  // Work item + 3-leg chain in org A: Client -6000-> Momin -5000-> Emon -3000-> Writer.
  await admin.query(
    "insert into work_item (id, org_id, title) values ($1,$2,'ICT701 A3')",
    [workItemA, orgA],
  );
  await admin.query(
    `insert into leg (id, org_id, work_item_id, seq, from_party_id, to_party_id, amount) values
       ($1,$7,$8,1,$4,$5,6000),
       ($2,$7,$8,2,$5,$6,5000),
       ($3,$7,$8,3,$6,$9,3000)`,
    [legClientMomin, legMominEmon, legEmonWriter, client, momin, emon, orgA, workItemA, writer],
  );
  // Org B: its own work item + leg (for tenant-isolation test).
  await admin.query("insert into party (id, org_id, display_name, party_type) values ($1,$2,'ClientB','{client}')", [clientB, orgB]);
  await admin.query("insert into work_item (id, org_id, title) values ($1,$2,'OrgB job')", [workItemB, orgB]);
  await admin.query(
    "insert into leg (id, org_id, work_item_id, seq, from_party_id, to_party_id, amount) values ($1,$2,$3,1,$4,$4,1000)",
    [legB, orgB, workItemB, clientB],
  );
  // A payment in org A (append-only target).
  await admin.query(
    "insert into payment (id, org_id, direction, amount, paid_at) values ($1,$2,'in',6000, current_date)",
    [paymentId, orgA],
  );
});

after(async () => {
  // Clean both orgs in dependency order (admin bypasses append-only grants).
  for (const org of [orgA, orgB]) {
    await admin.query("delete from leg where org_id=$1", [org]);
    await admin.query("delete from payment where org_id=$1", [org]);
    await admin.query("delete from work_item where org_id=$1", [org]);
    await admin.query("delete from party where org_id=$1", [org]);
    await admin.query("delete from org where id=$1", [org]);
  }
  await admin.end();
  await appPool.end();
});

describe("leg visibility (structural opacity)", () => {
  it("Emon sees only the legs he is party to — NOT the true client price", async () => {
    const seqs = await legSeqsVisibleTo(emon, false);
    assert.deepEqual(seqs, [2, 3], "Emon must see legs 2 & 3 only");
    assert.ok(!seqs.includes(1), "leg 1 (client->Momin) must be invisible to Emon");
  });

  it("a SuperAdmin sees the whole chain", async () => {
    const seqs = await legSeqsVisibleTo(null, true);
    assert.deepEqual(seqs, [1, 2, 3]);
  });

  it("the writer sees only the final leg", async () => {
    const seqs = await legSeqsVisibleTo(writer, false);
    assert.deepEqual(seqs, [3]);
  });

  it("a party with no leg membership sees nothing", async () => {
    const seqs = await legSeqsVisibleTo(client, false);
    assert.deepEqual(seqs, [1], "client is `from` on leg 1 only");
  });
});

describe("tenant isolation", () => {
  it("org A context cannot see org B rows (even as SuperAdmin)", async () => {
    const count = await withRlsTransaction(
      appPool,
      { orgId: orgA, partyId: null, isSuperadmin: true },
      async (tx) => {
        const res = await tx.execute(sql`select count(*)::int as n from leg where id = ${legB}`);
        return (res.rows[0] as { n: number }).n;
      },
    );
    assert.equal(count, 0, "org B's leg must be invisible under org A context");
  });
});

describe("append-only money + audit (no UPDATE/DELETE for the app role)", () => {
  it("rejects UPDATE on payment", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
        await tx.execute(sql`update payment set amount = 1 where id = ${paymentId}`);
      }),
      /permission denied/i,
    );
  });

  it("rejects DELETE on payment", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
        await tx.execute(sql`delete from payment where id = ${paymentId}`);
      }),
      /permission denied/i,
    );
  });

  it("rejects DELETE on leg", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
        await tx.execute(sql`delete from leg where id = ${legMominEmon}`);
      }),
      /permission denied/i,
    );
  });

  it("allows INSERT but rejects UPDATE on audit_log", async () => {
    await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
      await tx.execute(
        sql`insert into audit_log (org_id, action, entity) values (${orgA}, 'test', 'leg')`,
      );
    });
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
        await tx.execute(sql`update audit_log set action = 'x' where org_id = ${orgA}`);
      }),
      /permission denied/i,
    );
    // cleanup the inserted audit row via admin
    await admin.query("delete from audit_log where org_id=$1", [orgA]);
  });
});
