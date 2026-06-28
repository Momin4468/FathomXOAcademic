import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { createPool, sql, withRlsTransaction } from "../src/client.js";
import { env } from "../src/env.js";

/**
 * Module 8 — DATABASE-level proofs for the credential vault (CLAUDE.md §3/§4,
 * SCHEMA §8 + migration 0018). Fixtures built via the admin/superuser connection
 * (bypasses RLS + grants); assertions run via the app role (RLS + grants
 * ENFORCED). Mirrors billing-rls.test.ts conventions.
 *
 * Proves:
 *   • per-item ACL: a party sees ONLY items shared with them via an ACTIVE
 *     credential_share; a non-holder gets ZERO rows (not an error), exactly like
 *     legs. System SuperAdmin sees all; other-org context sees none.
 *   • revoking a share immediately removes visibility.
 *   • the partial-unique index: one ACTIVE share per (item, party); re-grant
 *     after revoke is allowed.
 *   • grants: app role may UPDATE items but NOT DELETE items or shares
 *     (mutable-but-undeletable; shares revoke, items archive).
 */

const admin = new pg.Client({ connectionString: env.adminUrl });
const appPool = createPool(env.appUrl);

const orgA = randomUUID();
const orgB = randomUUID();
const writerA = randomUUID();
const writerB = randomUUID();
const writerC = randomUUID(); // a third party with NO shares
const partyB = randomUUID(); // org B party

const item1 = randomUUID();
const item2 = randomUUID();
const item3 = randomUUID();
const itemB = randomUUID(); // an org-B item (tenant isolation)

// dummy ciphertext fields (this layer never decrypts; only ACL/grants matter)
const DUMMY = ["iv-dummy", "tag-dummy", "ct-dummy"] as const;

async function insertItem(id: string, org: string, name: string) {
  await admin.query(
    `insert into credential_vault_item
       (id, org_id, name, type, secret_iv, secret_tag, secret_ciphertext)
     values ($1,$2,$3,'tool',$4,$5,$6)`,
    [id, org, name, DUMMY[0], DUMMY[1], DUMMY[2]],
  );
}

async function insertShare(id: string, org: string, credId: string, partyId: string) {
  await admin.query(
    "insert into credential_share (id, org_id, credential_id, party_id) values ($1,$2,$3,$4)",
    [id, org, credId, partyId],
  );
}

// keep share ids we may need to revoke
const shareA1 = randomUUID();
const shareA2 = randomUUID();
const shareB2 = randomUUID();
const shareB3 = randomUUID();

before(async () => {
  await admin.connect();
  await admin.query("insert into org (id, name) values ($1,'M8 Org A'),($2,'M8 Org B')", [orgA, orgB]);
  await admin.query(
    `insert into party (id, org_id, display_name, party_type) values
       ($1,$5,'WriterA','{writer}'),($2,$5,'WriterB','{writer}'),($3,$5,'WriterC','{writer}'),($4,$6,'PartyB','{writer}')`,
    [writerA, writerB, writerC, partyB, orgA, orgB],
  );

  await insertItem(item1, orgA, "M8 Item 1");
  await insertItem(item2, orgA, "M8 Item 2");
  await insertItem(item3, orgA, "M8 Item 3");
  await insertItem(itemB, orgB, "M8 Item B");

  // writerA → item1, item2 ; writerB → item2, item3
  await insertShare(shareA1, orgA, item1, writerA);
  await insertShare(shareA2, orgA, item2, writerA);
  await insertShare(shareB2, orgA, item2, writerB);
  await insertShare(shareB3, orgA, item3, writerB);
});

after(async () => {
  for (const org of [orgA, orgB]) {
    await admin.query("delete from credential_share where org_id=$1", [org]);
    await admin.query("delete from credential_vault_item where org_id=$1", [org]);
    await admin.query("delete from party where org_id=$1", [org]);
    await admin.query("delete from org where id=$1", [org]);
  }
  await admin.end();
  await appPool.end();
});

// ─── Per-item ACL (the crux — like leg visibility) ───────────────────────────

async function itemIdsVisibleTo(
  org: string,
  partyId: string | null,
  isSuperadmin: boolean,
): Promise<string[]> {
  return withRlsTransaction(appPool, { orgId: org, partyId, isSuperadmin }, async (tx) => {
    const res = await tx.execute(
      sql`select id from credential_vault_item where id in (${item1}, ${item2}, ${item3}) order by name`,
    );
    return (res.rows as Array<{ id: string }>).map((r) => r.id);
  });
}

