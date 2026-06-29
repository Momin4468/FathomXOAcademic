import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { deriveProfitShares, type DealTermLike } from "@business-os/shared";
import { createPool, sql, withRlsTransaction } from "../src/client.js";
import { env } from "../src/env.js";

/**
 * Module 17 — Channels + N-way profit-share, DATABASE-level proofs (§3, §4.4).
 * Admin/superuser builds fixtures (bypasses RLS); assertions run via the app role
 * (RLS + SECURITY DEFINER caller-guards ENFORCED). Mirrors settlement.test.ts.
 *
 * Job chain (sourced from the Web channel): Web(source)→Momin→Writer, legs
 * 6000 (revenue from source) / 3000 (writer cost) → pool = 6000 − 3000 = 3000.
 * Terms: Investor (non-partner) default pct_of_net 10% (= 300, AGGREGATE-only);
 * OwnerA source:Web pct_after_writer 40% (= 1200, per-job channel share).
 */

const admin = new pg.Client({ connectionString: env.adminUrl });
const appPool = createPool(env.appUrl);

const orgA = randomUUID();
const orgB = randomUUID();
const webParty = randomUUID(); // the channel-as-party (the job source)
const channelId = randomUUID();
const momin = randomUUID(); // controller / on-chain
const writer = randomUUID();
const ownerA = randomUUID(); // a channel-scoped sharer (partner)
const investor = randomUUID(); // a non-partner silent investor (default net dividend)
const jobMar = randomUUID(); // created 2026-03-15
const jobMay = randomUUID(); // created 2026-05-01
const channelB = randomUUID(); // org B channel (tenant isolation)
const partyB = randomUUID();

const REVENUE = 6000;
const WRITER_COST = 3000;
const POOL = REVENUE - WRITER_COST; // 3000

before(async () => {
  await admin.connect();
  await admin.query("insert into org (id, name) values ($1,'PS Org A'),($2,'PS Org B')", [orgA, orgB]);
  await admin.query(
    `insert into party (id, org_id, display_name, party_type) values
       ($1,$6,'Web','{channel}'),($2,$6,'Momin','{partner,writer}'),
       ($3,$6,'Writer','{writer}'),($4,$6,'OwnerA','{partner}'),($5,$6,'Investor','{}')`,
    [webParty, momin, writer, ownerA, investor, orgA],
  );
  await admin.query("insert into party (id, org_id, display_name, party_type) values ($1,$2,'PartyB','{partner}')", [partyB, orgB]);

  // Business-controlled (controller null): OwnerA's source:Web share is the
  // allowed "partner benefit on a business channel" scheme (§4.4-safe).
  await admin.query(
    "insert into channel (id, org_id, party_id, medium) values ($1,$2,$3,'web')",
    [channelId, orgA, webParty],
  );
  await admin.query(
    "insert into channel (id, org_id, party_id, medium) values ($1,$2,$3,'facebook')",
    [channelB, orgB, partyB],
  );

  // Two jobs sourced from Web, each Web→Momin (6000) → Momin→Writer (3000).
  for (const [jobId, when] of [
    [jobMar, "2026-03-15"],
    [jobMay, "2026-05-01"],
  ] as const) {
    await admin.query(
      "insert into work_item (id, org_id, title, source_party_id, doer_party_id, created_at) values ($1,$2,'PS job',$3,$4,$5)",
      [jobId, orgA, webParty, writer, `${when}T00:00:00Z`],
    );
    await admin.query(
      `insert into leg (id, org_id, work_item_id, seq, from_party_id, to_party_id, amount) values
         ($1,$5,$6,1,$3,$4,${REVENUE}), ($2,$5,$6,2,$4,$7,${WRITER_COST})`,
      [randomUUID(), randomUUID(), webParty, momin, orgA, jobId, writer],
    );
  }

  // profit_share terms (from=null=business; to=beneficiary).
  // Investor: default net dividend 10%.
  await admin.query(
    `insert into deal_term (id, org_id, from_party_id, to_party_id, applies_to, term_type, basis, value, effective_from)
       values ($1,$2,null,$3,'default','profit_share','pct_of_net',10,'2026-01-01')`,
    [randomUUID(), orgA, investor],
  );
  // OwnerA: channel-scoped after-writer — v1 40% [Jan,Apr), v2 10% [Apr,∞) (effective-dating).
  await admin.query(
    `insert into deal_term (id, org_id, from_party_id, to_party_id, applies_to, term_type, basis, value, effective_from, effective_to)
       values ($1,$3,null,$4,$2,'profit_share','pct_after_writer',40,'2026-01-01','2026-04-01')`,
    [randomUUID(), `source:${webParty}`, orgA, ownerA],
  );
  await admin.query(
    `insert into deal_term (id, org_id, from_party_id, to_party_id, applies_to, term_type, basis, value, effective_from)
       values ($1,$3,null,$4,$2,'profit_share','pct_after_writer',10,'2026-04-01')`,
    [randomUUID(), `source:${webParty}`, orgA, ownerA],
  );
});

