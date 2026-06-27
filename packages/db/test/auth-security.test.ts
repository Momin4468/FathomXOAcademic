import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { createPool, sql, withRlsTransaction } from "../src/client.js";
import { env } from "../src/env.js";

/**
 * Module 0 (auth + permission engine + audit) — DATABASE-LAYER security proofs.
 *
 * Mirrors rls.test.ts: fixtures are built via the admin/owner connection (bypasses
 * RLS); assertions run via the app role (`app_user`, RLS enforced). These pin the
 * security invariants that the Nest app *relies on* but that must hold at the DB
 * floor regardless of any app bug:
 *   1. app_auth_lookup() — the single sanctioned RLS bypass (narrow, owner-rights).
 *   2. auth_refresh_token — tenant-isolated; INSERT/UPDATE for rotation/revocation;
 *      no DELETE grant (sessions are revoked, never hard-deleted).
 *   3. is_superadmin (the leg-visibility break-glass GUC) — its EFFECT is the bypass;
 *      we prove only the superadmin context sees a non-owned leg (the app wires this
 *      GUC to System SuperAdmin only; see rls-context.ts + permission.service.ts).
 *   4. audit_log — append-only for the app role (extends rls.test.ts).
 */

const admin = new pg.Client({ connectionString: env.adminUrl });
const appPool = createPool(env.appUrl);

// Two orgs (tenant isolation on refresh tokens).
const orgA = randomUUID();
const orgB = randomUUID();

// Parties + a 2-leg chain in org A so we can prove the superadmin GUC bypass.
const partySource = randomUUID(); // top of chain
const partyMid = randomUUID();
const partyWriter = randomUUID();
const workItemA = randomUUID();
const legTop = randomUUID(); // seq 1: source -> mid  (writer NOT party => opaque)
const legBottom = randomUUID(); // seq 2: mid -> writer

// A user_account in each org (refresh tokens reference user_id).
const userA = randomUUID();
const userB = randomUUID();
const knownEmail = `lookup+${randomUUID()}@fathomxo.test`;

// Refresh-token rows.
const tokenA = randomUUID();
const tokenB = randomUUID();

before(async () => {
  await admin.connect();
  await admin.query("insert into org (id, name) values ($1,'Auth Org A'),($2,'Auth Org B')", [orgA, orgB]);
  await admin.query(
    `insert into party (id, org_id, display_name, party_type) values
       ($1,$4,'Source','{partner}'),($2,$4,'Mid','{partner}'),($3,$4,'Writer','{writer}')`,
    [partySource, partyMid, partyWriter, orgA],
  );
  await admin.query("insert into work_item (id, org_id, title) values ($1,$2,'Auth job')", [workItemA, orgA]);
  await admin.query(
    `insert into leg (id, org_id, work_item_id, seq, from_party_id, to_party_id, amount) values
       ($1,$6,$7,1,$3,$4,5000),
       ($2,$6,$7,2,$4,$5,3000)`,
    [legTop, legBottom, partySource, partyMid, partyWriter, orgA, workItemA],
  );
  // Users (one per org). userA has a known email for app_auth_lookup.
  await admin.query(
    `insert into user_account (id, org_id, email, password_hash, status, party_id) values
       ($1,$3,$5,'HASH_A','active',$6),
       ($2,$4,$7,'HASH_B','active',null)`,
    [userA, userB, orgA, orgB, knownEmail, partyWriter, `other+${randomUUID()}@fathomxo.test`],
  );
  // One refresh token per org (built via admin to seed; app role exercises RLS).
  await admin.query(
    `insert into auth_refresh_token (id, org_id, user_id, token_hash, expires_at) values
       ($1,$3,$5,'hash-a', now() + interval '10 days'),
       ($2,$4,$6,'hash-b', now() + interval '10 days')`,
    [tokenA, tokenB, orgA, orgB, userA, userB],
  );
});

