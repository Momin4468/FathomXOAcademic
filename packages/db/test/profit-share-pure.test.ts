import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveProfitShares,
  resolveProfitShareTerm,
  type DealTermLike,
  type ProfitShareJobInput,
} from "@business-os/shared";

/**
 * Module 17 — PURE N-way profit-share unit tests (no DB). Pins the FORMULA (each
 * basis), the N-way division + residual, the §4.4 owner-dividend (default scope),
 * the source-scoped channel share, and the load-bearing EFFECTIVE-DATING
 * guarantee: changing the scheme does NOT rewrite a past job's cut.
 */

const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const INVESTOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const WEB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // a channel party (the job source)

const term = (over: Partial<DealTermLike>): DealTermLike => ({
  id: over.id ?? "t",
  fromPartyId: null, // the business pays profit-share
  toPartyId: OWNER_A,
  appliesTo: "default",
  termType: "profit_share",
  basis: "pct_after_writer",
  value: "50",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  ...over,
});

const job = (over: Partial<ProfitShareJobInput> = {}): ProfitShareJobInput => ({
  workItemId: "job-1",
  jobDate: "2026-03-15",
  revenue: 6000,
  writerCost: 3000,
  sourcePartyId: null,
  ...over,
});

// ─── resolveProfitShareTerm — keyed on the beneficiary, source-scoped ──────────

describe("resolveProfitShareTerm — beneficiary key + source precedence", () => {
  it("matches on to_party_id (the beneficiary), not a from→to pair", () => {
    const t = term({ id: "a", toPartyId: OWNER_A });
    const r = resolveProfitShareTerm([t], { toPartyId: OWNER_A, asOf: "2026-03-15" });
    assert.equal(r?.id, "a");
  });

  it("a term for a different beneficiary never resolves", () => {
    const t = term({ id: "a", toPartyId: OWNER_B });
    const r = resolveProfitShareTerm([t], { toPartyId: OWNER_A, asOf: "2026-03-15" });
    assert.equal(r, null);
  });

  it("a source-scoped term beats a default term for the same beneficiary", () => {
    const def = term({ id: "def", appliesTo: "default", value: "10" });
    const src = term({ id: "src", appliesTo: `source:${WEB}`, value: "40" });
    const r = resolveProfitShareTerm([def, src], { toPartyId: OWNER_A, sourcePartyId: WEB, asOf: "2026-03-15" });
    assert.equal(r?.id, "src");
  });

  it("a source-scoped term is ignored when the job's source differs", () => {
    const def = term({ id: "def", appliesTo: "default", value: "10" });
    const src = term({ id: "src", appliesTo: `source:${WEB}`, value: "40" });
    const r = resolveProfitShareTerm([def, src], { toPartyId: OWNER_A, sourcePartyId: "other", asOf: "2026-03-15" });
    assert.equal(r?.id, "def");
  });
});

// ─── deriveProfitShares — each basis ───────────────────────────────────────────

describe("deriveProfitShares — the FORMULA per basis (pool = revenue − writerCost = 3000)", () => {
  it("pct_after_writer: 50% of 3000 = 1500", () => {
    const r = deriveProfitShares(job(), [{ toPartyId: OWNER_A, terms: [term({ basis: "pct_after_writer", value: "50" })] }]);
    assert.equal(r.pool, 3000);
    assert.equal(r.cuts[0]?.amount, 1500);
    assert.equal(r.residual, 1500);
  });

  it("pct_of_net: defaults to revenue − writerCost when net not supplied (10% of 3000 = 300)", () => {
    const r = deriveProfitShares(job(), [{ toPartyId: INVESTOR, terms: [term({ toPartyId: INVESTOR, basis: "pct_of_net", value: "10" })] }]);
    assert.equal(r.cuts[0]?.amount, 300);
  });

  it("pct_of_net: honours an explicit net override (10% of net 2000 = 200)", () => {
    const r = deriveProfitShares(job({ net: 2000 }), [{ toPartyId: INVESTOR, terms: [term({ toPartyId: INVESTOR, basis: "pct_of_net", value: "10" })] }]);
    assert.equal(r.cuts[0]?.amount, 200);
    assert.equal(r.cuts[0]?.base, 2000);
  });

  it("pct_of_channel: uses channelEarnings override (20% of 1000 = 200)", () => {
    const r = deriveProfitShares(job({ channelEarnings: 1000, sourcePartyId: WEB }), [
      { toPartyId: OWNER_A, terms: [term({ basis: "pct_of_channel", value: "20", appliesTo: `source:${WEB}` })] },
    ]);
    assert.equal(r.cuts[0]?.amount, 200);
  });

  it("fixed: the value is the amount, independent of the pool", () => {
    const r = deriveProfitShares(job(), [{ toPartyId: OWNER_A, terms: [term({ basis: "fixed", value: "500" })] }]);
    assert.equal(r.cuts[0]?.amount, 500);
    assert.equal(r.residual, 2500);
  });
});

