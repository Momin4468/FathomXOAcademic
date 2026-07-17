import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { createPool, sql, withRlsTransaction } from "../src/client.js";
import { env } from "../src/env.js";

/**
 * 0051 — DATABASE-level proofs for multi-admin ROW privacy (DECISIONS 2026-07-17,
 * CLAUDE.md §3). Two admins (Emon, Momin) share ONE org but run separate books of
 * business. Fixtures via the admin/superuser connection (bypasses RLS); assertions
 * via the app role (RLS ENFORCED). Mirrors credential-vault-rls.test.ts.
 *
 * Proves:
 *   • client roster is private: an admin sees ONLY their own clients + unowned
 *     (shared) ones — never another admin's client. SuperAdmin sees all.
 *   • non-client parties stay org-wide (name-resolution/pickers keep working).
 *   • a client sees its OWN party row (id = current party).
 *   • work_item is private to owner / parties-on-it / grantees; a non-owner,
 *     non-party admin does NOT see it; a party ON the job (doer) does.
 *   • a roster_grant makes a private client/job visible to the grantee, and
 *     revoking it removes visibility again.
 *   • roster_grant is append-only for the app role (SELECT + INSERT only — no
 *     UPDATE/DELETE), so a grantee can never un-revoke themselves; revocation is
 *     an admin/definer path. Money tables (invoice/line/payment/allocation) are
 *     scoped to the client's OWNER — a peer admin reads zero of another's price.
 */

const admin = new pg.Client({ connectionString: env.adminUrl });
const appPool = createPool(env.appUrl);

const orgA = randomUUID();
const emon = randomUUID(); // admin/partner A
const momin = randomUUID(); // admin/partner B
const writerX = randomUUID(); // a plain writer (non-client → org-wide)
const clientOfEmon = randomUUID();
const clientOfMomin = randomUUID();
const clientUnowned = randomUUID(); // legacy/shared client (owner null)

const jobOfEmon = randomUUID(); // owned by Emon, only Emon on it
const jobOfMomin = randomUUID(); // owned by Momin
const jobWithDoer = randomUUID(); // owned by Emon, doer = writerX

const grantJob = randomUUID();
const grantClient = randomUUID();

// Billing fixtures for Emon's client (the client price must not leak).
const wlOfEmon = randomUUID();
const invOfEmon = randomUUID();
const invLineOfEmon = randomUUID();
const payInOfEmon = randomUUID();
const allocOfEmon = randomUUID();
// A MULTI-HAT {client,writer} owned by Emon — visible for name-resolution, but its PRICE must stay private.
const colleagueClient = randomUUID();
const wlColleague = randomUUID();
const invOfColleague = randomUUID();
const invLineColleague = randomUUID();

async function insertJob(id: string, owner: string, opts: { doer?: string; client?: string } = {}) {
  await admin.query(
    `insert into work_item (id, org_id, title, owner_party_id, doer_party_id, client_party_id)
     values ($1,$2,$3,$4,$5,$6)`,
    [id, orgA, `Job ${id.slice(0, 6)}`, owner, opts.doer ?? null, opts.client ?? null],
  );
}

