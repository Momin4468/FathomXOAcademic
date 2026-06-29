import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { createPool, sql, withRlsTransaction } from "../src/client.js";
import { env } from "../src/env.js";

/**
 * Client portal (0033) — the THIRD scoped identity plane. DATABASE-level proofs.
 * Fixtures built via the admin/superuser connection (bypasses RLS); assertions run
 * via the app role through withRlsTransaction (RLS + SECURITY DEFINER caller-guards
 * ENFORCED). Mirrors settlement.test.ts / billing-rls.test.ts conventions.
 *
 * The CRITICAL guarantee proved here: a client reads ONLY their own status +
 * consumer-side amounts through the caller-guarded definers — NEVER the writer
 * cost (3000), the margin, or any leg they are not a party to (leg_visibility RLS).
 *
 * Chain (Client A → Momin 6000 → Writer 3000): client A's true bill is 6000 and
 * the writer cost 3000 is the figure that must never reach the client.
 */

const admin = new pg.Client({ connectionString: env.adminUrl });
const appPool = createPool(env.appUrl);

const orgA = randomUUID();
const orgB = randomUUID();

const clientA = randomUUID(); // the source client (top of chain)
const clientB = randomUUID(); // a SECOND, unrelated client (cross-client opacity)
const momin = randomUUID(); // intermediary
const writer = randomUUID();

const workItemA = randomUUID(); // clientA's confirmed job
const workLineA = randomUUID();
const legClientMomin = randomUUID(); // seq 1 — client A pays 6000 (client A IS a party here)
const legMominWriter = randomUUID(); // seq 2 — writer cost 3000 (client A is NOT a party)
const invoiceA = randomUUID();
const invoiceLineA = randomUUID();
const paymentInA = randomUUID();
const allocA = randomUUID();

const clientAcctA = randomUUID();
const clientAcctB = randomUUID();
const msgFromClientA = randomUUID();
const msgFromAdminA = randomUUID();

// Lead-promotion fixtures (each client_account needs its OWN party — party_id is unique)
const leadPromote = randomUUID(); // becomes active on confirm
const leadPromoteParty = randomUUID();
const leadPromoteJob = randomUUID();
// Purge fixtures
const leadPurge = randomUUID(); // expired, no confirmed job → purged
const leadPurgeParty = randomUUID();
const leadPurgeJob = randomUUID();
const leadPurgeMsg = randomUUID();
const leadKept = randomUUID(); // expired BUT has a confirmed job → kept
const leadKeptParty = randomUUID();
const leadKeptJob = randomUUID();
const acctActive = randomUUID(); // active (never a lead) → kept
const acctActiveParty = randomUUID();

// org B (tenant isolation)
const clientBOther = randomUUID(); // a party in org B
const acctOrgB = randomUUID();
const msgOrgB = randomUUID();

// A real bcrypt hash isn't needed for DB-level reads; login_id + status are what
// the definers read. Use a placeholder non-null hash.
const HASH = "$2a$10$placeholderplaceholderplaceholderplaceholderplaceholderxx";

// login_id is GLOBALLY unique — make every test login run-unique so a prior aborted
// run can't collide.
const SFX = randomUUID().slice(0, 8);
const lid = (name: string) => `${name}+${SFX}@cp.test`;

