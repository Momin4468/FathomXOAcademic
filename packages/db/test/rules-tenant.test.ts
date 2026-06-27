import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { createPool, sql, withRlsTransaction } from "../src/client.js";
import { env } from "../src/env.js";

/**
 * Module 3 — DB-layer tenant isolation for the rule tables (CLAUDE.md §3.1).
 * Org B's deal_term/comp_rule must be invisible under an org-A context, and an
 * org-A "supersede"-style UPDATE must not touch an org-B row (RLS, not app code,
 * is the floor). Fixtures via the admin connection (bypasses RLS); assertions
 * via the app role (RLS enforced).
 */

const admin = new pg.Client({ connectionString: env.adminUrl });
const appPool = createPool(env.appUrl);

const orgA = randomUUID();
const orgB = randomUUID();
const fromA = randomUUID();
const toA = randomUUID();
const fromB = randomUUID();
const toB = randomUUID();
const dealTermA = randomUUID();
const dealTermB = randomUUID();
const compRuleA = randomUUID();
const compRuleB = randomUUID();

before(async () => {
  await admin.connect();
  await admin.query("insert into org (id, name) values ($1,'Rules Org A'),($2,'Rules Org B')", [orgA, orgB]);
  await admin.query(
    `insert into party (id, org_id, display_name, party_type) values
       ($1,$5,'FromA','{partner}'),($2,$5,'ToA','{writer}'),
       ($3,$6,'FromB','{partner}'),($4,$6,'ToB','{writer}')`,
    [fromA, toA, fromB, toB, orgA, orgB],
  );
  await admin.query(
    `insert into deal_term (id, org_id, from_party_id, to_party_id, applies_to, term_type, value, effective_from)
     values ($1,$3,$5,$6,'default','per_word',1.0,'2026-01-01'),
            ($2,$4,$7,$8,'default','per_word',2.0,'2026-01-01')`,
    [dealTermA, dealTermB, orgA, orgB, fromA, toA, fromB, toB],
  );
  await admin.query(
    `insert into comp_rule (id, org_id, party_id, basis, rate, cost_bearer, effective_from)
     values ($1,$3,$5,'per_word',0.5,'momin','2026-01-01'),
            ($2,$4,$6,'per_word',0.8,'emon','2026-01-01')`,
    [compRuleA, compRuleB, orgA, orgB, toA, toB],
  );
});

after(async () => {
  for (const org of [orgA, orgB]) {
    await admin.query("delete from deal_term where org_id=$1", [org]);
    await admin.query("delete from comp_rule where org_id=$1", [org]);
    await admin.query("delete from party where org_id=$1", [org]);
    await admin.query("delete from org where id=$1", [org]);
  }
  await admin.end();
  await appPool.end();
});

describe("rules tenant isolation — deal_term", () => {
  it("org A context sees its own deal_term", async () => {
    const n = await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
      const res = await tx.execute(sql`select count(*)::int as n from deal_term where id = ${dealTermA}`);
      return (res.rows[0] as { n: number }).n;
    });
    assert.equal(n, 1);
  });

  it("org A context cannot see org B's deal_term (even as SuperAdmin)", async () => {
    const n = await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
      const res = await tx.execute(sql`select count(*)::int as n from deal_term where id = ${dealTermB}`);
      return (res.rows[0] as { n: number }).n;
    });
    assert.equal(n, 0, "org B's deal_term must be invisible under org A context");
  });

  it("a supersede-style UPDATE of org B's deal_term under org A affects ZERO rows", async () => {
    const affected = await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
      const res = await tx.execute(
        sql`update deal_term set effective_to = '2026-06-01' where id = ${dealTermB}`,
      );
      return res.rowCount ?? 0;
    });
    assert.equal(affected, 0, "RLS hides org B's row → the cross-tenant UPDATE is a no-op");
    // Confirm via admin that org B's row is untouched.
    const check = await admin.query("select effective_to from deal_term where id=$1", [dealTermB]);
    assert.equal(check.rows[0].effective_to, null, "org B's deal_term must remain unmodified");
  });
});

describe("rules tenant isolation — comp_rule", () => {
  it("org A context sees its own comp_rule but not org B's", async () => {
    const [own, foreign] = await withRlsTransaction(
      appPool,
      { orgId: orgA, partyId: null, isSuperadmin: true },
      async (tx) => {
        const a = await tx.execute(sql`select count(*)::int as n from comp_rule where id = ${compRuleA}`);
        const b = await tx.execute(sql`select count(*)::int as n from comp_rule where id = ${compRuleB}`);
        return [(a.rows[0] as { n: number }).n, (b.rows[0] as { n: number }).n];
      },
    );
    assert.equal(own, 1, "org A's comp_rule is visible");
    assert.equal(foreign, 0, "org B's comp_rule is invisible under org A context");
  });
});