after(async () => {
  await admin.query("delete from auth_refresh_token where org_id = any($1)", [[orgA, orgB]]);
  for (const org of [orgA, orgB]) {
    await admin.query("delete from leg where org_id=$1", [org]);
    await admin.query("delete from user_account where org_id=$1", [org]);
    await admin.query("delete from work_item where org_id=$1", [org]);
    await admin.query("delete from party where org_id=$1", [org]);
    await admin.query("delete from audit_log where org_id=$1", [org]);
    await admin.query("delete from org where id=$1", [org]);
  }
  await admin.end();
  await appPool.end();
});

describe("app_auth_lookup (the single sanctioned RLS bypass)", () => {
  it("returns the auth columns for a known email with NO org context set", async () => {
    // No GUCs — login happens before any tenant is known. The SECURITY DEFINER fn
    // runs with owner rights and must still resolve the row.
    const client = await appPool.connect();
    try {
      const res = await client.query(
        "select id, org_id, party_id, password_hash, status, twofa_secret from app_auth_lookup($1)",
        [knownEmail],
      );
      assert.equal(res.rows.length, 1, "exactly one row for the known email");
      const r = res.rows[0];
      assert.equal(r.id, userA);
      assert.equal(r.org_id, orgA);
      assert.equal(r.party_id, partyWriter);
      assert.equal(r.password_hash, "HASH_A");
      assert.equal(r.status, "active");
      assert.equal(r.twofa_secret, null);
    } finally {
      client.release();
    }
  });

  it("returns ZERO rows for an unknown email (no error, no leak)", async () => {
    const client = await appPool.connect();
    try {
      const res = await client.query("select * from app_auth_lookup($1)", [
        `nobody+${randomUUID()}@fathomxo.test`,
      ]);
      assert.equal(res.rows.length, 0);
    } finally {
      client.release();
    }
  });

  it("is case-insensitive on email (citext) — canonical-out", async () => {
    const client = await appPool.connect();
    try {
      const res = await client.query("select id from app_auth_lookup($1)", [knownEmail.toUpperCase()]);
      assert.equal(res.rows.length, 1);
      assert.equal(res.rows[0].id, userA);
    } finally {
      client.release();
    }
  });

  it("EXECUTE is granted to app_user but NOT to PUBLIC", async () => {
    const res = await admin.query(
      `select has_function_privilege('public','app_auth_lookup(citext)','execute') as public_exec,
              has_function_privilege('app_user','app_auth_lookup(citext)','execute') as app_exec`,
    );
    assert.equal(res.rows[0].public_exec, false, "PUBLIC must NOT be able to call the bypass fn");
    assert.equal(res.rows[0].app_exec, true, "app_user must be able to call it (login path)");
  });

  it("does NOT bypass tenant scoping for ordinary SELECTs (the bypass is narrow)", async () => {
    // Direct SELECT on user_account under org B context cannot see org A's user,
    // even though app_auth_lookup could resolve it. Proves the bypass is the fn only.
    const count = await withRlsTransaction(
      appPool,
      { orgId: orgB, partyId: null, isSuperadmin: false },
      async (tx) => {
        const res = await tx.execute(sql`select count(*)::int as n from user_account where id = ${userA}`);
        return (res.rows[0] as { n: number }).n;
      },
    );
    assert.equal(count, 0, "org A's user must be invisible to a direct query under org B");
  });
});