before(async () => {
  await admin.connect();
  await admin.query("insert into org (id, name) values ($1,'CP Org A'),($2,'CP Org B')", [orgA, orgB]);

  await admin.query(
    `insert into party (id, org_id, display_name, party_type) values
       ($1,$5,'Client A','{client}'),($2,$5,'Client B','{client}'),
       ($3,$5,'Momin','{partner}'),($4,$5,'Writer','{writer}')`,
    [clientA, clientB, momin, writer, orgA],
  );
  await admin.query("insert into party (id, org_id, display_name, party_type) values ($1,$2,'OrgB Client','{client}')", [clientBOther, orgB]);

  // Dedicated client parties for the lead/purge fixtures (party_id is unique per account).
  await admin.query(
    `insert into party (id, org_id, display_name, party_type) values
       ($1,$5,'Lead Promote','{client}'),($2,$5,'Lead Purge','{client}'),
       ($3,$5,'Lead Kept','{client}'),($4,$5,'Active Client','{client}')`,
    [leadPromoteParty, leadPurgeParty, leadKeptParty, acctActiveParty, orgA],
  );

  // Client A's confirmed job, with a consumer work_line + the full chain legs.
  await admin.query("insert into work_item (id, org_id, title, source_party_id, work_state, money_state) values ($1,$2,'Client A job',$3,'confirmed','partial')", [workItemA, orgA, clientA]);
  await admin.query(
    "insert into work_line (id, org_id, work_item_id, line_kind, consumer_party_id, client_rate, unit_count) values ($1,$2,$3,'copy',$4,6000,1)",
    [workLineA, orgA, workItemA, clientA],
  );
  await admin.query(
    `insert into leg (id, org_id, work_item_id, work_line_id, seq, from_party_id, to_party_id, amount) values
       ($1,$6,$7,$8,1,$3,$4,6000),
       ($2,$6,$7,$8,2,$4,$5,3000)`,
    [legClientMomin, legMominWriter, clientA, momin, writer, orgA, workItemA, workLineA],
  );

  // Invoice clientA: billed 6000, paid 4000 (partial allocation).
  await admin.query("insert into invoice (id, org_id, client_party_id, status) values ($1,$2,$3,'open')", [invoiceA, orgA, clientA]);
  await admin.query("insert into invoice_line (id, org_id, invoice_id, work_line_id, amount) values ($1,$2,$3,$4,6000)", [invoiceLineA, orgA, invoiceA, workLineA]);
  await admin.query("insert into payment (id, org_id, direction, counterparty_party_id, amount, paid_at) values ($1,$2,'in',$3,4000,current_date)", [paymentInA, orgA, clientA]);
  await admin.query("insert into payment_allocation (id, org_id, payment_id, invoice_line_id, amount) values ($1,$2,$3,$4,4000)", [allocA, orgA, paymentInA, invoiceLineA]);

  // Client accounts for both clients (active).
  await admin.query(
    `insert into client_account (id, org_id, party_id, login_id, password_hash, status) values
       ($1,$3,$4,$5,$7,'active'),($2,$3,$6,$8,$7,'active')`,
    [clientAcctA, clientAcctB, orgA, clientA, lid("clientA"), clientB, HASH, lid("clientB")],
  );

  // Messages in client A's thread.
  await admin.query(
    `insert into client_message (id, org_id, party_id, body, sender, created_by_client_account_id) values
       ($1,$2,$3,'Hi from client A','client',$4)`,
    [msgFromClientA, orgA, clientA, clientAcctA],
  );
  await admin.query(
    "insert into client_message (id, org_id, party_id, body, sender, created_by_user_id) values ($1,$2,$3,'Admin reply','admin',$4)",
    [msgFromAdminA, orgA, clientA, randomUUID()],
  );

  // ── Lead promotion: a lead + a draft job tied to it ──
  await admin.query(
    "insert into client_account (id, org_id, party_id, login_id, password_hash, status, expires_at) values ($1,$2,$3,$4,$5,'lead', now() - interval '1 day')",
    [leadPromote, orgA, leadPromoteParty, lid("leadpromote"), HASH],
  );
  await admin.query(
    "insert into work_item (id, org_id, title, source_party_id, work_state, client_account_id) values ($1,$2,'Lead promote job',$3,'draft',$4)",
    [leadPromoteJob, orgA, leadPromoteParty, leadPromote],
  );

  // ── Purge fixtures ──
  // (a) expired lead, draft-only job → should be purged
  await admin.query(
    "insert into client_account (id, org_id, party_id, login_id, password_hash, status, expires_at) values ($1,$2,$3,$4,$5,'lead', now() - interval '2 day')",
    [leadPurge, orgA, leadPurgeParty, lid("leadpurge"), HASH],
  );
  await admin.query(
    "insert into work_item (id, org_id, title, source_party_id, work_state, client_account_id) values ($1,$2,'Purge draft',$3,'draft',$4)",
    [leadPurgeJob, orgA, leadPurgeParty, leadPurge],
  );
  await admin.query(
    "insert into client_message (id, org_id, party_id, body, sender, created_by_client_account_id) values ($1,$2,$3,'lead msg','client',$4)",
    [leadPurgeMsg, orgA, leadPurgeParty, leadPurge],
  );
  // (b) expired lead BUT with a confirmed job → must NOT be purged
  await admin.query(
    "insert into client_account (id, org_id, party_id, login_id, password_hash, status, expires_at) values ($1,$2,$3,$4,$5,'lead', now() - interval '2 day')",
    [leadKept, orgA, leadKeptParty, lid("leadkept"), HASH],
  );
  await admin.query(
    "insert into work_item (id, org_id, title, source_party_id, work_state, client_account_id) values ($1,$2,'Kept confirmed',$3,'confirmed',$4)",
    [leadKeptJob, orgA, leadKeptParty, leadKept],
  );
  // (c) active account, expired-looking → must NOT be purged
  await admin.query(
    "insert into client_account (id, org_id, party_id, login_id, password_hash, status, expires_at) values ($1,$2,$3,$4,$5,'active', now() - interval '2 day')",
    [acctActive, orgA, acctActiveParty, lid("active"), HASH],
  );

  // ── org B (tenant isolation) ──
  await admin.query(
    "insert into client_account (id, org_id, party_id, login_id, password_hash, status) values ($1,$2,$3,$4,$5,'active')",
    [acctOrgB, orgB, clientBOther, lid("orgb"), HASH],
  );
  await admin.query(
    "insert into client_message (id, org_id, party_id, body, sender) values ($1,$2,$3,'orgB msg','admin')",
    [msgOrgB, orgB, clientBOther],
  );
});

