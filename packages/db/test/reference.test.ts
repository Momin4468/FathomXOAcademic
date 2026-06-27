import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { createPool, sql, withRlsTransaction } from "../src/client.js";
import { env } from "../src/env.js";
import { normalize } from "@business-os/shared";

/**
 * Module 1 (canonical reference data + party/client directory) — DATABASE-LAYER
 * proofs. Mirrors rls.test.ts/auth-security.test.ts conventions: fixtures built via
 * the admin/owner connection (bypasses RLS); assertions run via the app role
 * (`app_user`, RLS enforced).
 *
 * Covers:
 *   1. normalize() unit (the fuzzy-in key; both API + web rely on it).
 *   2. Merge semantics replicated at the DB layer (alias move, FK repoint,
 *      archive+redirect, exclude-from-search) — the cleanest place to pin them.
 *   3. Tenant isolation on ref_entity / ref_alias / party.
 *   4. The unique(org_id, ref_id, normalized) alias constraint.
 */

const admin = new pg.Client({ connectionString: env.adminUrl });
const appPool = createPool(env.appUrl);

const orgA = randomUUID();
const orgB = randomUUID();

// Merge fixture: a confirmed survivor + a provisional duplicate, both kind=course.
const survivorId = randomUUID(); // canonical "ICT 701"
const duplicateId = randomUUID(); // provisional "ICT-701" typed by a writer
const aliasSurvivor = randomUUID();
const aliasDup701 = randomUUID(); // "701" on the dup — must MOVE to survivor
const aliasDupClash = randomUUID(); // duplicate normalized of survivor — must be DROPPED on merge
// A party at the duplicate university so we can prove FK repoint.
const partyAtDup = randomUUID();

// Org B fixtures (tenant isolation).
const entityB = randomUUID();
const aliasB = randomUUID();
const partyB = randomUUID();

before(async () => {
  await admin.connect();
  await admin.query("insert into org (id, name) values ($1,'Ref Org A'),($2,'Ref Org B')", [orgA, orgB]);

  // Survivor entity (confirmed) with its own alias.
  await admin.query(
    `insert into ref_entity (id, org_id, kind, canonical, status) values
       ($1,$2,'course','ICT 701','confirmed')`,
    [survivorId, orgA],
  );
  await admin.query(
    `insert into ref_alias (id, org_id, ref_id, alias, normalized) values ($1,$2,$3,'ICT 701','ict701')`,
    [aliasSurvivor, orgA, survivorId],
  );

  // Duplicate entity (provisional) with two aliases: one unique ("701"), one
  // that clashes with the survivor's normalized ("ict701").
  await admin.query(
    `insert into ref_entity (id, org_id, kind, canonical, status) values
       ($1,$2,'course','ICT-701','provisional')`,
    [duplicateId, orgA],
  );
  await admin.query(
    `insert into ref_alias (id, org_id, ref_id, alias, normalized) values
       ($1,$3,$4,'701','701'),
       ($2,$3,$4,'ICT701','ict701')`,
    [aliasDup701, aliasDupClash, orgA, duplicateId],
  );

  // A party pointing at the duplicate university-as-course id (FK is to ref_entity).
  await admin.query(
    `insert into party (id, org_id, display_name, party_type, university_id) values
       ($1,$2,'Student At Dup','{client}',$3)`,
    [partyAtDup, orgA, duplicateId],
  );

  // Org B: its own confirmed entity + alias + party.
  await admin.query(
    `insert into ref_entity (id, org_id, kind, canonical, status) values ($1,$2,'course','OrgB Course','confirmed')`,
    [entityB, orgB],
  );
  await admin.query(
    `insert into ref_alias (id, org_id, ref_id, alias, normalized) values ($1,$2,$3,'OrgB Course','orgbcourse')`,
    [aliasB, orgB, entityB],
  );
  await admin.query(
    `insert into party (id, org_id, display_name, party_type) values ($1,$2,'OrgB Party','{client}')`,
    [partyB, orgB],
  );
});

after(async () => {
  for (const org of [orgA, orgB]) {
    await admin.query("delete from party where org_id=$1", [org]);
    await admin.query("delete from ref_alias where org_id=$1", [org]);
    await admin.query("update ref_entity set merged_into_id=null where org_id=$1", [org]);
    await admin.query("delete from ref_entity where org_id=$1", [org]);
    await admin.query("delete from audit_log where org_id=$1", [org]);
    await admin.query("delete from org where id=$1", [org]);
  }
  await admin.end();
  await appPool.end();
});

