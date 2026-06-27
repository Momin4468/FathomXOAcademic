import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { deriveSettlement } from "@business-os/shared";
import { createPool, sql, withRlsTransaction } from "../src/client.js";
import { env } from "../src/env.js";

/**
 * Settlement layer (0015) — DATABASE-level proofs (DESIGN_SPEC §4.4, §3).
 * Fixtures built via the admin/superuser connection (bypasses RLS + grants);
 * assertions run via the app role (RLS + SECURITY DEFINER caller-guards
 * ENFORCED). Mirrors billing-rls.test.ts / rls.test.ts conventions.
 *
 * The CRITICAL guarantee proved here: a partner sees the SHARED pool but NEVER
 * the other partner's private legs (the true client price). Anchored to §3.1's
 * worked example: Client→Momin→Emon→Writer legs 6000/5000/3000 →
 * settlement_legs(Momin,Emon) pool = 5000 − 3000 = 2000.
 */

const admin = new pg.Client({ connectionString: env.adminUrl });
const appPool = createPool(env.appUrl);

const orgA = randomUUID();
const orgB = randomUUID();
const client = randomUUID();
const momin = randomUUID();
const emon = randomUUID();
const writer = randomUUID();
const workItemA = randomUUID();
const legClientMomin = randomUUID(); // seq 1 — the 6000 true client price (private to Momin)
const legMominEmon = randomUUID(); // seq 2 — the 5000 inter-partner handoff
const legEmonWriter = randomUUID(); // seq 3 — the 3000 writer cost
// org B (tenant isolation)
const partyB = randomUUID();
// transfers
const transferMominEmon = randomUUID();

before(async () => {
  await admin.connect();
  await admin.query("insert into org (id, name) values ($1,'SETL Org A'),($2,'SETL Org B')", [orgA, orgB]);
  await admin.query(
    `insert into party (id, org_id, display_name, party_type) values
       ($1,$5,'Client','{client}'),($2,$5,'Momin','{partner}'),
       ($3,$5,'Emon','{partner}'),($4,$5,'Writer','{writer}')`,
    [client, momin, emon, writer, orgA],
  );
  await admin.query("insert into party (id, org_id, display_name, party_type) values ($1,$2,'PartyB','{partner}')", [partyB, orgB]);

  await admin.query("insert into work_item (id, org_id, title) values ($1,$2,'SETL job')", [workItemA, orgA]);
  await admin.query(
    `insert into leg (id, org_id, work_item_id, seq, from_party_id, to_party_id, amount) values
       ($1,$7,$8,1,$4,$5,6000),
       ($2,$7,$8,2,$5,$6,5000),
       ($3,$7,$8,3,$6,$9,3000)`,
    [legClientMomin, legMominEmon, legEmonWriter, client, momin, emon, orgA, workItemA, writer],
  );

  // A dated transfer Momin→Emon (admin insert; tests RLS visibility of it).
  await admin.query(
    "insert into settlement_transfer (id, org_id, from_party_id, to_party_id, amount, transferred_at) values ($1,$2,$3,$4,1000,current_date)",
    [transferMominEmon, orgA, momin, emon],
  );
});

after(async () => {
  for (const org of [orgA, orgB]) {
    await admin.query("delete from settlement_transfer where org_id=$1", [org]);
    await admin.query("delete from leg where org_id=$1", [org]);
    await admin.query("delete from work_item where org_id=$1", [org]);
    await admin.query("delete from party where org_id=$1", [org]);
    await admin.query("delete from org where id=$1", [org]);
  }
  await admin.end();
  await appPool.end();
});

// ─── 🔴 Private-leg opacity (the mandatory test) ─────────────────────────────────