after(async () => {
  for (const org of [orgA, orgB]) {
    await admin.query("delete from client_message where org_id=$1", [org]);
    await admin.query("delete from client_refresh_token where client_account_id in (select id from client_account where org_id=$1)", [org]);
    await admin.query("delete from payment_allocation where org_id=$1", [org]);
    await admin.query("delete from payment where org_id=$1", [org]);
    await admin.query("delete from invoice_line where org_id=$1", [org]);
    await admin.query("delete from invoice where org_id=$1", [org]);
    await admin.query("delete from leg where org_id=$1", [org]);
    await admin.query("delete from work_line where org_id=$1", [org]);
    await admin.query("delete from work_item where org_id=$1", [org]);
    await admin.query("delete from client_account where org_id=$1", [org]);
    await admin.query("delete from party where org_id=$1", [org]);
    await admin.query("delete from org where id=$1", [org]);
  }
  await admin.end();
  await appPool.end();
});

type Ctx = { partyId: string | null; isSuperadmin: boolean; orgId?: string };

async function works(ctx: Ctx, target: string) {
  return withRlsTransaction(appPool, { orgId: ctx.orgId ?? orgA, partyId: ctx.partyId, isSuperadmin: ctx.isSuperadmin }, async (tx) => {
    const res = await tx.execute(sql`select * from client_works(${target})`);
    return res.rows as Array<Record<string, unknown>>;
  });
}

// ─── 1. client_works — own jobs, correct amounts, NO writer cost / margin ───────

describe("🔴 client_works — own jobs only; never the writer cost (3000) or margin", () => {
  it("client A sees their confirmed job with billed 6000 / paid 4000 / due 2000", async () => {
    const rows = await works({ partyId: clientA, isSuperadmin: false }, clientA);
    assert.equal(rows.length, 1, "exactly client A's one job");
    const r = rows[0];
    assert.equal(r.work_item_id, workItemA);
    assert.equal(Number(r.amount_billed), 6000, "client's own bill");
    assert.equal(Number(r.amount_paid), 4000, "partial allocation");
    assert.equal(Number(r.amount_due), 2000, "6000 − 4000");
    assert.equal(r.work_state, "confirmed");
  });

  it("🔴 NO column in client A's row equals 3000 (the writer cost) or a margin (3000)", async () => {
    const rows = await works({ partyId: clientA, isSuperadmin: false }, clientA);
    for (const [k, v] of Object.entries(rows[0])) {
      assert.notEqual(Number(v), 3000, `column ${k} must never reveal the writer cost / margin (3000)`);
    }
  });

  it("🔴 client A calling client_works(client B) → ZERO rows (caller guard), not an error", async () => {
    const rows = await works({ partyId: clientA, isSuperadmin: false }, clientB);
    assert.deepEqual(rows, [], "a client can never read another client's jobs");
  });

  it("🔴 the Writer calling client_works(client A) → ZERO rows (caller guard)", async () => {
    const rows = await works({ partyId: writer, isSuperadmin: false }, clientA);
    assert.deepEqual(rows, [], "a non-client caller is guarded out");
  });

  it("SuperAdmin can read client A's job (the guard yields to superadmin)", async () => {
    const rows = await works({ partyId: null, isSuperadmin: true }, clientA);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].amount_billed), 6000);
  });
});

