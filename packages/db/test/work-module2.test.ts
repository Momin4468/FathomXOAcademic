import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { createPool, sql, withRlsTransaction } from "../src/client.js";
import { env } from "../src/env.js";

/**
 * Module 2 — DATABASE-level proofs for the work/leg model (CLAUDE.md §3/§4,
 * SCHEMA §C/§D). Built with the admin/superuser connection (bypasses RLS);
 * asserted via the app role (RLS ENFORCED). Mirrors rls.test.ts conventions.
 *
 * The MANDATORY leg-leak guarantee is asserted here at the lowest layer: a
 * downstream party (Emon) gets ZERO rows for the true client price (seq 1), and
 * a wholly-unrelated party gets zero rows for the whole chain.
 */

const admin = new pg.Client({ connectionString: env.adminUrl });
const appPool = createPool(env.appUrl);

// Org A fixtures (unique per run so reruns don't collide).
const orgA = randomUUID();
const orgB = randomUUID();
const client = randomUUID();
const momin = randomUUID();
const emon = randomUUID();
const writer = randomUUID();
const stranger = randomUUID(); // a party with NO legs on this job

const workItem = randomUUID();
const legClientMomin = randomUUID(); // seq 1 — TRUE client price 6000; Emon NOT a party
const legMominEmon = randomUUID(); // seq 2 — 5000; Emon is `to`
const legEmonWriter = randomUUID(); // seq 3 — 3000; Emon is `from`, Writer is `to`

// Copy fan-out fixtures (one producer line, two consumer lines).
const producerLine = randomUUID();
const consumerLineA = randomUUID();
const consumerLineB = randomUUID();

// Org B (tenant isolation).
const clientB = randomUUID();
const workItemB = randomUUID();
const lineB = randomUUID();
const legB = randomUUID();

before(async () => {
  await admin.connect();
  await admin.query("insert into org (id, name) values ($1,'M2 Org A'),($2,'M2 Org B')", [orgA, orgB]);
  await admin.query(
    `insert into party (id, org_id, display_name, party_type) values
       ($1,$6,'Client','{client}'),($2,$6,'Momin','{partner}'),
       ($3,$6,'Emon','{partner}'),($4,$6,'Writer','{writer}'),
       ($5,$6,'Stranger','{writer}')`,
    [client, momin, emon, writer, stranger, orgA],
  );
  await admin.query("insert into work_item (id, org_id, title) values ($1,$2,'ICT701 A3 (M2)')", [
    workItem,
    orgA,
  ]);
  // The 3-leg chain: Client -6000-> Momin -5000-> Emon -3000-> Writer.
  await admin.query(
    `insert into leg (id, org_id, work_item_id, seq, from_party_id, to_party_id, amount) values
       ($1,$7,$8,1,$4,$5,6000),
       ($2,$7,$8,2,$5,$6,5000),
       ($3,$7,$8,3,$6,$9,3000)`,
    [legClientMomin, legMominEmon, legEmonWriter, client, momin, emon, orgA, workItem, writer],
  );
  // Copy fan-out: one PRODUCER line (writer side) + two CONSUMER lines (client side),
  // each pointing back to the producer via source_line_id, each its own client_rate.
  await admin.query(
    `insert into work_line (id, org_id, work_item_id, line_kind, writer_party_id, unit_count, writer_rate)
       values ($1,$2,$3,'copy',$4,2,0.5)`,
    [producerLine, orgA, workItem, writer],
  );
  await admin.query(
    `insert into work_line (id, org_id, work_item_id, line_kind, consumer_party_id, unit_count, client_rate, source_line_id)
       values ($1,$2,$3,'copy',$4,1,1.5,$5), ($6,$2,$3,'copy',$7,1,2.0,$5)`,
    [consumerLineA, orgA, workItem, client, producerLine, consumerLineB, emon],
  );

  // Org B: its own item + line + leg, for tenant isolation.
  await admin.query("insert into party (id, org_id, display_name, party_type) values ($1,$2,'ClientB','{client}')", [clientB, orgB]);
  await admin.query("insert into work_item (id, org_id, title) values ($1,$2,'OrgB job (M2)')", [workItemB, orgB]);
  await admin.query(
    `insert into work_line (id, org_id, work_item_id, line_kind, consumer_party_id, client_rate)
       values ($1,$2,$3,'copy',$4,9.0)`,
    [lineB, orgB, workItemB, clientB],
  );
  await admin.query(
    "insert into leg (id, org_id, work_item_id, seq, from_party_id, to_party_id, amount) values ($1,$2,$3,1,$4,$4,1000)",
    [legB, orgB, workItemB, clientB],
  );
});