describe("auth_refresh_token RLS + privilege tiering", () => {
  it("is tenant-isolated: org A context cannot see org B's token", async () => {
    const n = await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: false }, async (tx) => {
      const res = await tx.execute(sql`select count(*)::int as n from auth_refresh_token where id = ${tokenB}`);
      return (res.rows[0] as { n: number }).n;
    });
    assert.equal(n, 0, "org B's refresh token must be invisible under org A context");
  });

  it("even a superadmin context cannot cross the tenant boundary", async () => {
    const n = await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
      const res = await tx.execute(sql`select count(*)::int as n from auth_refresh_token where id = ${tokenB}`);
      return (res.rows[0] as { n: number }).n;
    });
    assert.equal(n, 0, "tenant isolation is not overridden by the leg break-glass");
  });

  it("the app role MAY UPDATE a token (rotation/revocation = set revoked_at)", async () => {
    await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: false }, async (tx) => {
      await tx.execute(sql`update auth_refresh_token set revoked_at = now() where id = ${tokenA}`);
    });
    const revoked = await withRlsTransaction(
      appPool,
      { orgId: orgA, partyId: null, isSuperadmin: false },
      async (tx) => {
        const res = await tx.execute(sql`select revoked_at from auth_refresh_token where id = ${tokenA}`);
        return (res.rows[0] as { revoked_at: Date | null }).revoked_at;
      },
    );
    assert.ok(revoked !== null, "revoked_at should be set (server-side revocation works)");
    // reset for independence
    await admin.query("update auth_refresh_token set revoked_at = null where id = $1", [tokenA]);
  });

  it("the app role may NOT DELETE a token (sessions are revoked, never hard-deleted)", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: false }, async (tx) => {
        await tx.execute(sql`delete from auth_refresh_token where id = ${tokenA}`);
      }),
      /permission denied/i,
      "DELETE on auth_refresh_token must be denied to app_user",
    );
  });
});

describe("is_superadmin GUC drives the leg-visibility bypass (spec §4.4)", () => {
  // The app sets this GUC true ONLY for System SuperAdmin (rls-context.ts reads
  // principal.isSystemSuperadmin, computed from roles at login). Here we prove the
  // GUC's EFFECT: with it false, a non-party sees nothing; with it true, the whole chain.
  it("a non-party WITHOUT superadmin sees only legs they are on", async () => {
    const seqs = await withRlsTransaction(
      appPool,
      { orgId: orgA, partyId: partyWriter, isSuperadmin: false },
      async (tx) => {
        const res = await tx.execute(sql`select seq from leg where work_item_id = ${workItemA} order by seq`);
        return (res.rows as Array<{ seq: number }>).map((r) => Number(r.seq));
      },
    );
    assert.deepEqual(seqs, [2], "writer is only on leg 2; the top leg (true price) is opaque");
  });

  it("WITH superadmin the same context sees the whole chain (bypass active)", async () => {
    const seqs = await withRlsTransaction(
      appPool,
      { orgId: orgA, partyId: null, isSuperadmin: true },
      async (tx) => {
        const res = await tx.execute(sql`select seq from leg where work_item_id = ${workItemA} order by seq`);
        return (res.rows as Array<{ seq: number }>).map((r) => Number(r.seq));
      },
    );
    assert.deepEqual(seqs, [1, 2], "superadmin GUC bypasses leg-membership");
  });

  it("app_is_superadmin() reflects the GUC, defaults false when unset", async () => {
    const def = await withRlsTransaction(
      appPool,
      { orgId: orgA, partyId: partyWriter, isSuperadmin: false },
      async (tx) => {
        const res = await tx.execute(sql`select app_is_superadmin() as s`);
        return (res.rows[0] as { s: boolean }).s;
      },
    );
    assert.equal(def, false);
  });
});

describe("audit_log append-only for the app role (extends rls.test.ts)", () => {
  it("allows INSERT but rejects DELETE", async () => {
    await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: false }, async (tx) => {
      await tx.execute(
        sql`insert into audit_log (org_id, action, entity) values (${orgA}, 'auth.test', 'user_account')`,
      );
    });
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: false }, async (tx) => {
        await tx.execute(sql`delete from audit_log where org_id = ${orgA}`);
      }),
      /permission denied/i,
      "audit_log must be immutable (no DELETE) — even SuperAdmin cannot erase",
    );
  });
});
