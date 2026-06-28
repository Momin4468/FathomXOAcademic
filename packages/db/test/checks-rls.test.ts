import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { createPool, sql, withRlsTransaction } from "../src/client.js";
import { env } from "../src/env.js";

/**
 * Module 10 (checks) — DATABASE-level proofs for the AI/plagiarism check service
 * (CLAUDE.md §3/§4, migration 0020). Fixtures built via the admin/superuser
 * connection (bypasses RLS + grants); assertions run via the app role (RLS +
 * grants ENFORCED). Mirrors billing-rls.test.ts conventions.
 *
 * Proves:
 *   • tenant isolation: check_channel / check_tool_account / check_batch inserted
 *     in org A are invisible from an org-B-scoped tx (zero rows), visible from A.
 *   • append-only credit ledger: UPDATE/DELETE on check_credit_topup rejected
 *     for the app role; INSERT allowed (corrections = negative rows).
 *   • DELETE on check_batch rejected (batches archive, never delete).
 */

const admin = new pg.Client({ connectionString: env.adminUrl });
const appPool = createPool(env.appUrl);

const orgA = randomUUID();
const orgB = randomUUID();
const employeeA = randomUUID();
const employeeB = randomUUID();
const channelA = randomUUID();
const toolAccountA = randomUUID();
const topupA = randomUUID();
const batchA = randomUUID();
// org B
const channelB = randomUUID();
const toolAccountB = randomUUID();
const batchB = randomUUID();

before(async () => {
  await admin.connect();
  await admin.query("insert into org (id, name) values ($1,'M10 Org A'),($2,'M10 Org B')", [orgA, orgB]);
  await admin.query(
    `insert into party (id, org_id, display_name, party_type) values
       ($1,$3,'EmployeeA','{writer}'),($2,$4,'EmployeeB','{writer}')`,
    [employeeA, employeeB, orgA, orgB],
  );

  // Org A fixtures.
  await admin.query(
    "insert into check_channel (id, org_id, label, employee_party_id) values ($1,$2,'WA A',$3)",
    [channelA, orgA, employeeA],
  );
  await admin.query(
    "insert into check_tool_account (id, org_id, label) values ($1,$2,'AcademyCX A')",
    [toolAccountA, orgA],
  );
  await admin.query(
    "insert into check_credit_topup (id, org_id, tool_account_id, credits, cost, purchased_at) values ($1,$2,$3,1000,5000,current_date)",
    [topupA, orgA, toolAccountA],
  );
  await admin.query(
    `insert into check_batch (id, org_id, channel_id, tool_account_id, period_date, files_checked, files_paid, amount_collected, status)
       values ($1,$2,$3,$4,current_date,10,8,1200,'proposed')`,
    [batchA, orgA, channelA, toolAccountA],
  );

  // Org B fixtures (tenant isolation).
  await admin.query(
    "insert into check_channel (id, org_id, label, employee_party_id) values ($1,$2,'WA B',$3)",
    [channelB, orgB, employeeB],
  );
  await admin.query(
    "insert into check_tool_account (id, org_id, label) values ($1,$2,'AcademyCX B')",
    [toolAccountB, orgB],
  );
  await admin.query(
    `insert into check_batch (id, org_id, channel_id, tool_account_id, period_date, files_checked, files_paid, amount_collected, status)
       values ($1,$2,$3,$4,current_date,5,5,999,'proposed')`,
    [batchB, orgB, channelB, toolAccountB],
  );
});

after(async () => {
  for (const org of [orgA, orgB]) {
    await admin.query("delete from check_file where org_id=$1", [org]);
    await admin.query("delete from check_batch where org_id=$1", [org]);
    await admin.query("delete from check_credit_topup where org_id=$1", [org]);
    await admin.query("delete from check_tool_account where org_id=$1", [org]);
    await admin.query("delete from check_channel where org_id=$1", [org]);
    await admin.query("delete from party where org_id=$1", [org]);
    await admin.query("delete from org where id=$1", [org]);
  }
  await admin.end();
  await appPool.end();
});

// ─── Tenant isolation ────────────────────────────────────────────────────────

async function countVisible(table: string, id: string, orgCtx: string): Promise<number> {
  return withRlsTransaction(appPool, { orgId: orgCtx, partyId: null, isSuperadmin: true }, async (tx) => {
    const res = await tx.execute(sql`select count(*)::int as n from ${sql.raw(table)} where id = ${id}`);
    return (res.rows[0] as { n: number }).n;
  });
}

describe("tenant isolation — org A rows invisible under org B context", () => {
  it("check_channel A is visible under org A, ZERO rows under org B", async () => {
    assert.equal(await countVisible("check_channel", channelA, orgA), 1, "visible from A");
    assert.equal(await countVisible("check_channel", channelA, orgB), 0, "invisible from B (not an error)");
  });

  it("check_tool_account A is visible under org A, ZERO rows under org B", async () => {
    assert.equal(await countVisible("check_tool_account", toolAccountA, orgA), 1, "visible from A");
    assert.equal(await countVisible("check_tool_account", toolAccountA, orgB), 0, "invisible from B");
  });

  it("check_batch A is visible under org A, ZERO rows under org B", async () => {
    assert.equal(await countVisible("check_batch", batchA, orgA), 1, "visible from A");
    assert.equal(await countVisible("check_batch", batchA, orgB), 0, "invisible from B");
  });

  it("symmetry: org B's batch is invisible under org A context", async () => {
    assert.equal(await countVisible("check_batch", batchB, orgB), 1, "visible from B");
    assert.equal(await countVisible("check_batch", batchB, orgA), 0, "invisible from A");
  });
});

// ─── Append-only credit ledger ───────────────────────────────────────────────

describe("append-only — check_credit_topup (credit purchases are the cost basis)", () => {
  it("rejects UPDATE on check_credit_topup", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
        await tx.execute(sql`update check_credit_topup set cost = 1 where id = ${topupA}`);
      }),
      /permission denied/i,
    );
  });

  it("rejects DELETE on check_credit_topup", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
        await tx.execute(sql`delete from check_credit_topup where id = ${topupA}`);
      }),
      /permission denied/i,
    );
  });

  it("ALLOWS INSERT on check_credit_topup (corrections = negative rows)", async () => {
    const id = randomUUID();
    await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
      await tx.execute(sql`
        insert into check_credit_topup (id, org_id, tool_account_id, credits, cost, purchased_at)
        values (${id}, ${orgA}, ${toolAccountA}, -100, -500, current_date)
      `);
    });
    await admin.query("delete from check_credit_topup where id=$1", [id]);
  });
});

describe("append-only — check_batch is never deleted (it archives)", () => {
  it("rejects DELETE on check_batch", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
        await tx.execute(sql`delete from check_batch where id = ${batchA}`);
      }),
      /permission denied/i,
    );
  });
});