before(async () => {
  await admin.connect();
  await admin.query("insert into org (id, name) values ($1,'0051 Org A')", [orgA]);
  await admin.query(
    `insert into party (id, org_id, display_name, party_type, owner_party_id) values
       ($1,$7,'Emon','{partner,writer}',null),
       ($2,$7,'Momin','{partner,writer}',null),
       ($3,$7,'WriterX','{writer}',null),
       ($4,$7,'Client of Emon','{client}',$1),
       ($5,$7,'Client of Momin','{client}',$2),
       ($6,$7,'Unowned Client','{client}',null)`,
    [emon, momin, writerX, clientOfEmon, clientOfMomin, clientUnowned, orgA],
  );
  await insertJob(jobOfEmon, emon);
  await insertJob(jobOfMomin, momin);
  await insertJob(jobWithDoer, emon, { doer: writerX });

  // An invoiced line on Emon's client (the real client price = 6000).
  await admin.query(
    `insert into work_line (id, org_id, work_item_id, line_kind, consumer_party_id) values ($1,$2,$3,'copy',$4)`,
    [wlOfEmon, orgA, jobOfEmon, clientOfEmon],
  );
  await admin.query(
    `insert into invoice (id, org_id, client_party_id, status) values ($1,$2,$3,'open')`,
    [invOfEmon, orgA, clientOfEmon],
  );
  await admin.query(
    `insert into invoice_line (id, org_id, invoice_id, work_line_id, amount) values ($1,$2,$3,$4,'6000')`,
    [invLineOfEmon, orgA, invOfEmon, wlOfEmon],
  );
  // A client 'in' payment + its allocation (revenue for Emon's client).
  await admin.query(
    `insert into payment (id, org_id, direction, counterparty_party_id, amount, paid_at) values ($1,$2,'in',$3,'6000',current_date)`,
    [payInOfEmon, orgA, clientOfEmon],
  );
  await admin.query(
    `insert into payment_allocation (id, org_id, payment_id, invoice_line_id, amount) values ($1,$2,$3,$4,'6000')`,
    [allocOfEmon, orgA, payInOfEmon, invLineOfEmon],
  );
  // A multi-hat {client,writer} owned by Emon + its own invoiced price.
  await admin.query(
    `insert into party (id, org_id, display_name, party_type, owner_party_id) values ($1,$2,'Colleague Client','{client,writer}',$3)`,
    [colleagueClient, orgA, emon],
  );
  await admin.query(
    `insert into work_line (id, org_id, work_item_id, line_kind, consumer_party_id) values ($1,$2,$3,'copy',$4)`,
    [wlColleague, orgA, jobOfEmon, colleagueClient],
  );
  await admin.query(`insert into invoice (id, org_id, client_party_id, status) values ($1,$2,$3,'open')`, [invOfColleague, orgA, colleagueClient]);
  await admin.query(
    `insert into invoice_line (id, org_id, invoice_id, work_line_id, amount) values ($1,$2,$3,$4,'7000')`,
    [invLineColleague, orgA, invOfColleague, wlColleague],
  );
});

after(async () => {
  await admin.query("delete from roster_grant where org_id=$1", [orgA]);
  await admin.query("delete from payment_allocation where org_id=$1", [orgA]);
  await admin.query("delete from payment where org_id=$1", [orgA]);
  await admin.query("delete from invoice_line where org_id=$1", [orgA]);
  await admin.query("delete from invoice where org_id=$1", [orgA]);
  await admin.query("delete from work_line where org_id=$1", [orgA]);
  await admin.query("delete from work_item where org_id=$1", [orgA]);
  await admin.query("delete from party where org_id=$1", [orgA]);
  await admin.query("delete from org where id=$1", [orgA]);
  await admin.end();
  await appPool.end();
});

async function clientsVisibleTo(partyId: string | null, isSuperadmin: boolean): Promise<Set<string>> {
  const rows = await withRlsTransaction(appPool, { orgId: orgA, partyId, isSuperadmin }, async (tx) => {
    const res = await tx.execute(
      sql`select id from party where id in (${clientOfEmon}, ${clientOfMomin}, ${clientUnowned})`,
    );
    return res.rows as Array<{ id: string }>;
  });
  return new Set(rows.map((r) => r.id));
}

async function jobsVisibleTo(partyId: string | null, isSuperadmin: boolean): Promise<Set<string>> {
  const rows = await withRlsTransaction(appPool, { orgId: orgA, partyId, isSuperadmin }, async (tx) => {
    const res = await tx.execute(
      sql`select id from work_item where id in (${jobOfEmon}, ${jobOfMomin}, ${jobWithDoer})`,
    );
    return res.rows as Array<{ id: string }>;
  });
  return new Set(rows.map((r) => r.id));
}

// ─── Client roster is private ────────────────────────────────────────────────
describe("🔴 client roster privacy — an admin sees only their own + unowned clients", () => {
  it("Emon sees his client + the unowned one, NOT Momin's", async () => {
    const ids = await clientsVisibleTo(emon, false);
    assert.deepEqual(ids, new Set([clientOfEmon, clientUnowned]));
    assert.ok(!ids.has(clientOfMomin), "Emon must NOT see Momin's client");
  });

  it("Momin sees his client + the unowned one, NOT Emon's", async () => {
    const ids = await clientsVisibleTo(momin, false);
    assert.deepEqual(ids, new Set([clientOfMomin, clientUnowned]));
    assert.ok(!ids.has(clientOfEmon), "Momin must NOT see Emon's client");
  });

  it("System SuperAdmin sees all three clients", async () => {
    const ids = await clientsVisibleTo(null, true);
    assert.deepEqual(ids, new Set([clientOfEmon, clientOfMomin, clientUnowned]));
  });

  it("a client sees its OWN party row (portal self-view)", async () => {
    const ids = await withRlsTransaction(appPool, { orgId: orgA, partyId: clientOfEmon, isSuperadmin: false }, async (tx) => {
      const res = await tx.execute(sql`select id from party where id = ${clientOfEmon}`);
      return (res.rows as Array<{ id: string }>).map((r) => r.id);
    });
    assert.deepEqual(ids, [clientOfEmon], "a client must see its own record even though Emon owns it");
  });
});