after(async () => {
  for (const org of [orgA, orgB]) {
    await admin.query("delete from leg where org_id=$1", [org]);
    await admin.query("delete from work_line where org_id=$1", [org]);
    await admin.query("delete from work_item where org_id=$1", [org]);
    await admin.query("delete from party where org_id=$1", [org]);
    await admin.query("delete from org where id=$1", [org]);
  }
  await admin.end();
  await appPool.end();
});

/** Rows of leg (id, seq, amount, from, to) visible to a given RLS context. */
async function legsVisibleTo(partyId: string | null, isSuperadmin: boolean) {
  return withRlsTransaction(appPool, { orgId: orgA, partyId, isSuperadmin }, async (tx) => {
    const res = await tx.execute(
      sql`select seq, amount::float8 as amount, from_party_id, to_party_id
            from leg where work_item_id = ${workItem} order by seq`,
    );
    return res.rows as Array<{ seq: number; amount: number; from_party_id: string | null; to_party_id: string | null }>;
  });
}

describe("Module 2 — leg chain visibility (structural opacity, SCHEMA §D)", () => {
  it("SuperAdmin sees the whole chain (all 3 legs, all amounts)", async () => {
    const rows = await legsVisibleTo(null, true);
    assert.deepEqual(rows.map((r) => Number(r.seq)), [1, 2, 3]);
    assert.deepEqual(rows.map((r) => r.amount), [6000, 5000, 3000]);
  });

  it("Momin sees seq 1 & 2 only (his two legs); margin derivable = 1000", async () => {
    const rows = await legsVisibleTo(momin, false);
    assert.deepEqual(rows.map((r) => Number(r.seq)), [1, 2]);
    const inbound = rows.find((r) => r.to_party_id === momin)!.amount; // 6000
    const outbound = rows.find((r) => r.from_party_id === momin)!.amount; // 5000
    assert.equal(inbound - outbound, 1000, "Momin's derived margin");
  });

  it("the writer sees ONLY the final leg (seq 3); no second leg → no margin", async () => {
    const rows = await legsVisibleTo(writer, false);
    assert.deepEqual(rows.map((r) => Number(r.seq)), [3]);
    assert.equal(rows.length, 1, "one-sided → cannot derive a margin");
  });
});

describe("🔴 MANDATORY leg-leak — the true client price is structurally invisible", () => {
  it("Emon sees seq 2 & 3 but NEVER seq 1 (Client→Momin 6000) — zero rows for it", async () => {
    const rows = await legsVisibleTo(emon, false);
    assert.deepEqual(rows.map((r) => Number(r.seq)), [2, 3], "Emon's two legs only");
    // Hard leak assertions: no visible leg may carry the client price or the client party.
    assert.ok(!rows.some((r) => r.amount === 6000), "the 6000 client price must NOT be visible to Emon");
    assert.ok(!rows.some((r) => Number(r.seq) === 1), "seq 1 must be ZERO rows for Emon");
    assert.ok(!rows.some((r) => r.from_party_id === client), "no leg with from=Client may surface to Emon");
  });

  it("a totally-unrelated party (no legs on this job) gets ZERO rows, not an error", async () => {
    const rows = await legsVisibleTo(stranger, false);
    assert.deepEqual(rows, [], "non-party → empty result set");
  });

  it("Emon's derived margin (5000−3000) is 2000 and reveals nothing about the 6000", async () => {
    const rows = await legsVisibleTo(emon, false);
    const inbound = rows.find((r) => r.to_party_id === emon)!.amount; // 5000
    const outbound = rows.find((r) => r.from_party_id === emon)!.amount; // 3000
    assert.equal(inbound - outbound, 2000);
  });
});