// ─── 2. client_outstanding — AR from the client's own invoices only ─────────────

describe("client_outstanding — billed/paid/due from the client's own invoices", () => {
  async function outstanding(ctx: Ctx, target: string) {
    return withRlsTransaction(appPool, { orgId: orgA, partyId: ctx.partyId, isSuperadmin: ctx.isSuperadmin }, async (tx) => {
      const res = await tx.execute(sql`select billed, paid, due from client_outstanding(${target})`);
      return res.rows[0] as { billed: string; paid: string; due: string } | undefined;
    });
  }

  it("client A: billed 6000, paid 4000, due 2000", async () => {
    const r = await outstanding({ partyId: clientA, isSuperadmin: false }, clientA);
    assert.equal(Number(r?.billed), 6000);
    assert.equal(Number(r?.paid), 4000);
    assert.equal(Number(r?.due), 2000);
  });

  it("🔴 client A calling client_outstanding(client B) → empty AR (caller guard)", async () => {
    const r = await outstanding({ partyId: clientA, isSuperadmin: false }, clientB);
    // The aggregate definer with no permitted rows returns a single all-null/zero row.
    assert.ok(r === undefined || Number(r.billed) === 0, "no other client's AR is exposed");
  });
});

// ─── 3. The chain stays opaque — leg_visibility RLS ─────────────────────────────

describe("🔴 chain opacity — client A cannot read the Momin→Writer leg", () => {
  it("client A reads ONLY the leg they are a party to (the 6000 client→Momin leg)", async () => {
    const rows = await withRlsTransaction(appPool, { orgId: orgA, partyId: clientA, isSuperadmin: false }, async (tx) => {
      const res = await tx.execute(sql`select id, amount from leg where work_item_id = ${workItemA}`);
      return res.rows as Array<{ id: string; amount: string }>;
    });
    const ids = rows.map((r) => r.id);
    assert.ok(ids.includes(legClientMomin), "client A is a party to the client→Momin leg");
    assert.ok(!ids.includes(legMominWriter), "client A is NOT a party to the Momin→Writer (3000) leg");
    for (const r of rows) assert.notEqual(Number(r.amount), 3000, "the 3000 writer cost must never be readable by the client");
  });

  it("🔴 the writer-cost leg id returns ZERO rows for client A (not an error)", async () => {
    const rows = await withRlsTransaction(appPool, { orgId: orgA, partyId: clientA, isSuperadmin: false }, async (tx) => {
      const res = await tx.execute(sql`select id from leg where id = ${legMominWriter}`);
      return res.rows;
    });
    assert.deepEqual(rows, [], "the writer leg is invisible to the client");
  });
});

// ─── 4. client_auth_lookup ──────────────────────────────────────────────────────

describe("client_auth_lookup — returns the right account (pre-login bypass)", () => {
  it("resolves client A's login to the right org/party/status", async () => {
    // Pre-login there is no GUC context; the definer reads by login_id. Run with a
    // blank business context (no party) to mirror the real auth path.
    const row = await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: false }, async (tx) => {
      const res = await tx.execute(sql`select id, org_id, party_id, status from client_auth_lookup(${lid("clientA")})`);
      return res.rows[0] as { id: string; org_id: string; party_id: string; status: string } | undefined;
    });
    assert.ok(row, "the login resolves");
    assert.equal(row?.id, clientAcctA);
    assert.equal(row?.org_id, orgA);
    assert.equal(row?.party_id, clientA);
    assert.equal(row?.status, "active");
  });

  it("an unknown login → no row", async () => {
    const rows = await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: false }, async (tx) => {
      const res = await tx.execute(sql`select id from client_auth_lookup(${"nobody@cp.test"})`);
      return res.rows;
    });
    assert.deepEqual(rows, []);
  });
});

// ─── 5. Lead promotion trigger ──────────────────────────────────────────────────