// ─── Non-client parties stay org-wide (name resolution / pickers) ────────────
describe("non-client parties are org-wide (so joins + pickers work)", () => {
  it("Momin CAN see Emon (a partner) and WriterX (a writer)", async () => {
    const n = await withRlsTransaction(appPool, { orgId: orgA, partyId: momin, isSuperadmin: false }, async (tx) => {
      const res = await tx.execute(sql`select count(*)::int as n from party where id in (${emon}, ${writerX})`);
      return (res.rows[0] as { n: number }).n;
    });
    assert.equal(n, 2, "non-client parties must remain visible to any admin in the org");
  });
});

// ─── Work-item privacy ───────────────────────────────────────────────────────
describe("🔴 work_item privacy — owner / on-the-job / grantee only", () => {
  it("Emon sees his own jobs, NOT Momin's", async () => {
    const ids = await jobsVisibleTo(emon, false);
    assert.ok(ids.has(jobOfEmon) && ids.has(jobWithDoer), "Emon sees his own jobs");
    assert.ok(!ids.has(jobOfMomin), "Emon must NOT see Momin's job");
  });

  it("Momin does NOT see Emon's private job", async () => {
    const ids = await jobsVisibleTo(momin, false);
    assert.ok(!ids.has(jobOfEmon), "Momin must NOT see Emon's ungranted job");
    assert.ok(ids.has(jobOfMomin), "Momin sees his own job");
  });

  it("a party ON the job (WriterX = doer) sees it without owning it", async () => {
    const ids = await jobsVisibleTo(writerX, false);
    assert.ok(ids.has(jobWithDoer), "the doer must see the job they are on");
    assert.ok(!ids.has(jobOfMomin), "but not an unrelated job");
  });

  it("SuperAdmin sees all jobs", async () => {
    const ids = await jobsVisibleTo(null, true);
    assert.deepEqual(ids, new Set([jobOfEmon, jobOfMomin, jobWithDoer]));
  });
});

// ─── Money privacy — the client PRICE must not leak to a peer admin ──────────
async function invoiceLinesVisibleTo(partyId: string | null, isSuperadmin: boolean): Promise<number> {
  return withRlsTransaction(appPool, { orgId: orgA, partyId, isSuperadmin }, async (tx) => {
    const res = await tx.execute(sql`select id from invoice_line where id = ${invLineOfEmon}`);
    return (res.rows as unknown[]).length;
  });
}

describe("🔴 money privacy — a peer admin cannot read another admin's client price", () => {
  it("Momin reads ZERO of Emon's client's invoice lines (the real price is hidden)", async () => {
    assert.equal(await invoiceLinesVisibleTo(momin, false), 0, "the client price must not reach a non-owner admin");
  });

  it("Emon (the owner) reads his own client's invoice line", async () => {
    assert.equal(await invoiceLinesVisibleTo(emon, false), 1);
  });

  it("System SuperAdmin reads it", async () => {
    assert.equal(await invoiceLinesVisibleTo(null, true), 1);
  });

  it("after granting the client to Momin, Momin CAN read the invoice line; revoke hides it again", async () => {
    const g = randomUUID();
    await admin.query(
      `insert into roster_grant (id, org_id, subject_type, subject_id, party_id) values ($1,$2,'party',$3,$4)`,
      [g, orgA, clientOfEmon, momin],
    );
    try {
      assert.equal(await invoiceLinesVisibleTo(momin, false), 1, "granted client → its invoice line is visible");
    } finally {
      await admin.query("update roster_grant set revoked_at = now() where id = $1", [g]);
    }
    assert.equal(await invoiceLinesVisibleTo(momin, false), 0, "revoked → invoice line hidden again");
  });

  it("Momin reads ZERO of Emon's client 'in' payment + its allocation (owner sees both)", async () => {
    const count = (partyId: string | null, isSuperadmin: boolean, table: "payment" | "payment_allocation", id: string) =>
      withRlsTransaction(appPool, { orgId: orgA, partyId, isSuperadmin }, async (tx) => {
        const res = await tx.execute(sql`select 1 from ${sql.raw(table)} where id = ${id}`);
        return (res.rows as unknown[]).length;
      });
    assert.equal(await count(momin, false, "payment", payInOfEmon), 0, "peer admin must not see the client 'in' payment amount");
    assert.equal(await count(momin, false, "payment_allocation", allocOfEmon), 0, "nor its allocation");
    assert.equal(await count(emon, false, "payment", payInOfEmon), 1, "the owner sees the payment");
    assert.equal(await count(emon, false, "payment_allocation", allocOfEmon), 1, "and the allocation");
    assert.equal(await count(null, true, "payment", payInOfEmon), 1, "SuperAdmin sees the payment");
  });

  it("MULTI-HAT: Momin can see a {client,writer} party (name) but reads ZERO of its invoice line (price stays private)", async () => {
    const seesParty = await withRlsTransaction(appPool, { orgId: orgA, partyId: momin, isSuperadmin: false }, async (tx) => {
      const res = await tx.execute(sql`select 1 from party where id = ${colleagueClient}`);
      return (res.rows as unknown[]).length;
    });
    assert.equal(seesParty, 1, "a multi-hat colleague-client stays visible for name-resolution/pickers");
    const seesPrice = await withRlsTransaction(appPool, { orgId: orgA, partyId: momin, isSuperadmin: false }, async (tx) => {
      const res = await tx.execute(sql`select 1 from invoice_line where id = ${invLineColleague}`);
      return (res.rows as unknown[]).length;
    });
    assert.equal(seesPrice, 0, "but its client PRICE must NOT leak to a peer admin (owner-scoped money policy)");
  });
});

