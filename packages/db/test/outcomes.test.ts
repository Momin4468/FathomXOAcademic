import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { deriveReputation, type OutcomeLike } from "@business-os/shared";
import { createPool, sql, withRlsTransaction } from "../src/client.js";
import { env } from "../src/env.js";

/**
 * Module 7 (outcomes) DB-layer invariants (CLAUDE.md §3/§4):
 *   • tenant isolation — an org A work_outcome is invisible under org B context
 *   • unique(work_item_id) — one outcome per finished work item
 *   • grants — app role may INSERT/UPDATE but NEVER DELETE a work_outcome
 *   • deriveReputation — the DERIVED read-model is pure & correct (no stored score)
 * Fixtures via the admin/superuser connection (bypasses RLS); assertions run via
 * the app role (RLS enforced), mirroring rls.test.ts.
 */

const admin = new pg.Client({ connectionString: env.adminUrl });
const appPool = createPool(env.appUrl);

const orgA = randomUUID();
const orgB = randomUUID();
const writerA = randomUUID();
const writerB = randomUUID();
const workItemA = randomUUID();
const workItemB = randomUUID();
const outcomeA = randomUUID();

before(async () => {
  await admin.connect();
  await admin.query("insert into org (id, name) values ($1,'Outcome Org A'),($2,'Outcome Org B')", [orgA, orgB]);
  await admin.query(
    "insert into party (id, org_id, display_name, party_type) values ($1,$2,'WriterA','{writer}'),($3,$4,'WriterB','{writer}')",
    [writerA, orgA, writerB, orgB],
  );
  await admin.query(
    "insert into work_item (id, org_id, title, doer_party_id) values ($1,$2,'Org A job',$3)",
    [workItemA, orgA, writerA],
  );
  await admin.query(
    "insert into work_item (id, org_id, title, doer_party_id) values ($1,$2,'Org B job',$3)",
    [workItemB, orgB, writerB],
  );
  // One recorded outcome in org A.
  await admin.query(
    `insert into work_outcome (id, org_id, work_item_id, on_time, grade, satisfaction)
     values ($1,$2,$3,true,'A','high')`,
    [outcomeA, orgA, workItemA],
  );
});

after(async () => {
  for (const org of [orgA, orgB]) {
    await admin.query("delete from work_outcome where org_id=$1", [org]);
    await admin.query("delete from work_item where org_id=$1", [org]);
    await admin.query("delete from party where org_id=$1", [org]);
    await admin.query("delete from org where id=$1", [org]);
  }
  await admin.end();
  await appPool.end();
});

describe("work_outcome tenant isolation", () => {
  it("org A's outcome is visible under org A context", async () => {
    const n = await withRlsTransaction(
      appPool,
      { orgId: orgA, partyId: null, isSuperadmin: true },
      async (tx) => {
        const res = await tx.execute(sql`select count(*)::int as n from work_outcome where id = ${outcomeA}`);
        return (res.rows[0] as { n: number }).n;
      },
    );
    assert.equal(n, 1, "org A context must see its own outcome");
  });

  it("org A's outcome is INVISIBLE under org B context (zero rows, not error)", async () => {
    const n = await withRlsTransaction(
      appPool,
      { orgId: orgB, partyId: null, isSuperadmin: true },
      async (tx) => {
        const res = await tx.execute(sql`select count(*)::int as n from work_outcome where id = ${outcomeA}`);
        return (res.rows[0] as { n: number }).n;
      },
    );
    assert.equal(n, 0, "org B context must not see org A's outcome");
  });
});

describe("work_outcome unique(work_item_id)", () => {
  it("a second outcome for the same work item is rejected", async () => {
    await assert.rejects(
      admin.query(
        "insert into work_outcome (org_id, work_item_id, on_time) values ($1,$2,false)",
        [orgA, workItemA],
      ),
      /duplicate key|unique/i,
      "the unique index on work_item_id must reject a second outcome",
    );
  });
});

describe("work_outcome grants (no DELETE for the app role)", () => {
  it("app role may INSERT a work_outcome", async () => {
    const wi = randomUUID();
    const id = randomUUID();
    await admin.query(
      "insert into work_item (id, org_id, title, doer_party_id) values ($1,$2,'Insert-grant job',$3)",
      [wi, orgA, writerA],
    );
    await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
      await tx.execute(
        sql`insert into work_outcome (id, org_id, work_item_id, on_time) values (${id}, ${orgA}, ${wi}, true)`,
      );
    });
    await admin.query("delete from work_outcome where id=$1", [id]);
    await admin.query("delete from work_item where id=$1", [wi]);
  });

  it("app role may UPDATE a work_outcome (corrections are edits)", async () => {
    await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
      await tx.execute(sql`update work_outcome set grade = 'B' where id = ${outcomeA}`);
    });
    const grade = await withRlsTransaction(
      appPool,
      { orgId: orgA, partyId: null, isSuperadmin: true },
      async (tx) => {
        const res = await tx.execute(sql`select grade from work_outcome where id = ${outcomeA}`);
        return (res.rows[0] as { grade: string }).grade;
      },
    );
    assert.equal(grade, "B", "UPDATE must be permitted for corrections");
  });

  it("app role may NOT DELETE a work_outcome (an outcome must not vanish)", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
        await tx.execute(sql`delete from work_outcome where id = ${outcomeA}`);
      }),
      /permission denied/i,
      "DELETE on work_outcome must be rejected for the app role",
    );
  });
});

describe("deriveReputation — pure derived read-model (DESIGN_SPEC §8)", () => {
  it("aggregates a 4-job set into correct rates and a penalised reliability score", () => {
    const rows: OutcomeLike[] = [
      { onTime: true, revisionCount: 0, satisfaction: "high" },
      { onTime: true, revisionCount: 2, revisionFault: "writer", complaint: true, satisfaction: "high" },
      { onTime: false, daysLate: 3, revisionCount: 1, revisionFault: "client", failed: true, satisfaction: "low" },
      { onTime: true, revisionCount: 0 },
    ];
    const r = deriveReputation(rows);
    assert.equal(r.jobCount, 4);
    assert.equal(r.onTime.rate, 0.75, "3 of 4 on time");
    assert.equal(r.complaint.rate, 0.25, "1 of 4 complaints");
    assert.equal(r.failRate, 0.25, "1 of 4 failed");
    assert.equal(r.writerFaultRevisions, 1, "only one job had a writer-fault revision");
    assert.equal(r.revisionRate, 0.75, "(0+2+1+0)/4");
    assert.deepEqual(r.satisfaction, { high: 2, neutral: 0, low: 1 });
    assert.equal(r.avgDaysLate, 3, "one measured late job, 3 days");
    assert.ok(
      r.reliabilityScore != null && r.reliabilityScore > 0 && r.reliabilityScore < 100,
      "reliabilityScore is a bounded 0–100 signal",
    );
    assert.ok(r.reliabilityScore! < 75, "the score is penalised below the raw 75% on-time base");
  });

  it("an empty set yields jobCount 0, null rates, and a null score (no signal)", () => {
    const r = deriveReputation([]);
    assert.equal(r.jobCount, 0);
    assert.equal(r.onTime.rate, null);
    assert.equal(r.complaint.rate, null);
    assert.equal(r.failRate, null);
    assert.equal(r.revisionRate, null);
    assert.equal(r.avgDaysLate, null);
    assert.equal(r.reliabilityScore, null, "no score until there is signal to derive from");
    assert.deepEqual(r.satisfaction, { high: 0, neutral: 0, low: 0 });
  });
});