describe("lead promotion — a lead becomes active when its job is confirmed", () => {
  it("confirming the draft job flips the lead to active + clears expires_at", async () => {
    // The confirm runs under the app role (the trigger is SECURITY DEFINER).
    await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
      await tx.execute(sql`update work_item set work_state = 'confirmed' where id = ${leadPromoteJob}`);
    });
    const acct = (await admin.query("select status, expires_at from client_account where id=$1", [leadPromote])).rows[0];
    assert.equal(acct.status, "active", "the lead was promoted");
    assert.equal(acct.expires_at, null, "expiry cleared on promotion");
  });
});

// ─── 6. Purge ───────────────────────────────────────────────────────────────────

describe("client_purge_expired_leads — only expired unconverted leads", () => {
  it("purges the expired draft-only lead (+ its draft job + messages), keeps the rest", async () => {
    const purged = await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: false }, async (tx) => {
      const res = await tx.execute(sql`select client_purge_expired_leads() as n`);
      return Number((res.rows[0] as { n: number }).n);
    });
    assert.ok(purged >= 1, "at least the one expired draft-only lead is purged");

    const gone = (await admin.query("select 1 from client_account where id=$1", [leadPurge])).rowCount;
    assert.equal(gone, 0, "the expired draft-only lead is deleted");
    const jobGone = (await admin.query("select 1 from work_item where id=$1", [leadPurgeJob])).rowCount;
    assert.equal(jobGone, 0, "its draft job is deleted");
    const msgGone = (await admin.query("select 1 from client_message where id=$1", [leadPurgeMsg])).rowCount;
    assert.equal(msgGone, 0, "its messages are deleted");

    const keptLead = (await admin.query("select 1 from client_account where id=$1", [leadKept])).rowCount;
    assert.equal(keptLead, 1, "a lead WITH a confirmed job is NOT purged");
    const keptActive = (await admin.query("select 1 from client_account where id=$1", [acctActive])).rowCount;
    assert.equal(keptActive, 1, "an active account is NOT purged");
  });
});

// ─── 7. Tenant isolation ────────────────────────────────────────────────────────

describe("tenant isolation — another org's rows are invisible", () => {
  it("org A admin context sees ZERO of org B's client_account rows", async () => {
    const rows = await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
      const res = await tx.execute(sql`select id from client_account where id = ${acctOrgB}`);
      return res.rows;
    });
    assert.deepEqual(rows, [], "org B's client_account is invisible under org A context");
  });

  it("org A admin context sees ZERO of org B's client_message rows", async () => {
    const rows = await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
      const res = await tx.execute(sql`select id from client_message where id = ${msgOrgB}`);
      return res.rows;
    });
    assert.deepEqual(rows, [], "org B's client_message is invisible under org A context");
  });

  it("org B context CAN see its own client_account (sanity — isolation, not a black hole)", async () => {
    const rows = await withRlsTransaction(appPool, { orgId: orgB, partyId: null, isSuperadmin: true }, async (tx) => {
      const res = await tx.execute(sql`select id from client_account where id = ${acctOrgB}`);
      return res.rows;
    });
    assert.equal(rows.length, 1, "org B sees its own row");
  });
});

// ─── 8. client_messages caller-guard ────────────────────────────────────────────

describe("client_messages — own thread only (caller guard)", () => {
  it("client A reads their own thread (both client + admin messages)", async () => {
    const rows = await withRlsTransaction(appPool, { orgId: orgA, partyId: clientA, isSuperadmin: false }, async (tx) => {
      const res = await tx.execute(sql`select id, sender from client_messages(${clientA})`);
      return res.rows as Array<{ id: string; sender: string }>;
    });
    const ids = rows.map((r) => r.id);
    assert.ok(ids.includes(msgFromClientA) && ids.includes(msgFromAdminA), "client A sees their thread");
  });

  it("🔴 client A calling client_messages(client B) → ZERO rows (caller guard)", async () => {
    const rows = await withRlsTransaction(appPool, { orgId: orgA, partyId: clientA, isSuperadmin: false }, async (tx) => {
      const res = await tx.execute(sql`select id from client_messages(${clientB})`);
      return res.rows;
    });
    assert.deepEqual(rows, [], "a client cannot read another client's thread");
  });
});
