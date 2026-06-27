import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { createPool, sql, withRlsTransaction } from "../src/client.js";
import { env } from "../src/env.js";

/**
 * Projects / engagements module — DATABASE-level proofs (CLAUDE.md §3.1,
 * SCHEMA §C). Built with the admin/superuser connection (bypasses RLS);
 * asserted via the app role (RLS ENFORCED). Mirrors work-module2.test.ts.
 *
 * Proves:
 *   • tenant isolation: a project / milestone / milestone_template inserted in
 *     org A is INVISIBLE from an app-pool tx scoped to org B (zero rows), and
 *     visible scoped to org A.
 *   • work_item.trackable defaults true, billable defaults false.
 *   • milestone.due_at / due_tz persist; provenance (created_by) columns accept
 *     values on project + milestone.
 */

const admin = new pg.Client({ connectionString: env.adminUrl });
const appPool = createPool(env.appUrl);

const orgA = randomUUID();
const orgB = randomUUID();

const userA = randomUUID(); // provenance actor in org A

// Org A fixtures.
const templateA = randomUUID();
const templateItemA = randomUUID();
const projectA = randomUUID();
const milestoneA = randomUUID();
const childWorkItemA = randomUUID(); // child with defaulted flags

// Org B fixtures (tenant isolation — must be invisible under org A).
const templateB = randomUUID();
const projectB = randomUUID();
const milestoneB = randomUUID();

const DUE_AT = "2026-09-01T07:00:00.000Z"; // 2026-09-01 17:00 Australia/Sydney (UTC+10)
const DUE_TZ = "Australia/Sydney";

before(async () => {
  await admin.connect();
  await admin.query("insert into org (id, name) values ($1,'PRJ Org A'),($2,'PRJ Org B')", [orgA, orgB]);
  await admin.query(
    "insert into user_account (id, org_id, email, password_hash) values ($1,$2,$3,'x')",
    [userA, orgA, `prj+${userA}@fathomxo.test`],
  );

  // Org A: template + item, project (with provenance), milestone (with tz due + provenance).
  await admin.query(
    "insert into milestone_template (id, org_id, name, created_by) values ($1,$2,'UWTSD MBA Thesis (PRJ)',$3)",
    [templateA, orgA, userA],
  );
  await admin.query(
    "insert into milestone_template_item (id, org_id, template_id, title, sort) values ($1,$2,$3,'Proposal',1)",
    [templateItemA, orgA, templateA],
  );
  await admin.query(
    "insert into project (id, org_id, title, template_id, estimate_amount, created_by, updated_by) values ($1,$2,'Thesis Engagement (PRJ)',$3,5000,$4,$4)",
    [projectA, orgA, templateA, userA],
  );
  await admin.query(
    "insert into milestone (id, org_id, project_id, title, due_at, due_tz, created_by, updated_by) values ($1,$2,$3,'Proposal',$4,$5,$6,$6)",
    [milestoneA, orgA, projectA, DUE_AT, DUE_TZ, userA],
  );
  // Child work item created WITHOUT trackable/billable → DB defaults apply.
  await admin.query(
    "insert into work_item (id, org_id, project_id, title) values ($1,$2,$3,'Child (PRJ)')",
    [childWorkItemA, orgA, projectA],
  );

  // Org B: parallel rows, for tenant isolation.
  await admin.query(
    "insert into milestone_template (id, org_id, name) values ($1,$2,'OrgB Template (PRJ)')",
    [templateB, orgB],
  );
  await admin.query(
    "insert into project (id, org_id, title) values ($1,$2,'OrgB Engagement (PRJ)')",
    [projectB, orgB],
  );
  await admin.query(
    "insert into milestone (id, org_id, project_id, title) values ($1,$2,$3,'OrgB Milestone (PRJ)')",
    [milestoneB, orgB, projectB],
  );
});

after(async () => {
  for (const org of [orgA, orgB]) {
    await admin.query("delete from work_item where org_id=$1", [org]);
    await admin.query("delete from milestone where org_id=$1", [org]);
    await admin.query("delete from project where org_id=$1", [org]);
    await admin.query("delete from milestone_template_item where org_id=$1", [org]);
    await admin.query("delete from milestone_template where org_id=$1", [org]);
    await admin.query("delete from user_account where org_id=$1", [org]);
    await admin.query("delete from org where id=$1", [org]);
  }
  await admin.end();
  await appPool.end();
});