after(async () => {
  for (const org of [orgA, orgB]) {
    await admin.query("delete from charge where org_id=$1", [org]);
    await admin.query("delete from deal_term where org_id=$1", [org]);
    await admin.query("delete from channel where org_id=$1", [org]);
    await admin.query("delete from leg where org_id=$1", [org]);
    await admin.query("delete from work_item where org_id=$1", [org]);
    await admin.query("delete from party where org_id=$1", [org]);
    await admin.query("delete from org where id=$1", [org]);
  }
  await admin.end();
  await appPool.end();
});

// ─── profit_share_pool + deriveProfitShares — N-way division ──────────────────

describe("N-way division (profit_share_pool definer → deriveProfitShares)", () => {
  it("pool bases = revenue 6000 / writer cost 3000 / source Web", async () => {
    const row = await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
      const r = await tx.execute(
        sql`select revenue, writer_cost as "writerCost", source_party_id as "sourcePartyId" from profit_share_pool(${jobMar})`,
      );
      return r.rows[0] as { revenue: string; writerCost: string; sourcePartyId: string };
    });
    assert.equal(Number(row.revenue), REVENUE);
    assert.equal(Number(row.writerCost), WRITER_COST);
    assert.equal(row.sourcePartyId, webParty);
  });

  it("splits the 3000 pool: OwnerA channel 40%=1200, Investor net 10%=300, residual 1500", async () => {
    const terms = (await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
      const r = await tx.execute(sql`select * from deal_term where org_id=${orgA} and term_type='profit_share'`);
      return r.rows;
    })) as unknown as Array<Record<string, unknown>>;
    const sharers = [
      { toPartyId: ownerA, terms: terms.filter((t) => t.to_party_id === ownerA).map(toDealTermLike) },
      { toPartyId: investor, terms: terms.filter((t) => t.to_party_id === investor).map(toDealTermLike) },
    ];
    const r = deriveProfitShares(
      { workItemId: jobMar, jobDate: "2026-03-15", revenue: REVENUE, writerCost: WRITER_COST, sourcePartyId: webParty },
      sharers,
    );
    assert.equal(r.pool, POOL);
    const byParty = Object.fromEntries(r.cuts.map((c) => [c.toPartyId, c.amount]));
    assert.equal(byParty[ownerA], 1200, "OwnerA: 40% of 3000 (channel-scoped, v1 effective in March)");
    assert.equal(byParty[investor], 300, "Investor: 10% of 3000 net dividend");
    assert.equal(r.residual, 1500, "3000 − 1200 − 300 = 1500 to the business/controller");
    assert.equal(r.overAllocated, false);
  });
});

// ─── 🔴 my_profit_share opacity (the mandatory §4.4 test) ─────────────────────

describe("🔴 my_profit_share — a sharer sees ONLY their own cut", () => {
  async function mineAs(party: string, callerParty: string | null, isSuperadmin: boolean) {
    return withRlsTransaction(appPool, { orgId: orgA, partyId: callerParty, isSuperadmin }, async (tx) => {
      const r = await tx.execute(
        sql`select work_item_id as "workItemId", amount, scope from my_profit_share(${party}) order by amount desc`,
      );
      return r.rows as Array<{ workItemId: string; amount: string; scope: string }>;
    });
  }

  it("OwnerA sees their OWN channel cut (1200 in March) with scope='source', and NO column equals the 6000 revenue", async () => {
    const rows = await mineAs(ownerA, ownerA, false);
    const mar = rows.find((r) => r.workItemId === jobMar)!;
    assert.equal(Number(mar.amount), 1200);
    assert.equal(mar.scope, "source");
    for (const row of rows) {
      for (const [k, v] of Object.entries(row)) {
        assert.notEqual(Number(v), REVENUE, `column ${k} must never reveal the 6000 client revenue`);
      }
    }
  });

  it("🔴 OwnerA calling my_profit_share(Investor) gets ZERO rows (caller-guarded to self)", async () => {
    const rows = await mineAs(investor, ownerA, false);
    assert.deepEqual(rows, [], "a sharer cannot read another sharer's cut");
  });

  it("🔴 a non-sharer (the Writer) calling my_profit_share(OwnerA) gets ZERO rows", async () => {
    const rows = await mineAs(ownerA, writer, false);
    assert.deepEqual(rows, []);
  });

  it("Investor's default net dividend carries scope='default' (the API exposes it aggregate-only)", async () => {
    const rows = await mineAs(investor, investor, false);
    assert.ok(rows.length >= 1);
    assert.ok(rows.every((r) => r.scope === "default"), "a default net dividend must be flagged so the API never lists it per-job");
    assert.ok(rows.every((r) => Number(r.amount) === 300));
  });
});

