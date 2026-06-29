import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { env } from "../src/env.js";

/**
 * Migration 0029 (analytics/BI plane, DESIGN_SPEC §8) — DB-ROLE BOUNDARY proofs.
 *
 * Embedded Metabase connects to the business DB as `analytics_ro`. The opacity
 * guarantees (§4.4/§4.5) must hold THROUGH BI: that role may read ONLY the
 * redacted `analytics` views and NOTHING else — no base table (leg, payment,
 * invoice, …), no GUC-scoped SECURITY DEFINER function. If any of these fail,
 * a real price/private-margin could leak via the BI tool, regardless of the
 * signed-embed param lock.
 *
 * We connect with a connection string derived from the admin URL, swapping in
 * the analytics_ro user/password (the role is created by `pnpm db:migrate` via
 * ensureAppRole). Read-only: we mutate nothing and clean up nothing.
 */

// Build the analytics_ro connection string off the admin URL (same db/host/port).
const roUrl = (() => {
  const u = new URL(env.adminUrl);
  u.username = env.analyticsRoUser;
  u.password = env.analyticsRoPassword;
  return u.toString();
})();

const ro = new pg.Client({ connectionString: roUrl });

// The 8 redacted views the BI tool is allowed to read.
const VIEWS = [
  "analytics.org_net",
  "analytics.writer_cost",
  "analytics.org_receivables",
  "analytics.settlement_position",
  "analytics.work_volume",
  "analytics.writer_reputation",
  "analytics.expense_totals",
  "analytics.party_balance",
] as const;

// Sensitive base tables that must be UNREADABLE to the BI role.
const FORBIDDEN_TABLES = [
  "leg",
  "payment",
  "payment_allocation",
  "invoice",
  "invoice_line",
  "charge",
  "deal_term",
  "settlement_transfer",
  "work_outcome",
  "expense",
  "party",
  "work_item",
  "pf_income",
  "pf_account",
  "pf_note",
  "credential_vault_item",
] as const;

before(async () => {
  await ro.connect();
});

after(async () => {
  await ro.end();
});

describe("analytics_ro CAN read the redacted analytics views", () => {
  for (const view of VIEWS) {
    it(`select from ${view} succeeds (returns >= 0 rows)`, async () => {
      const res = await ro.query(`select * from ${view}`);
      assert.ok(res.rowCount !== null && res.rowCount >= 0, `${view} should be selectable`);
    });
  }
});

describe("analytics_ro is DENIED on every sensitive base table (42501)", () => {
  for (const table of FORBIDDEN_TABLES) {
    it(`select * from ${table} throws permission denied (42501)`, async () => {
      await assert.rejects(
        ro.query(`select * from ${table}`),
        (err: unknown) => {
          const e = err as { code?: string };
          assert.equal(e.code, "42501", `${table} must be denied with 42501, got ${e.code}`);
          return true;
        },
      );
    });
  }
});

describe("analytics_ro CANNOT execute the GUC-scoped definer functions", () => {
  it("dashboard_writer_pnl() throws permission denied (42501)", async () => {
    await assert.rejects(
      ro.query("select * from dashboard_writer_pnl()"),
      (err: unknown) => {
        const e = err as { code?: string };
        assert.equal(e.code, "42501", `definer must be denied 42501, got ${e.code}`);
        return true;
      },
    );
  });

  it("settlement_legs(<uuid>,<uuid>) throws permission denied (42501)", async () => {
    const u = "00000000-0000-4000-8000-000000000001";
    await assert.rejects(
      ro.query("select * from settlement_legs($1,$2)", [u, u]),
      (err: unknown) => {
        const e = err as { code?: string };
        assert.equal(e.code, "42501", `definer must be denied 42501, got ${e.code}`);
        return true;
      },
    );
  });
});

describe("every view carries org_id (tenant axis) + party axis where party-scoped", () => {
  it("each of the 8 views exposes an org_id column", async () => {
    for (const view of VIEWS) {
      // limit 0 returns the column metadata without depending on data presence.
      const res = await ro.query(`select * from ${view} limit 0`);
      const cols = res.fields.map((f) => f.name);
      assert.ok(cols.includes("org_id"), `${view} must carry org_id (got: ${cols.join(",")})`);
    }
  });

  it("writer_cost exposes the doer party column (writer_party_id) + jobs/writer_cost only", async () => {
    const res = await ro.query("select * from analytics.writer_cost limit 0");
    const cols = res.fields.map((f) => f.name).sort();
    assert.deepEqual(cols, ["jobs", "org_id", "writer_cost", "writer_party_id"].sort(),
      `writer_cost must NOT carry revenue/net (top-leg-derived) — got: ${cols.join(",")}`);
  });

  it("party_balance exposes party_id", async () => {
    const res = await ro.query("select * from analytics.party_balance limit 0");
    const cols = res.fields.map((f) => f.name);
    assert.ok(cols.includes("party_id"), `got: ${cols.join(",")}`);
  });

  it("work_volume exposes party_id (the doer)", async () => {
    const res = await ro.query("select * from analytics.work_volume limit 0");
    const cols = res.fields.map((f) => f.name);
    assert.ok(cols.includes("party_id"), `got: ${cols.join(",")}`);
  });

  // §4.4/§4.5: money is exposed ONLY at the org level — never per-party (a
  // per-party money breakdown would reveal one partner the other's private
  // client price/margin, since these views bypass RLS).
  it("org_net + org_receivables carry NO per-party column", async () => {
    for (const view of ["analytics.org_net", "analytics.org_receivables"]) {
      const res = await ro.query(`select * from ${view} limit 0`);
      const cols = res.fields.map((f) => f.name);
      // No per-party DIMENSION (an id column) — org-level measures like
      // writer_cost (the org total) are fine; a writer_party_id would not be.
      const partyDim = cols.filter((c) => /party_id$/i.test(c));
      assert.deepEqual(partyDim, [], `${view} must be org-aggregate only (got party dimension: ${partyDim.join(",")})`);
    }
  });
});

describe("settlement_position exposes the SHARED pool only — no raw client price", () => {
  it("its column set is EXACTLY the safe set (pool/transfers_net present, no client-price column)", async () => {
    const res = await ro.query("select * from analytics.settlement_position limit 0");
    const cols = res.fields.map((f) => f.name).sort();
    const safe = [
      "org_id",
      "partner_a",
      "partner_b",
      "shared_jobs",
      "pool",
      "transfers_net",
    ].sort();
    assert.deepEqual(cols, safe, "settlement_position must expose exactly the safe shared-position columns");
    // No column may be named like a raw client/private money figure.
    const leaky = cols.filter((c) => /client|revenue|amount|margin|profit|writer_cost|private/i.test(c));
    assert.deepEqual(leaky, [], `no client-price/private-margin column may surface: ${leaky.join(",")}`);
  });
});

describe("aggregation sanity — org_net is a true per-org rollup", () => {
  it("org_net has at most one row per org_id", async () => {
    const res = await ro.query(
      "select count(*) = count(distinct org_id) as ok from analytics.org_net",
    );
    assert.equal((res.rows[0] as { ok: boolean }).ok, true, "org_net must have one row per org_id");
  });
});