describe("🔴 settlement private-leg opacity (DESIGN_SPEC §4.4) — pool only, never the client price", () => {
  async function settlementLegsAs(partyId: string | null, isSuperadmin: boolean, a = momin, b = emon) {
    return withRlsTransaction(appPool, { orgId: orgA, partyId, isSuperadmin }, async (tx) => {
      const res = await tx.execute(
        sql`select work_item_id, job_date, upstream_party, downstream_party, pool from settlement_legs(${a}, ${b})`,
      );
      return res.rows as Array<{
        work_item_id: string;
        job_date: string;
        upstream_party: string;
        downstream_party: string;
        pool: string;
      }>;
    });
  }

  it("Emon cannot read leg seq 1 (the 6000 client price) — ZERO rows, not an error", async () => {
    const seqs = await withRlsTransaction(appPool, { orgId: orgA, partyId: emon, isSuperadmin: false }, async (tx) => {
      const res = await tx.execute(sql`select seq from leg where id = ${legClientMomin}`);
      return (res.rows as Array<{ seq: number }>).map((r) => Number(r.seq));
    });
    assert.deepEqual(seqs, [], "the upstream's private client leg must be invisible to Emon");
  });

  it("Emon sees ONE settlement row with pool=2000 and NO column equal to 6000 (only the shared pool)", async () => {
    const rows = await settlementLegsAs(emon, false);
    assert.equal(rows.length, 1, "exactly the one shared job");
    assert.equal(Number(rows[0].pool), 2000, "pool = handoff 5000 − writer cost 3000");
    assert.equal(rows[0].upstream_party, momin, "upstream = Momin (the handoff `from`)");
    assert.equal(rows[0].downstream_party, emon, "downstream = Emon (the handoff `to`)");
    // The crux: no field anywhere in the row may equal the 6000 client price.
    for (const [k, v] of Object.entries(rows[0])) {
      assert.notEqual(Number(v), 6000, `column ${k} must never reveal the 6000 client price`);
    }
  });

  it("Momin sees the same shared pool=2000 (symmetric shared figure)", async () => {
    const rows = await settlementLegsAs(momin, false);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].pool), 2000, "Momin sees the identical shared pool");
  });

  it("🔴 the Writer (a non-partner) gets ZERO rows from settlement_legs(Momin,Emon) (caller guard)", async () => {
    const rows = await settlementLegsAs(writer, false);
    assert.deepEqual(rows, [], "a non-partner must see no shared settlement figures");
  });

  it("System SuperAdmin sees the shared row", async () => {
    const rows = await settlementLegsAs(null, true);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].pool), 2000);
  });
});

// ─── party_job_earnings (the platform-fee base) ──────────────────────────────────

describe("party_job_earnings — sum of legs TO a party on a job", () => {
  async function earnings(party: string, callerParty: string | null, isSuperadmin: boolean) {
    return withRlsTransaction(appPool, { orgId: orgA, partyId: callerParty, isSuperadmin }, async (tx) => {
      const res = await tx.execute(sql`select party_job_earnings(${party}, ${workItemA}) as base`);
      return Number((res.rows[0] as { base: string }).base);
    });
  }

  it("Writer's earnings on the job = 3000 (the leg TO the writer)", async () => {
    assert.equal(await earnings(writer, null, true), 3000);
  });

  it("Momin's earnings on the job = 6000 (the leg TO Momin)", async () => {
    assert.equal(await earnings(momin, null, true), 6000);
  });
});

// ─── settlement_transfer RLS + append-only ───────────────────────────────────────

describe("settlement_transfer RLS — visible only to the two parties", () => {
  async function transferIdsVisibleTo(partyId: string | null, isSuperadmin: boolean, orgId = orgA) {
    return withRlsTransaction(appPool, { orgId, partyId, isSuperadmin }, async (tx) => {
      const res = await tx.execute(sql`select id from settlement_transfer where id = ${transferMominEmon}`);
      return (res.rows as Array<{ id: string }>).map((r) => r.id);
    });
  }

  it("Momin (the `from`) sees the transfer", async () => {
    assert.deepEqual(await transferIdsVisibleTo(momin, false), [transferMominEmon]);
  });
  it("Emon (the `to`) sees the transfer", async () => {
    assert.deepEqual(await transferIdsVisibleTo(emon, false), [transferMominEmon]);
  });
  it("🔴 the Writer (not a party to it) sees ZERO rows", async () => {
    assert.deepEqual(await transferIdsVisibleTo(writer, false), [], "a non-party transfer must be invisible");
  });
  it("a different-org context sees ZERO rows (tenant isolation)", async () => {
    assert.deepEqual(await transferIdsVisibleTo(partyB, false, orgB), []);
  });
});