// ─── Grant shares a private row; revoke removes it ───────────────────────────
describe("roster_grant shares a private client/job, and revoke removes it", () => {
  it("granting Emon's job + client to Momin makes them visible; revoke hides them", async () => {
    await admin.query(
      `insert into roster_grant (id, org_id, subject_type, subject_id, party_id, reason) values
         ($1,$5,'work_item',$2,$6,'handoff'),
         ($3,$5,'party',$4,$6,'handoff')`,
      [grantJob, jobOfEmon, grantClient, clientOfEmon, orgA, momin],
    );
    try {
      assert.ok((await jobsVisibleTo(momin, false)).has(jobOfEmon), "granted job is now visible to Momin");
      assert.ok((await clientsVisibleTo(momin, false)).has(clientOfEmon), "granted client is now visible to Momin");
    } finally {
      await admin.query("update roster_grant set revoked_at = now() where id in ($1,$2)", [grantJob, grantClient]);
    }
    assert.ok(!(await jobsVisibleTo(momin, false)).has(jobOfEmon), "revoked → job hidden again");
    assert.ok(!(await clientsVisibleTo(momin, false)).has(clientOfEmon), "revoked → client hidden again");
  });

  it("🔴 the partial-unique index rejects a SECOND active grant for the same (subject, party)", async () => {
    const g = randomUUID();
    await admin.query(
      `insert into roster_grant (id, org_id, subject_type, subject_id, party_id) values ($1,$2,'work_item',$3,$4)`,
      [g, orgA, jobOfMomin, emon],
    );
    await assert.rejects(
      admin.query(
        `insert into roster_grant (id, org_id, subject_type, subject_id, party_id) values ($1,$2,'work_item',$3,$4)`,
        [randomUUID(), orgA, jobOfMomin, emon],
      ),
      /duplicate key|unique/i,
      "two active grants for the same (subject, party) must violate the partial-unique index",
    );
    await admin.query("delete from roster_grant where id=$1", [g]);
  });
});

// ─── Append-only: the app role may INSERT + SELECT grants, never UPDATE/DELETE ─
describe("app-role grants — roster_grant is append-only (no update/delete)", () => {
  it("🔴 rejects DELETE on roster_grant by the app role", async () => {
    const g = randomUUID();
    await admin.query(
      `insert into roster_grant (id, org_id, subject_type, subject_id, party_id) values ($1,$2,'party',$3,$4)`,
      [g, orgA, clientUnowned, momin],
    );
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: momin, isSuperadmin: false }, async (tx) => {
        await tx.execute(sql`delete from roster_grant where id = ${g}`);
      }),
      /permission denied/i,
      "roster grants must not be deletable by the app role",
    );
    await admin.query("delete from roster_grant where id=$1", [g]);
  });

  it("🔴 rejects UPDATE — a grantee cannot un-revoke their own grant", async () => {
    const g = randomUUID();
    await admin.query(
      `insert into roster_grant (id, org_id, subject_type, subject_id, party_id, revoked_at) values ($1,$2,'party',$3,$4, now())`,
      [g, orgA, clientUnowned, momin],
    );
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: momin, isSuperadmin: false }, async (tx) => {
        await tx.execute(sql`update roster_grant set revoked_at = null where id = ${g}`);
      }),
      /permission denied/i,
      "a grantee must not be able to un-revoke themselves (no app-role UPDATE)",
    );
    await admin.query("delete from roster_grant where id=$1", [g]);
  });
});