/** Count rows of a table by id, under a given org context (SuperAdmin, no party). */
async function countByIdUnderOrg(orgId: string, table: string, id: string): Promise<number> {
  return withRlsTransaction(appPool, { orgId, partyId: null, isSuperadmin: true }, async (tx) => {
    const r = await tx.execute(
      sql`select count(*)::int as n from ${sql.raw(table)} where id = ${id}`,
    );
    return (r.rows[0] as { n: number }).n;
  });
}

describe("Projects — tenant isolation (CLAUDE.md §3.1)", () => {
  const cases: Array<{ table: string; orgBId: string; orgAId: string }> = [
    { table: "project", orgBId: projectB, orgAId: projectA },
    { table: "milestone", orgBId: milestoneB, orgAId: milestoneA },
    { table: "milestone_template", orgBId: templateB, orgAId: templateA },
  ];
  for (const c of cases) {
    it(`org B ${c.table} is INVISIBLE under org A context (zero rows)`, async () => {
      const n = await countByIdUnderOrg(orgA, c.table, c.orgBId);
      assert.equal(n, 0, `org B's ${c.table} must be invisible under org A`);
    });
    it(`org A ${c.table} IS visible under org A context`, async () => {
      const n = await countByIdUnderOrg(orgA, c.table, c.orgAId);
      assert.equal(n, 1, `org A's own ${c.table} must be visible under org A`);
    });
    it(`org A ${c.table} is invisible under org B context`, async () => {
      const n = await countByIdUnderOrg(orgB, c.table, c.orgAId);
      assert.equal(n, 0, `org A's ${c.table} must be invisible under org B`);
    });
  }
});

describe("Projects — work_item child flag defaults (SCHEMA §C)", () => {
  it("a child work_item defaults trackable=true, billable=false", async () => {
    const row = await withRlsTransaction(
      appPool,
      { orgId: orgA, partyId: null, isSuperadmin: true },
      async (tx) => {
        const r = await tx.execute(
          sql`select trackable, billable from work_item where id = ${childWorkItemA}`,
        );
        return r.rows[0] as { trackable: boolean; billable: boolean };
      },
    );
    assert.equal(row.trackable, true, "trackable defaults true");
    assert.equal(row.billable, false, "billable defaults false");
  });
});

describe("Projects — milestone tz-deadline + provenance persist (SCHEMA §C, §8)", () => {
  it("milestone.due_at + due_tz persist as the absolute instant and IANA zone", async () => {
    const row = await withRlsTransaction(
      appPool,
      { orgId: orgA, partyId: null, isSuperadmin: true },
      async (tx) => {
        const r = await tx.execute(
          sql`select due_at, due_tz from milestone where id = ${milestoneA}`,
        );
        return r.rows[0] as { due_at: Date | string; due_tz: string };
      },
    );
    assert.ok(row.due_at, "due_at is stored (non-null)");
    assert.equal(new Date(row.due_at).toISOString(), DUE_AT, "due_at is the exact absolute instant");
    assert.equal(row.due_tz, DUE_TZ, "due_tz is the IANA zone string");
  });

  it("project + milestone provenance (created_by) accept and persist actor values", async () => {
    const rows = await withRlsTransaction(
      appPool,
      { orgId: orgA, partyId: null, isSuperadmin: true },
      async (tx) => {
        const p = await tx.execute(sql`select created_by, updated_by from project where id = ${projectA}`);
        const m = await tx.execute(sql`select created_by, updated_by from milestone where id = ${milestoneA}`);
        return {
          project: p.rows[0] as { created_by: string | null; updated_by: string | null },
          milestone: m.rows[0] as { created_by: string | null; updated_by: string | null },
        };
      },
    );
    assert.equal(rows.project.created_by, userA, "project.created_by persists");
    assert.equal(rows.project.updated_by, userA, "project.updated_by persists");
    assert.equal(rows.milestone.created_by, userA, "milestone.created_by persists");
    assert.equal(rows.milestone.updated_by, userA, "milestone.updated_by persists");
  });
});
