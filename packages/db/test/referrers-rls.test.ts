import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { createPool, sql, withRlsTransaction } from "../src/client.js";
import { env } from "../src/env.js";

/**
 * Module 11 (referrers) — DATABASE-level proofs (DESIGN_SPEC §4/§8). A referral
 * is "another claimant leg, scoped like any other": an admin attaches a leg from
 * the business (from_party_id = NULL) TO a referrer party, and the EXISTING
 * leg_visibility RLS (0001) scopes it so the referrer sees ONLY their own slice
 * — never the client price or anyone else's referral.
 *
 * Fixtures are built via the admin/superuser connection (bypasses RLS + grants);
 * assertions run via the app role (RLS + the referrer_works caller-guard
 * ENFORCED). Mirrors rls.test.ts / settlement.test.ts conventions exactly.
 *
 * The chain under test (DESIGN_SPEC §3.1): Client→Momin→Emon→Writer 6000/5000/3000,
 * PLUS a referral side-leg business→R1 of 600 (seq 90) carrying a referral_pct
 * deal_term. A second referrer R2 has NO leg.
 */

const admin = new pg.Client({ connectionString: env.adminUrl });
const appPool = createPool(env.appUrl);

const orgA = randomUUID();
const orgB = randomUUID();
const client = randomUUID();
const momin = randomUUID();
const emon = randomUUID();
const writer = randomUUID();
const r1 = randomUUID(); // the referrer with a leg
const r2 = randomUUID(); // a DIFFERENT referrer — no leg on this job
const workItemA = randomUUID();
const legClientMomin = randomUUID(); // seq 1 — the 6000 true client price
const legMominEmon = randomUUID(); // seq 2
const legEmonWriter = randomUUID(); // seq 3
const referralTermId = randomUUID(); // referral_pct deal_term marking the referral leg
const referralLeg = randomUUID(); // seq 90 — business(null)→R1, 600
// org B (tenant isolation)
const r1B = randomUUID();
const workItemB = randomUUID();
const referralLegB = randomUUID();

before(async () => {
  await admin.connect();
  await admin.query("insert into org (id, name) values ($1,'REF Org A'),($2,'REF Org B')", [orgA, orgB]);
  await admin.query(
    `insert into party (id, org_id, display_name, party_type) values
       ($1,$6,'Client','{client}'),($2,$6,'Momin','{partner}'),
       ($3,$6,'Emon','{partner}'),($4,$6,'Writer','{writer}'),
       ($5,$6,'R1','{referrer}'),($7,$6,'R2','{referrer}')`,
    [client, momin, emon, writer, r1, orgA, r2],
  );
  await admin.query("insert into work_item (id, org_id, title, source_party_id) values ($1,$2,'REF job',$3)", [
    workItemA,
    orgA,
    client,
  ]);
  // The standard 3-leg client→writer chain.
  await admin.query(
    `insert into leg (id, org_id, work_item_id, seq, from_party_id, to_party_id, amount) values
       ($1,$7,$8,1,$4,$5,6000),
       ($2,$7,$8,2,$5,$6,5000),
       ($3,$7,$8,3,$6,$9,3000)`,
    [legClientMomin, legMominEmon, legEmonWriter, client, momin, emon, orgA, workItemA, writer],
  );
  // The referral agreement (a referral_pct deal_term, keyed on the referrer R1).
  await admin.query(
    `insert into deal_term (id, org_id, from_party_id, to_party_id, applies_to, term_type, basis, value, effective_from)
     values ($1,$2,$3,null,'default','referral_pct','revenue','10','2020-01-01')`,
    [referralTermId, orgA, r1],
  );
  // The referral side-leg: business (from=null) → R1, 600 (= 10% of 6000), referral_pct term.
  await admin.query(
    `insert into leg (id, org_id, work_item_id, seq, from_party_id, to_party_id, amount, deal_term_id, note)
     values ($1,$2,$3,90,null,$4,600,$5,'referral')`,
    [referralLeg, orgA, workItemA, r1, referralTermId],
  );

  // org B: its own referrer + referral leg (for tenant isolation).
  await admin.query("insert into party (id, org_id, display_name, party_type) values ($1,$2,'R1B','{referrer}')", [
    r1B,
    orgB,
  ]);
  await admin.query("insert into work_item (id, org_id, title) values ($1,$2,'OrgB ref job')", [workItemB, orgB]);
  await admin.query(
    "insert into leg (id, org_id, work_item_id, seq, from_party_id, to_party_id, amount) values ($1,$2,$3,90,null,$4,999)",
    [referralLegB, orgB, workItemB, r1B],
  );
});

after(async () => {
  for (const org of [orgA, orgB]) {
    await admin.query("delete from leg where org_id=$1", [org]);
    await admin.query("delete from deal_term where org_id=$1", [org]);
    await admin.query("delete from work_item where org_id=$1", [org]);
    await admin.query("delete from party where org_id=$1", [org]);
    await admin.query("delete from org where id=$1", [org]);
  }
  await admin.end();
  await appPool.end();
});

/** The legs (by seq) on workItemA visible under a given RLS context. */
async function legSeqsVisibleTo(partyId: string | null, isSuperadmin: boolean) {
  return withRlsTransaction(appPool, { orgId: orgA, partyId, isSuperadmin }, async (tx) => {
    const res = await tx.execute(
      sql`select seq from leg where work_item_id = ${workItemA} order by seq`,
    );
    return (res.rows as Array<{ seq: number }>).map((r) => Number(r.seq));
  });
}

// ─── 🔴 The referral leg is scoped like any other leg ────────────────────────────