describe("🔴 credential per-item ACL — a holder sees ONLY their shared items", () => {
  it("WriterA sees exactly {item1, item2}", async () => {
    const ids = await itemIdsVisibleTo(orgA, writerA, false);
    assert.deepEqual(new Set(ids), new Set([item1, item2]));
  });

  it("WriterA does NOT see item3 (zero rows for it, not an error)", async () => {
    const ids = await itemIdsVisibleTo(orgA, writerA, false);
    assert.ok(!ids.includes(item3), "a non-shared item must be invisible to WriterA");
  });

  it("WriterB sees exactly {item2, item3}", async () => {
    const ids = await itemIdsVisibleTo(orgA, writerB, false);
    assert.deepEqual(new Set(ids), new Set([item2, item3]));
  });

  it("WriterC (no shares) sees ZERO items (not an error)", async () => {
    assert.deepEqual(await itemIdsVisibleTo(orgA, writerC, false), []);
  });

  it("System SuperAdmin sees all 3 items", async () => {
    const ids = await itemIdsVisibleTo(orgA, null, true);
    assert.deepEqual(new Set(ids), new Set([item1, item2, item3]));
  });

  it("tenant isolation: org A context cannot see org B's item (even as SuperAdmin)", async () => {
    const n = await withRlsTransaction(
      appPool,
      { orgId: orgA, partyId: null, isSuperadmin: true },
      async (tx) => {
        const res = await tx.execute(sql`select count(*)::int as n from credential_vault_item where id = ${itemB}`);
        return (res.rows[0] as { n: number }).n;
      },
    );
    assert.equal(n, 0, "org B's vault item must be invisible under org A context");
  });

  it("a holder in org A context cannot read across to org B (zero rows)", async () => {
    // Even though writerB legitimately holds shares in org A, an org-B item is unreachable.
    const ids = await withRlsTransaction(
      appPool,
      { orgId: orgB, partyId: writerB, isSuperadmin: false },
      async (tx) => {
        const res = await tx.execute(sql`select id from credential_vault_item where id = ${item2}`);
        return (res.rows as Array<{ id: string }>).map((r) => r.id);
      },
    );
    assert.deepEqual(ids, [], "an org A item must be invisible under org B context");
  });
});

// ─── Revocation immediately removes visibility ───────────────────────────────

describe("revocation removes visibility", () => {
  it("after revoking WriterA's share to item2, WriterA sees only {item1}", async () => {
    await admin.query(
      "update credential_share set revoked_at = now() where id = $1",
      [shareA2],
    );
    try {
      const ids = await itemIdsVisibleTo(orgA, writerA, false);
      assert.deepEqual(new Set(ids), new Set([item1]), "the revoked item must drop out");
      assert.ok(!ids.includes(item2), "item2 is no longer visible to WriterA");
    } finally {
      // restore for independence of later assertions (none depend on it, but keep clean)
      await admin.query("update credential_share set revoked_at = null where id = $1", [shareA2]);
    }
  });
});

// ─── credential_share partial-unique (one ACTIVE share per item,party) ───────

describe("credential_share partial-unique index", () => {
  it("🔴 a SECOND active share for the same (item, party) is rejected", async () => {
    await assert.rejects(
      admin.query(
        "insert into credential_share (id, org_id, credential_id, party_id) values ($1,$2,$3,$4)",
        [randomUUID(), orgA, item1, writerA], // shareA1 already active
      ),
      /duplicate key|unique/i,
      "two active shares for (item1, writerA) must violate the partial-unique index",
    );
  });

  it("re-granting AFTER the prior share is revoked succeeds", async () => {
    const tmp = randomUUID();
    const newShare = randomUUID();
    // a fresh active share, revoke it, then re-grant — both inserts succeed.
    await insertShare(tmp, orgA, item1, writerC);
    await admin.query("update credential_share set revoked_at = now() where id = $1", [tmp]);
    await admin.query(
      "insert into credential_share (id, org_id, credential_id, party_id) values ($1,$2,$3,$4)",
      [newShare, orgA, item1, writerC],
    );
    // verify exactly one ACTIVE share for (item1, writerC)
    const r = await admin.query(
      "select count(*)::int n from credential_share where credential_id=$1 and party_id=$2 and revoked_at is null",
      [item1, writerC],
    );
    assert.equal(r.rows[0].n, 1, "exactly one active share after re-grant");
    await admin.query("delete from credential_share where id in ($1,$2)", [tmp, newShare]);
  });
});

// ─── Grants: mutable-but-undeletable for the app role ────────────────────────

describe("app-role grants — items update, never delete; shares never delete", () => {
  it("ALLOWS UPDATE on credential_vault_item (archive / rotate / rename)", async () => {
    await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
      await tx.execute(sql`update credential_vault_item set name = 'M8 Item 1 (renamed)' where id = ${item1}`);
    });
    // restore
    await admin.query("update credential_vault_item set name='M8 Item 1' where id=$1", [item1]);
  });

  it("🔴 rejects DELETE on credential_vault_item", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
        await tx.execute(sql`delete from credential_vault_item where id = ${item1}`);
      }),
      /permission denied/i,
      "vault items must not be deletable by the app role (archive instead)",
    );
  });

  it("🔴 rejects DELETE on credential_share", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
        await tx.execute(sql`delete from credential_share where id = ${shareA1}`);
      }),
      /permission denied/i,
      "shares must not be deletable by the app role (revoke instead)",
    );
  });
});
