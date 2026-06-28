import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { deriveSettlement } from "@business-os/shared";
import { createPool, sql, withRlsTransaction } from "../src/client.js";
import { env } from "../src/env.js";

/**
 * Change 5 — settlement shared-cost (settlement_legs(), migration 0025).
 * DATABASE-level proof (mirrors settlement.test.ts). A from_party_id IS NULL leg
 * (the business bears it; e.g. a referral payout) is now SUBTRACTED from each
 * job's pool BEFORE the partner split (§4.4). So the partner who-owes-whom figure
 * (split × pool) drops by referral × split. Profit/pool stay DERIVED — never stored.
 *
 * Fixtures via the admin connection (bypasses RLS); pool read via the app role
 * (caller-guard ENFORCED). Anchored to §3.1: Client→Momin→Emon→Writer
 * 6000/5000/3000 → pool=2000; with a 400 referral → pool=1600.
 */

const admin = new pg.Client({ connectionString: env.adminUrl });
const appPool = createPool(env.appUrl);

const orgA = randomUUID();
const client = randomUUID();
const momin = randomUUID();
const emon = randomUUID();
const writer = randomUUID();
const referrer = randomUUID();

// Job 1: a SHARED Momin↔Emon job that will gain a referral leg.
const jobReferral = randomUUID();
// Job 2: an identical shared job with NO referral (the control).
const jobControl = randomUUID();

const REFERRAL = 400;
const SPLIT_PCT = 50;

async function poolAndAccrualAs(
  callerParty: string | null,
  isSuperadmin: boolean,
): Promise<{ rows: Array<{ work_item_id: string; pool: number }>; totalPool: number; net: { owedBy: string | null; owedTo: string | null; amount: number } }> {
  return withRlsTransaction(appPool, { orgId: orgA, partyId: callerParty, isSuperadmin }, async (tx) => {
    const res = await tx.execute(
      sql`select work_item_id, job_date, upstream_party, downstream_party, pool from settlement_legs(${momin}, ${emon})`,
    );
    const raw = res.rows as Array<{ work_item_id: string; job_date: string; upstream_party: string; downstream_party: string; pool: string }>;
    const poolRows = raw.map((r) => ({
      workItemId: r.work_item_id,
      jobDate: r.job_date,
      upstreamParty: r.upstream_party,
      downstreamParty: r.downstream_party,
      pool: Number(r.pool),
    }));
    const splitTerm = {
      id: "t1",
      fromPartyId: momin,
      toPartyId: emon,
      appliesTo: "default",
      termType: "split_pct",
      value: String(SPLIT_PCT),
      effectiveFrom: "2020-01-01",
      effectiveTo: null,
    };
    const settled = deriveSettlement(poolRows, [splitTerm], [], { partyA: momin, partyB: emon });
    return {
      rows: poolRows.map((r) => ({ work_item_id: r.workItemId, pool: r.pool })),
      totalPool: settled.totalPool,
      net: { owedBy: settled.net.owedBy, owedTo: settled.net.owedTo, amount: settled.net.amount },
    };
  });
}

before(async () => {
  await admin.connect();
  await admin.query("insert into org (id, name) values ($1,'SHARED-COST Org')", [orgA]);
  await admin.query(
    `insert into party (id, org_id, display_name, party_type) values
       ($1,$6,'Client','{client}'),($2,$6,'Momin','{partner}'),
       ($3,$6,'Emon','{partner}'),($4,$6,'Writer','{writer}'),($5,$6,'Referrer','{referrer}')`,
    [client, momin, emon, writer, referrer, orgA],
  );

  // Two identical shared jobs (handoff Momin→Emon 5000, writer cost 3000 → pool 2000).
  for (const job of [jobReferral, jobControl]) {
    await admin.query("insert into work_item (id, org_id, title) values ($1,$2,'SHARED-COST job')", [job, orgA]);
    await admin.query(
      `insert into leg (id, org_id, work_item_id, seq, from_party_id, to_party_id, amount) values
         ($1,$5,$6,1,$2,$3,6000),
         (gen_random_uuid(),$5,$6,2,$3,$4,5000),
         (gen_random_uuid(),$5,$6,3,$4,$7,3000)`,
      [randomUUID(), client, momin, emon, orgA, job, writer],
    );
  }
});