describe("🔴 referral-leg visibility — the referrer sees ONLY their own slice", () => {
  it("R1 (the `to` party) sees the referral leg (seq 90) and NOT the client chain", async () => {
    const seqs = await legSeqsVisibleTo(r1, false);
    assert.deepEqual(seqs, [90], "R1 is party only to the referral leg — never the client→writer legs");
    assert.ok(!seqs.includes(1), "the 6000 client price (seq 1) must be invisible to R1");
  });

  it("🔴 R1 cannot read the upstream client-price leg (seq 1) — ZERO rows, not an error", async () => {
    const rows = await withRlsTransaction(appPool, { orgId: orgA, partyId: r1, isSuperadmin: false }, async (tx) => {
      const res = await tx.execute(sql`select seq, amount from leg where id = ${legClientMomin}`);
      return res.rows as Array<{ seq: number; amount: string }>;
    });
    assert.deepEqual(rows, [], "the true client price must be invisible to the referrer");
  });

  it("🔴 a DIFFERENT referrer (R2) sees ZERO legs on the job (no referral leak across referrers)", async () => {
    const seqs = await legSeqsVisibleTo(r2, false);
    assert.deepEqual(seqs, [], "R2 has no leg on this job — must see nothing, not R1's referral");
  });

  it("the writer sees only the terminal leg (seq 3) — never the referral leg", async () => {
    const seqs = await legSeqsVisibleTo(writer, false);
    assert.deepEqual(seqs, [3], "the writer is not party to the business→R1 referral leg");
  });

  it("the client sees only its own leg (seq 1) — never the referral leg", async () => {
    const seqs = await legSeqsVisibleTo(client, false);
    assert.deepEqual(seqs, [1], "the client is not party to the referral leg");
  });

  it("a SuperAdmin sees the whole chain INCLUDING the referral leg (seq 90)", async () => {
    const seqs = await legSeqsVisibleTo(null, true);
    assert.deepEqual(seqs, [1, 2, 3, 90], "SuperAdmin sees every leg");
  });

  it("the referral leg's amount (600) never surfaces to R2/writer/client (no row carries it)", async () => {
    for (const party of [r2, writer, client]) {
      const amounts = await withRlsTransaction(appPool, { orgId: orgA, partyId: party, isSuperadmin: false }, async (tx) => {
        const res = await tx.execute(sql`select amount from leg where work_item_id = ${workItemA}`);
        return (res.rows as Array<{ amount: string }>).map((x) => Number(x.amount));
      });
      assert.ok(!amounts.includes(600), `the 600 referral amount must not surface to party ${party}`);
    }
  });
});

// ─── tenant isolation ────────────────────────────────────────────────────────

describe("referral-leg tenant isolation", () => {
  it("org A context cannot see org B's referral leg (even as SuperAdmin)", async () => {
    const n = await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
      const res = await tx.execute(sql`select count(*)::int as n from leg where id = ${referralLegB}`);
      return (res.rows[0] as { n: number }).n;
    });
    assert.equal(n, 0, "org B's referral leg must be invisible under org A context");
  });
});

// ─── referrer_works() — self-view, caller-guarded ────────────────────────────────

describe("referrer_works(R) — self-view only, caller-guarded", () => {
  async function worksAs(p_referrer: string, callerParty: string | null, isSuperadmin: boolean) {
    return withRlsTransaction(appPool, { orgId: orgA, partyId: callerParty, isSuperadmin }, async (tx) => {
      const res = await tx.execute(
        sql`select work_item_id as "workItemId", referral_amount as "amount" from referrer_works(${p_referrer})`,
      );
      return res.rows as Array<{ workItemId: string; amount: string }>;
    });
  }

  it("R1 calling referrer_works(R1) sees their own work + referral amount (600)", async () => {
    const rows = await worksAs(r1, r1, false);
    assert.equal(rows.length, 1, "R1 has exactly one referred work");
    assert.equal(rows[0].workItemId, workItemA);
    assert.equal(Number(rows[0].amount), 600, "the referrer's OWN referral amount");
  });

  it("🔴 R2 calling referrer_works(R1) gets ZERO rows (cannot read another party's works)", async () => {
    const rows = await worksAs(r1, r2, false);
    assert.deepEqual(rows, [], "the caller-guard blocks reading another referrer's works");
  });

  it("R2 calling referrer_works(R2) sees nothing (R2 has no referrals)", async () => {
    const rows = await worksAs(r2, r2, false);
    assert.deepEqual(rows, [], "R2 earned no referrals");
  });

  it("the writer calling referrer_works(R1) gets ZERO rows (not the referrer)", async () => {
    const rows = await worksAs(r1, writer, false);
    assert.deepEqual(rows, [], "a non-referrer cannot read a referrer's works");
  });

  it("System SuperAdmin may read referrer_works(R1) (entitled to all)", async () => {
    const rows = await worksAs(r1, null, true);
    assert.equal(rows.length, 1, "SuperAdmin sees R1's referred work");
    assert.equal(Number(rows[0].amount), 600);
  });
});

// ─── append-only: legs are SELECT/INSERT only for the app role ───────────────────

describe("referral leg append-only (no UPDATE/DELETE grants for the app role)", () => {
  it("rejects UPDATE on the referral leg", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
        await tx.execute(sql`update leg set amount = 1 where id = ${referralLeg}`);
      }),
      /permission denied/i,
      "a referral leg is corrected with a reversing entry, never edited",
    );
  });

  it("rejects DELETE on the referral leg", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
        await tx.execute(sql`delete from leg where id = ${referralLeg}`);
      }),
      /permission denied/i,
      "a referral leg is never deleted",
    );
  });
});
