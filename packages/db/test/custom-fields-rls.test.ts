import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { createPool, sql, withRlsTransaction } from "../src/client.js";
import { env } from "../src/env.js";

/**
 * Module 12 (custom fields) — DATABASE-level proofs (CLAUDE.md §3/§4, 0023).
 * Fixtures built via the admin/superuser connection (bypasses RLS + grants);
 * assertions run via the app role (RLS + grants ENFORCED). Mirrors rls.test.ts.
 *
 * Proves:
 *   • tenant isolation on custom_field_def (org B's defs invisible under org A).
 *   • mutable-not-deletable: app_user may UPDATE a def, but DELETE is denied
 *     (defs are archived, not deleted, so stored values survive).
 *   • party.custom_json + project.custom_json columns exist (insert/select).
 */

const admin = new pg.Client({ connectionString: env.adminUrl });
const appPool = createPool(env.appUrl);

const orgA = randomUUID();
const orgB = randomUUID();
const defA = randomUUID(); // a def in org A
const defB = randomUUID(); // a def in org B (tenant-isolation target)
const partyA = randomUUID();
const projectA = randomUUID();

before(async () => {
  await admin.connect();
  await admin.query("insert into org (id, name) values ($1,'CF Org A'),($2,'CF Org B')", [orgA, orgB]);
  // A def in each org, same target/type — only org membership differs.
  await admin.query(
    `insert into custom_field_def (id, org_id, target_entity, field_name, field_type, scope_json, required)
     values ($1,$2,'work_item','WhatsApp Reference','text','{}',false)`,
    [defA, orgA],
  );
  await admin.query(
    `insert into custom_field_def (id, org_id, target_entity, field_name, field_type, scope_json, required)
     values ($1,$2,'work_item','Org B Secret Field','text','{}',false)`,
    [defB, orgB],
  );
  // A party + project in org A carrying custom_json values (column existence).
  await admin.query(
    `insert into party (id, org_id, display_name, party_type, custom_json)
     values ($1,$2,'CF Party','{client}', $3::jsonb)`,
    [partyA, orgA, JSON.stringify({ [defA]: "party-value" })],
  );
  await admin.query(
    `insert into project (id, org_id, title, custom_json)
     values ($1,$2,'CF Project', $3::jsonb)`,
    [projectA, orgA, JSON.stringify({ [defA]: "project-value" })],
  );
});

after(async () => {
  for (const org of [orgA, orgB]) {
    await admin.query("delete from custom_field_def where org_id=$1", [org]);
    await admin.query("delete from project where org_id=$1", [org]);
    await admin.query("delete from party where org_id=$1", [org]);
    await admin.query("delete from org where id=$1", [org]);
  }
  await admin.end();
  await appPool.end();
});

describe("custom_field_def — tenant isolation", () => {
  it("org A context sees its own def", async () => {
    const n = await withRlsTransaction(
      appPool,
      { orgId: orgA, partyId: null, isSuperadmin: true },
      async (tx) => {
        const r = await tx.execute(sql`select count(*)::int n from custom_field_def where id = ${defA}`);
        return (r.rows[0] as { n: number }).n;
      },
    );
    assert.equal(n, 1, "org A's own def is visible");
  });

  it("org A context CANNOT see org B's def (even as SuperAdmin) — zero rows, not error", async () => {
    const n = await withRlsTransaction(
      appPool,
      { orgId: orgA, partyId: null, isSuperadmin: true },
      async (tx) => {
        const r = await tx.execute(sql`select count(*)::int n from custom_field_def where id = ${defB}`);
        return (r.rows[0] as { n: number }).n;
      },
    );
    assert.equal(n, 0, "org B's def must be invisible under org A context");
  });
});

describe("custom_field_def — mutable but not deletable (archive, not delete)", () => {
  it("app_user may UPDATE a def (rename / archive)", async () => {
    await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
      await tx.execute(sql`update custom_field_def set field_name = 'Renamed' where id = ${defA}`);
    });
    const r = await admin.query("select field_name from custom_field_def where id=$1", [defA]);
    assert.equal(r.rows[0].field_name, "Renamed", "the UPDATE took effect");
  });

  it("app_user DELETE on custom_field_def is denied (permission denied)", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
        await tx.execute(sql`delete from custom_field_def where id = ${defA}`);
      }),
      /permission denied/i,
    );
  });
});

describe("custom_json columns on party + project (0023)", () => {
  it("party.custom_json holds and returns a keyed value", async () => {
    const val = await withRlsTransaction(
      appPool,
      { orgId: orgA, partyId: null, isSuperadmin: true },
      async (tx) => {
        const r = await tx.execute(
          sql`select custom_json ->> ${defA} as v from party where id = ${partyA}`,
        );
        return (r.rows[0] as { v: string | null }).v;
      },
    );
    assert.equal(val, "party-value", "party.custom_json round-trips a value keyed by the def id");
  });

  it("project.custom_json holds and returns a keyed value", async () => {
    const val = await withRlsTransaction(
      appPool,
      { orgId: orgA, partyId: null, isSuperadmin: true },
      async (tx) => {
        const r = await tx.execute(
          sql`select custom_json ->> ${defA} as v from project where id = ${projectA}`,
        );
        return (r.rows[0] as { v: string | null }).v;
      },
    );
    assert.equal(val, "project-value", "project.custom_json round-trips a value keyed by the def id");
  });
});