// ─── 1. normalize() unit ──────────────────────────────────────────────────────

describe("normalize() — fuzzy-in / canonical-out key (DESIGN_SPEC §7)", () => {
  it("collapses case / spaces / punctuation: ICT 701 variants all map to one key", () => {
    const key = normalize("ICT 701");
    assert.equal(key, "ict701");
    for (const v of ["ICT701", "ICT  701", "ict-701", "  ICT 701  ", "i.c.t 701", "ICT_701"]) {
      assert.equal(normalize(v), "ict701", `"${v}" must normalize to ict701`);
    }
  });

  it("does NOT unify genuinely-different spellings (701 stays 701)", () => {
    assert.equal(normalize("701"), "701");
    assert.notEqual(normalize("701"), normalize("ICT701"));
  });

  it("strips accents (NFKD decompose then drop non-alphanumerics)", () => {
    assert.equal(normalize("Café"), "cafe");
    assert.equal(normalize("Universität München"), "universitatmunchen");
    assert.equal(normalize("naïve"), "naive");
  });

  it("empty / punctuation-only input yields an empty key (caller must guard)", () => {
    assert.equal(normalize(""), "");
    assert.equal(normalize("   "), "");
    assert.equal(normalize("---"), "");
  });
});

// ─── 2. Merge semantics (DB layer, replicating ReferenceService.merge) ─────────

describe("merge: duplicate -> canonical survivor (DESIGN_SPEC §7)", () => {
  before(async () => {
    // Replicate the exact steps of ReferenceService.merge() under the APP role +
    // org A context, so RLS, grants, and the unique constraint all participate.
    await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: false }, async (tx) => {
      // 1. Drop source aliases whose normalized already exists on target.
      await tx.execute(sql`
        delete from ref_alias
        where ref_id = ${duplicateId}
          and normalized in (select normalized from ref_alias where ref_id = ${survivorId})
      `);
      // 2. Move remaining source aliases to the target.
      await tx.execute(sql`update ref_alias set ref_id = ${survivorId} where ref_id = ${duplicateId}`);
      // 3. Ensure the source canonical still resolves to the survivor.
      await tx.execute(sql`
        insert into ref_alias (org_id, ref_id, alias, normalized)
        values (${orgA}, ${survivorId}, 'ICT-701', ${normalize("ICT-701")})
        on conflict (org_id, ref_id, normalized) do nothing
      `);
      // 4. Repoint FK references (party.university_id).
      await tx.execute(sql`update party set university_id = ${survivorId} where university_id = ${duplicateId}`);
      // 5. Archive source, redirect to survivor.
      await tx.execute(sql`
        update ref_entity set archived_at = now(), merged_into_id = ${survivorId} where id = ${duplicateId}
      `);
      // 6. Governance writes an audit row.
      await tx.execute(sql`
        insert into audit_log (org_id, action, entity, entity_id, detail_json)
        values (${orgA}, 'reference.entity_merged', 'ref_entity', ${duplicateId},
                ${JSON.stringify({ sourceId: duplicateId, targetId: survivorId })}::jsonb)
      `);
    });
  });

  it("archives the source (archived_at set) and redirects merged_into_id -> survivor", async () => {
    const row = await admin.query(
      "select archived_at, merged_into_id from ref_entity where id=$1",
      [duplicateId],
    );
    assert.ok(row.rows[0].archived_at, "source must be archived");
    assert.equal(row.rows[0].merged_into_id, survivorId, "source must redirect to survivor");
  });

  it("moves the unique source alias (701) to the survivor so the old code still resolves", async () => {
    const r = await admin.query("select ref_id from ref_alias where id=$1", [aliasDup701]);
    assert.equal(r.rows[0].ref_id, survivorId, "alias '701' must now point at the survivor");
  });

  it("drops the clashing source alias rather than violating the unique constraint", async () => {
    const r = await admin.query("select count(*)::int n from ref_alias where id=$1", [aliasDupClash]);
    assert.equal(r.rows[0].n, 0, "the duplicate 'ict701' alias on the source must be dropped");
    // Survivor still has exactly one ict701 alias (no duplicate created).
    const s = await admin.query(
      "select count(*)::int n from ref_alias where ref_id=$1 and normalized='ict701'",
      [survivorId],
    );
    assert.equal(s.rows[0].n, 1, "survivor keeps a single ict701 alias");
  });

  it("keeps the old canonical name resolving (ICT-701 -> survivor)", async () => {
    const r = await admin.query(
      "select ref_id from ref_alias where ref_id=$1 and normalized=$2",
      [survivorId, normalize("ICT-701")],
    );
    assert.equal(r.rows.length, 1, "ICT-701 must resolve to the survivor after merge");
  });

  it("repoints party.university_id from source -> survivor", async () => {
    const r = await admin.query("select university_id from party where id=$1", [partyAtDup]);
    assert.equal(r.rows[0].university_id, survivorId, "the party must now point at the survivor");
  });

  it("excludes the archived source from app-role search (archived_at is null filter)", async () => {
    const ids = await withRlsTransaction(
      appPool,
      { orgId: orgA, partyId: null, isSuperadmin: false },
      async (tx) => {
        const res = await tx.execute(sql`
          select distinct e.id
          from ref_alias a join ref_entity e on e.id = a.ref_id
          where e.kind='course' and e.archived_at is null and a.normalized='ict701'
        `);
        return (res.rows as Array<{ id: string }>).map((r) => r.id);
      },
    );
    assert.ok(ids.includes(survivorId), "survivor is findable");
    assert.ok(!ids.includes(duplicateId), "archived source must NOT appear in search");
  });

  it("writes an audit_log row for the merge (governance action is recorded)", async () => {
    const r = await admin.query(
      "select count(*)::int n from audit_log where action='reference.entity_merged' and entity_id=$1",
      [duplicateId],
    );
    assert.equal(r.rows[0].n, 1, "merge must be audited immutably");
  });
});