// ─── EFFECTIVE-DATING — a scheme change does not rewrite a past job ───────────

describe("my_profit_share — past job settles on past terms (channel share)", () => {
  it("OwnerA: March job → 1200 (v1 40%), May job → 300 (v2 10%); adding v2 did not change March", async () => {
    const rows = await withRlsTransaction(appPool, { orgId: orgA, partyId: ownerA, isSuperadmin: false }, async (tx) => {
      const r = await tx.execute(
        sql`select work_item_id as "workItemId", amount from my_profit_share(${ownerA})`,
      );
      return r.rows as Array<{ workItemId: string; amount: string }>;
    });
    const byJob = Object.fromEntries(rows.map((r) => [r.workItemId, Number(r.amount)]));
    assert.equal(byJob[jobMar], 1200, "March settles on the 40% (v1) term");
    assert.equal(byJob[jobMay], 300, "May settles on the superseding 10% (v2) term");
  });
});

// ─── channel RLS / tenant isolation ───────────────────────────────────────────

describe("channel — tenant isolation", () => {
  it("org A sees its channel; org B's channel is invisible to org A", async () => {
    const ids = await withRlsTransaction(appPool, { orgId: orgA, partyId: momin, isSuperadmin: false }, async (tx) => {
      const r = await tx.execute(sql`select id from channel`);
      return (r.rows as Array<{ id: string }>).map((x) => x.id);
    });
    assert.ok(ids.includes(channelId), "own-org channel visible");
    assert.ok(!ids.includes(channelB), "other-org channel must be invisible");
  });
});

// ─── charge_exists + writer_commission idempotency backstop ───────────────────

describe("charge_exists + writer_commission once-per-(party,job) unique index", () => {
  const chargeId = randomUUID();
  it("a live writer_commission charge → charge_exists true; a different category → false", async () => {
    await admin.query(
      `insert into charge (id, org_id, party_id, work_item_id, category, amount)
         values ($1,$2,$3,$4,'writer_commission',150)`,
      [chargeId, orgA, writer, jobMar],
    );
    const [wc, pf] = await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
      const a = await tx.execute(sql`select charge_exists(${writer}, ${jobMar}, 'writer_commission') as e`);
      const b = await tx.execute(sql`select charge_exists(${writer}, ${jobMar}, 'platform_fee') as e`);
      return [(a.rows[0] as { e: boolean }).e, (b.rows[0] as { e: boolean }).e];
    });
    assert.equal(wc, true, "the writer_commission charge exists");
    assert.equal(pf, false, "no platform_fee charge for this party+job");
  });

  it("a second live writer_commission on the same (party, job) is rejected by the unique index", async () => {
    await assert.rejects(
      admin.query(
        `insert into charge (id, org_id, party_id, work_item_id, category, amount)
           values ($1,$2,$3,$4,'writer_commission',999)`,
        [randomUUID(), orgA, writer, jobMar],
      ),
      /charge_writer_commission_once|duplicate key/i,
    );
  });
});

function toDealTermLike(r: Record<string, unknown>): DealTermLike {
  return {
    id: r.id as string,
    fromPartyId: (r.from_party_id as string) ?? null,
    toPartyId: (r.to_party_id as string) ?? null,
    appliesTo: r.applies_to as string,
    termType: r.term_type as string,
    basis: (r.basis as string) ?? null,
    value: String(r.value),
    effectiveFrom: typeof r.effective_from === "string" ? r.effective_from : (r.effective_from as Date).toISOString().slice(0, 10),
    effectiveTo: r.effective_to == null ? null : typeof r.effective_to === "string" ? r.effective_to : (r.effective_to as Date).toISOString().slice(0, 10),
    createdAt: (r.created_at as Date) ?? null,
  };
}
