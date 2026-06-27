import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { createPool, sql, withRlsTransaction } from "../src/client.js";
import { env } from "../src/env.js";

/**
 * Module 6 — tenant isolation at the DATABASE level for `expense` and `task`
 * (CLAUDE.md §3.1, SCHEMA §G/§I, migration 0011). Fixtures built via the admin
 * connection (bypasses RLS); assertions run via the app role (RLS enforced).
 * Org B's rows must be invisible under an org A context, and vice-versa.
 */

const admin = new pg.Client({ connectionString: env.adminUrl });
const appPool = createPool(env.appUrl);

const orgA = randomUUID();
const orgB = randomUUID();
const expenseA = randomUUID();
const expenseB = randomUUID();
const taskA = randomUUID();
const taskB = randomUUID();

before(async () => {
  await admin.connect();
  await admin.query("insert into org (id, name) values ($1,'M6 Org A'),($2,'M6 Org B')", [orgA, orgB]);
  await admin.query(
    `insert into expense (id, org_id, category, amount, incurred_at, cost_bearer) values
       ($1,$3,'subscription',100,current_date,'momin'),
       ($2,$4,'subscription',200,current_date,'emon')`,
    [expenseA, expenseB, orgA, orgB],
  );
  await admin.query(
    `insert into task (id, org_id, title) values
       ($1,$3,'Org A task'),
       ($2,$4,'Org B task')`,
    [taskA, taskB, orgA, orgB],
  );
});

after(async () => {
  for (const org of [orgA, orgB]) {
    await admin.query("delete from task where org_id=$1", [org]);
    await admin.query("delete from expense where org_id=$1", [org]);
    await admin.query("delete from org where id=$1", [org]);
  }
  await admin.end();
  await appPool.end();
});

async function countWhere(table: "expense" | "task", org: string, id: string, isSuperadmin: boolean) {
  return withRlsTransaction(appPool, { orgId: org, partyId: null, isSuperadmin }, async (tx) => {
    const res =
      table === "expense"
        ? await tx.execute(sql`select count(*)::int as n from expense where id = ${id}`)
        : await tx.execute(sql`select count(*)::int as n from task where id = ${id}`);
    return (res.rows[0] as { n: number }).n;
  });
}

describe("expense tenant isolation", () => {
  it("org A context sees its own expense", async () => {
    assert.equal(await countWhere("expense", orgA, expenseA, false), 1);
  });

  it("org A context CANNOT see org B's expense (zero rows, not error)", async () => {
    assert.equal(await countWhere("expense", orgA, expenseB, false), 0);
  });

  it("even a SuperAdmin scoped to org A cannot reach org B's expense", async () => {
    assert.equal(await countWhere("expense", orgA, expenseB, true), 0);
  });

  it("org B context cannot see org A's expense (symmetric)", async () => {
    assert.equal(await countWhere("expense", orgB, expenseA, false), 0);
  });
});

describe("task tenant isolation", () => {
  it("org A context sees its own task", async () => {
    assert.equal(await countWhere("task", orgA, taskA, false), 1);
  });

  it("org A context CANNOT see org B's task (zero rows, not error)", async () => {
    assert.equal(await countWhere("task", orgA, taskB, false), 0);
  });

  it("even a SuperAdmin scoped to org A cannot reach org B's task", async () => {
    assert.equal(await countWhere("task", orgA, taskB, true), 0);
  });

  it("org B context cannot see org A's task (symmetric)", async () => {
    assert.equal(await countWhere("task", orgB, taskA, false), 0);
  });
});