describe("settlement_transfer append-only (no UPDATE/DELETE grants for the app role)", () => {
  it("ALLOWS INSERT (dated transfers are appended)", async () => {
    const id = randomUUID();
    await withRlsTransaction(appPool, { orgId: orgA, partyId: momin, isSuperadmin: false }, async (tx) => {
      await tx.execute(sql`
        insert into settlement_transfer (id, org_id, from_party_id, to_party_id, amount, transferred_at)
        values (${id}, ${orgA}, ${momin}, ${emon}, 50, current_date)
      `);
    });
    await admin.query("delete from settlement_transfer where id=$1", [id]);
  });
  it("rejects UPDATE", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: momin, isSuperadmin: false }, async (tx) => {
        await tx.execute(sql`update settlement_transfer set amount = 1 where id = ${transferMominEmon}`);
      }),
      /permission denied/i,
    );
  });
  it("rejects DELETE", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: momin, isSuperadmin: false }, async (tx) => {
        await tx.execute(sql`delete from settlement_transfer where id = ${transferMominEmon}`);
      }),
      /permission denied/i,
    );
  });
});

// ─── deriveSettlement (pure) — anchored to §3.1's worked examples ────────────────

describe("deriveSettlement (pure math) — §3.1 worked examples", () => {
  const A = momin;
  const B = emon;
  const splitTerm = {
    id: "t1",
    fromPartyId: A,
    toPartyId: B,
    appliesTo: "default",
    termType: "split_pct",
    value: "50",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
  };
  const poolRow = {
    workItemId: workItemA,
    jobDate: "2026-06-01",
    upstreamParty: A,
    downstreamParty: B,
    pool: 2000,
  };

  it("split example: Emon owes Momin 1000 (50% × pool 2000)", async () => {
    const r = deriveSettlement([poolRow], [splitTerm], [], { partyA: A, partyB: B });
    assert.equal(r.jobCount, 1);
    assert.equal(r.totalPool, 2000);
    assert.equal(r.net.owedBy, B, "the downstream Emon owes");
    assert.equal(r.net.owedTo, A, "the upstream Momin is owed");
    assert.equal(r.net.amount, 1000);
  });

  it("commission example: Momin owes Emon 400 (20% × pool 2000, downstream=Momin)", async () => {
    // Chain Client→Emon→Momin→Writer: handoff Emon→Momin, downstream=Momin.
    const commTerm = { ...splitTerm, fromPartyId: B, toPartyId: A, termType: "commission_pct", value: "20" };
    const commRow = { ...poolRow, upstreamParty: B, downstreamParty: A };
    const r = deriveSettlement([commRow], [commTerm], [], { partyA: A, partyB: B });
    assert.equal(r.net.owedBy, A, "downstream Momin owes");
    assert.equal(r.net.owedTo, B, "upstream Emon is owed");
    assert.equal(r.net.amount, 400, "20% × 2000");
  });

  it("a transfer Emon→Momin 1000 nets the split case to settled (aMinusB 0, owedBy null)", async () => {
    const transfers = [{ fromPartyId: B, toPartyId: A, amount: 1000 }];
    const r = deriveSettlement([poolRow], [splitTerm], transfers, { partyA: A, partyB: B });
    assert.equal(r.net.amount, 0);
    assert.equal(r.net.aMinusB, 0);
    assert.equal(r.net.owedBy, null, "fully settled — nobody owes");
    assert.equal(r.net.owedTo, null);
  });

  it("empty pools → fully zeroed result", async () => {
    const r = deriveSettlement([], [splitTerm], [], { partyA: A, partyB: B });
    assert.equal(r.jobCount, 0);
    assert.equal(r.totalPool, 0);
    assert.equal(r.net.amount, 0);
    assert.equal(r.net.owedBy, null);
    assert.deepEqual(r.accrual, { partyA: 0, partyB: 0 });
  });
});