after(async () => {
  await admin.query("delete from leg where org_id=$1", [orgA]);
  await admin.query("delete from work_item where org_id=$1", [orgA]);
  await admin.query("delete from party where org_id=$1", [orgA]);
  await admin.query("delete from org where id=$1", [orgA]);
  await admin.end();
  await appPool.end();
});

// ─── Baseline (no referral on either job) ────────────────────────────────────

describe("settlement shared-cost — baseline pool/accrual before any referral", () => {
  it("both shared jobs have pool=2000; Emon owes Momin split_pct × total pool", async () => {
    const r = await poolAndAccrualAs(momin, false);
    assert.equal(r.rows.length, 2, "two shared Momin↔Emon jobs");
    for (const row of r.rows) assert.equal(row.pool, 2000, `each job's pool = 5000 − 3000 (job ${row.work_item_id})`);
    assert.equal(r.totalPool, 4000, "total pool = 2 × 2000");
    // 50% split, Momin upstream: Emon (downstream) owes Momin 50% × 4000 = 2000.
    assert.equal(r.net.owedBy, emon, "Emon (downstream) owes");
    assert.equal(r.net.owedTo, momin, "Momin (upstream) is owed");
    assert.equal(r.net.amount, 2000, "owed = 50% × 4000");
  });
});

// ─── Add a referral leg (from=null → the referrer) on job 1 ──────────────────

describe("🔴 a from=null referral leg reduces THAT job's pool by the referral, and the owed figure by referral × split", () => {
  let baseline: Awaited<ReturnType<typeof poolAndAccrualAs>>;

  before(async () => {
    baseline = await poolAndAccrualAs(momin, false);
    // The business bears a 400 referral payout on jobReferral (from_party_id NULL).
    await admin.query(
      "insert into leg (id, org_id, work_item_id, seq, from_party_id, to_party_id, amount) values ($1,$2,$3,4,NULL,$4,$5)",
      [randomUUID(), orgA, jobReferral, referrer, REFERRAL],
    );
  });

  it("the referral job's pool drops by the referral amount (2000 → 1600); the control job is unchanged", async () => {
    const r = await poolAndAccrualAs(momin, false);
    const refRow = r.rows.find((x) => x.work_item_id === jobReferral);
    const ctlRow = r.rows.find((x) => x.work_item_id === jobControl);
    assert.ok(refRow && ctlRow, "both jobs still appear in the shared settlement");
    assert.equal(refRow!.pool, 2000 - REFERRAL, "referral job pool = 2000 − 400 = 1600 (shared cost subtracted before split)");
    assert.equal(ctlRow!.pool, 2000, "the no-referral control job pool is unchanged");
  });

  it("the total pool and the partner owed figure drop by the referral × split", async () => {
    const r = await poolAndAccrualAs(momin, false);
    assert.equal(r.totalPool, baseline.totalPool - REFERRAL, "total pool drops by the full referral (4000 → 3600)");
    const owedDrop = (REFERRAL * SPLIT_PCT) / 100; // 400 × 50% = 200
    assert.equal(r.net.amount, baseline.net.amount - owedDrop, "the owed figure drops by referral × split (2000 → 1800)");
    assert.equal(r.net.owedBy, emon, "Emon still owes Momin (direction unchanged)");
    assert.equal(r.net.owedTo, momin);
  });

  it("Emon sees the SAME reduced shared figures (symmetric) and the 6000 client price never leaks", async () => {
    const asMomin = await poolAndAccrualAs(momin, false);
    const asEmon = await poolAndAccrualAs(emon, false);
    assert.equal(asEmon.totalPool, asMomin.totalPool, "both partners see the identical reduced pool");
    assert.equal(asEmon.net.amount, asMomin.net.amount, "both partners see the identical owed figure");
    // Partner opacity: no shared figure reveals the 6000 upstream client price.
    for (const row of asEmon.rows) {
      assert.notEqual(row.pool, 6000, "no pool field reveals the client price");
    }
  });

  it("🔴 a non-partner (the writer) still gets ZERO rows (caller-guard holds with shared cost)", async () => {
    const r = await poolAndAccrualAs(writer, false);
    assert.equal(r.rows.length, 0, "a non-partner sees no shared settlement, even with a referral present");
    assert.equal(r.totalPool, 0);
  });
});