// ─── N-way division + residual + over-allocation ──────────────────────────────

describe("deriveProfitShares — N-way division", () => {
  it("three sharers split a pool; residual is the remainder to the business", () => {
    const r = deriveProfitShares(job(), [
      { toPartyId: OWNER_A, terms: [term({ toPartyId: OWNER_A, basis: "pct_after_writer", value: "40" })] }, // 1200
      { toPartyId: OWNER_B, terms: [term({ toPartyId: OWNER_B, basis: "pct_after_writer", value: "30" })] }, // 900
      { toPartyId: INVESTOR, terms: [term({ toPartyId: INVESTOR, basis: "pct_of_net", value: "10" })] }, // 300
    ]);
    assert.equal(r.cuts.length, 3);
    assert.equal(r.cuts.reduce((s, c) => s + c.amount, 0), 2400);
    assert.equal(r.residual, 600); // 3000 − 2400
    assert.equal(r.overAllocated, false);
  });

  it("a sharer with no resolvable term contributes no cut", () => {
    const r = deriveProfitShares(job(), [
      { toPartyId: OWNER_A, terms: [] },
      { toPartyId: OWNER_B, terms: [term({ toPartyId: OWNER_B, value: "50" })] },
    ]);
    assert.equal(r.cuts.length, 1);
    assert.equal(r.cuts[0]?.toPartyId, OWNER_B);
  });

  it("over-allocation (Σ cuts > pool) is FLAGGED, never silently clamped", () => {
    const r = deriveProfitShares(job(), [
      { toPartyId: OWNER_A, terms: [term({ toPartyId: OWNER_A, value: "70" })] }, // 2100
      { toPartyId: OWNER_B, terms: [term({ toPartyId: OWNER_B, value: "60" })] }, // 1800 → 3900 > 3000
    ]);
    assert.equal(r.overAllocated, true);
    assert.ok(r.residual < 0, "residual goes negative rather than clamping a configured rate");
  });
});

// ─── Owner dividend (default scope) applies structurally ──────────────────────

describe("deriveProfitShares — owner dividend (default scope) applies on every job", () => {
  it("a default pct_of_net term applies even with no source set (no login needed)", () => {
    const r = deriveProfitShares(job({ sourcePartyId: null }), [
      { toPartyId: INVESTOR, terms: [term({ toPartyId: INVESTOR, appliesTo: "default", basis: "pct_of_net", value: "5" })] },
    ]);
    assert.equal(r.cuts[0]?.amount, 150); // 5% of 3000
  });
});

// ─── EFFECTIVE-DATING — changing the scheme does NOT rewrite a past job ────────

describe("deriveProfitShares — a scheme change does not rewrite a past job's cut", () => {
  const v1 = term({ id: "v1", basis: "pct_after_writer", value: "10", effectiveFrom: "2026-01-01", effectiveTo: "2026-04-01" });
  const v2 = term({ id: "v2", basis: "pct_after_writer", value: "5", effectiveFrom: "2026-04-01", effectiveTo: null });
  const sharers = [{ toPartyId: OWNER_A, terms: [v1, v2] }];

  it("a March job settles on the 10% (v1) term → 300", () => {
    const r = deriveProfitShares(job({ jobDate: "2026-03-15" }), sharers);
    assert.equal(r.cuts[0]?.termId, "v1");
    assert.equal(r.cuts[0]?.amount, 300);
  });

  it("a May job settles on the superseding 5% (v2) term → 150 (adding v2 didn't change March)", () => {
    const r = deriveProfitShares(job({ jobDate: "2026-05-01" }), sharers);
    assert.equal(r.cuts[0]?.termId, "v2");
    assert.equal(r.cuts[0]?.amount, 150);
  });
});