describe("Module 2 — copy fan-out shape at the data layer (SCHEMA §C, §3.2)", () => {
  it("one producer line (writer side) + N consumer lines (client side) linked by source_line_id", async () => {
    const rows = await withRlsTransaction(
      appPool,
      { orgId: orgA, partyId: null, isSuperadmin: true },
      async (tx) => {
        const res = await tx.execute(
          sql`select id, consumer_party_id, writer_party_id, source_line_id, client_rate::float8 as client_rate
                from work_line where work_item_id = ${workItem} order by client_rate nulls first`,
        );
        return res.rows as Array<{
          id: string;
          consumer_party_id: string | null;
          writer_party_id: string | null;
          source_line_id: string | null;
          client_rate: number | null;
        }>;
      },
    );
    const producers = rows.filter((r) => r.writer_party_id && !r.consumer_party_id);
    const consumers = rows.filter((r) => r.consumer_party_id && !r.writer_party_id);
    assert.equal(producers.length, 1, "exactly one producer entry");
    assert.equal(consumers.length, 2, "two fanned consumer lines");
    // Each consumer points back to the single producer (and never both sides).
    for (const c of consumers) {
      assert.equal(c.source_line_id, producerLine, "consumer.source_line_id = producer line id");
      assert.equal(c.writer_party_id, null, "a consumer line is not also producer-side");
    }
    // Independent client_rates (1.5 and 2.0) — fan-out prices are not shared.
    assert.deepEqual(consumers.map((c) => c.client_rate).sort(), [1.5, 2.0]);
    // The producer carries no client_rate (writer side only).
    assert.equal(producers[0].client_rate, null);
  });
});

describe("Module 2 — tenant isolation (org A context, CLAUDE.md §3.1)", () => {
  const cases: Array<{ table: string; id: string; q: (tx: any) => Promise<number> }> = [
    {
      table: "work_item",
      id: workItemB,
      q: async (tx) => {
        const r = await tx.execute(sql`select count(*)::int as n from work_item where id = ${workItemB}`);
        return (r.rows[0] as { n: number }).n;
      },
    },
    {
      table: "work_line",
      id: lineB,
      q: async (tx) => {
        const r = await tx.execute(sql`select count(*)::int as n from work_line where id = ${lineB}`);
        return (r.rows[0] as { n: number }).n;
      },
    },
    {
      table: "leg",
      id: legB,
      q: async (tx) => {
        const r = await tx.execute(sql`select count(*)::int as n from leg where id = ${legB}`);
        return (r.rows[0] as { n: number }).n;
      },
    },
  ];
  for (const c of cases) {
    it(`org B ${c.table} is invisible under org A context (even as SuperAdmin)`, async () => {
      const n = await withRlsTransaction(
        appPool,
        { orgId: orgA, partyId: null, isSuperadmin: true },
        c.q,
      );
      assert.equal(n, 0, `org B's ${c.table} row must be invisible under org A`);
    });
  }
});

describe("Module 2 — legs are append-only for the app role (CLAUDE.md §3.4)", () => {
  it("rejects UPDATE on leg (correct via reversing entry, never edit)", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
        await tx.execute(sql`update leg set amount = 1 where id = ${legMominEmon}`);
      }),
      /permission denied/i,
    );
  });

  it("rejects DELETE on leg", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
        await tx.execute(sql`delete from leg where id = ${legEmonWriter}`);
      }),
      /permission denied/i,
    );
  });
});