// ─── 3. Tenant isolation ───────────────────────────────────────────────────────

describe("tenant isolation on reference + directory (CLAUDE.md §3.1)", () => {
  it("org A context cannot see org B's ref_entity", async () => {
    const n = await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
      const res = await tx.execute(sql`select count(*)::int n from ref_entity where id = ${entityB}`);
      return (res.rows[0] as { n: number }).n;
    });
    assert.equal(n, 0, "org B's entity must be invisible under org A (even as superadmin)");
  });

  it("org A context cannot see org B's ref_alias", async () => {
    const n = await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
      const res = await tx.execute(sql`select count(*)::int n from ref_alias where id = ${aliasB}`);
      return (res.rows[0] as { n: number }).n;
    });
    assert.equal(n, 0, "org B's alias must be invisible under org A");
  });

  it("org A context cannot see org B's party", async () => {
    const n = await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
      const res = await tx.execute(sql`select count(*)::int n from party where id = ${partyB}`);
      return (res.rows[0] as { n: number }).n;
    });
    assert.equal(n, 0, "org B's party must be invisible under org A");
  });
});

// ─── 4. Unique alias constraint ────────────────────────────────────────────────

describe("ref_alias unique(org_id, ref_id, normalized) constraint", () => {
  it("rejects a second alias with the same normalized on the same entity", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: false }, async (tx) => {
        // survivor already has normalized 'ict701' (post-merge). A second must fail.
        await tx.execute(sql`
          insert into ref_alias (org_id, ref_id, alias, normalized)
          values (${orgA}, ${survivorId}, 'Ict701', 'ict701')
        `);
      }),
      /duplicate key|unique/i,
      "the unique constraint must reject a duplicate normalized alias on one entity",
    );
  });

  it("ALLOWS the same normalized on a DIFFERENT entity (constraint is per-entity)", async () => {
    const otherEntity = randomUUID();
    await admin.query(
      `insert into ref_entity (id, org_id, kind, canonical, status) values ($1,$2,'course','Other 701','provisional')`,
      [otherEntity, orgA],
    );
    await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: false }, async (tx) => {
      await tx.execute(sql`
        insert into ref_alias (org_id, ref_id, alias, normalized)
        values (${orgA}, ${otherEntity}, '701', '701')
      `);
    });
    const n = await admin.query("select count(*)::int n from ref_alias where ref_id=$1", [otherEntity]);
    assert.equal(n.rows[0].n, 1, "same normalized on a different entity is allowed");
  });
});
