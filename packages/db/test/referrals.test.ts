import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeReferralSuggestion,
  resolveReferralTerm,
  type DealTermLike,
} from "@business-os/shared";

/**
 * Module 11 (referrers) — PURE referral-logic unit tests (no DB). The cheapest,
 * most thorough place to pin the SUGGESTION math + agreement RESOLUTION
 * (DESIGN_SPEC §4/§8). A referral is "another claimant leg, scoped like any
 * other"; these pure helpers only decide the SUGGESTED amount (the admin may
 * always override) and which standing agreement applies.
 *
 * Lives in the @business-os/db test runner (node --import tsx --test) alongside
 * the other @business-os/shared pure tests (rules-resolution.test.ts) — no new
 * test framework. The package being exercised is @business-os/shared.
 */

const REFERRER = "11111111-1111-4111-8111-111111111111";
const OTHER_REFERRER = "22222222-2222-4222-8222-222222222222";
const CLIENT_X = "33333333-3333-4333-8333-333333333333";
const CLIENT_Y = "44444444-4444-4444-8444-444444444444";

const term = (over: Partial<DealTermLike>): DealTermLike => ({
  id: over.id ?? "t",
  fromPartyId: REFERRER,
  toPartyId: null, // the business side
  appliesTo: "default",
  termType: "referral_pct",
  value: "10",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  ...over,
});

// ─── computeReferralSuggestion — basis math ──────────────────────────────────

describe("computeReferralSuggestion — basis math (revenue/margin/fixed)", () => {
  it("revenue basis: round2(revenue × pct%) — 10% of 6000 = 600", () => {
    const s = computeReferralSuggestion({ basis: "revenue", value: 10, revenue: 6000, margin: 3000 });
    assert.equal(s?.amount, 600);
    assert.equal(s?.basis, "revenue");
    assert.equal(s?.rate, 10);
  });

  it("margin basis: round2(margin × pct%) — 10% of 3000 = 300 (not revenue)", () => {
    const s = computeReferralSuggestion({ basis: "margin", value: 10, revenue: 6000, margin: 3000 });
    assert.equal(s?.amount, 300, "margin basis must use margin, never revenue");
    assert.equal(s?.basis, "margin");
  });

  it("fixed basis: the set amount, independent of revenue/margin", () => {
    const s = computeReferralSuggestion({ basis: "fixed", value: 750, revenue: 6000, margin: 3000 });
    assert.equal(s?.amount, 750);
    assert.equal(s?.basis, "fixed");
    assert.equal(s?.rate, 750);
  });

  it("rounds to 2 dp (banker-free round): 7.5% of 1000 = 75; 3.333% of 1000 = 33.33", () => {
    assert.equal(computeReferralSuggestion({ basis: "revenue", value: 7.5, revenue: 1000 })?.amount, 75);
    assert.equal(computeReferralSuggestion({ basis: "margin", value: 3.333, margin: 1000 })?.amount, 33.33);
  });

  it("revenue basis but revenue missing/null → null (never a silent 0)", () => {
    assert.equal(computeReferralSuggestion({ basis: "revenue", value: 10, revenue: null, margin: 3000 }), null);
    assert.equal(computeReferralSuggestion({ basis: "revenue", value: 10, margin: 3000 }), null);
  });

  it("margin basis but margin missing/null → null (never a silent 0)", () => {
    assert.equal(computeReferralSuggestion({ basis: "margin", value: 10, revenue: 6000, margin: null }), null);
    assert.equal(computeReferralSuggestion({ basis: "margin", value: 10, revenue: 6000 }), null);
  });

  it("a non-finite value → null (hostile input is rejected)", () => {
    assert.equal(computeReferralSuggestion({ basis: "revenue", value: "abc", revenue: 6000 }), null);
    assert.equal(computeReferralSuggestion({ basis: "fixed", value: "xyz" }), null);
    assert.equal(computeReferralSuggestion({ basis: "fixed", value: undefined }), null);
  });

  it("an unknown basis → null (no fabricated suggestion)", () => {
    assert.equal(computeReferralSuggestion({ basis: "bogus", value: 10, revenue: 6000 }), null);
    assert.equal(computeReferralSuggestion({ basis: null, value: 10, revenue: 6000 }), null);
  });

  it("fixed basis works with revenue/margin absent (a flat referral)", () => {
    assert.equal(computeReferralSuggestion({ basis: "fixed", value: 500 })?.amount, 500);
  });
});

// ─── resolveReferralTerm — precedence, dating, referrer filter ───────────────

describe("resolveReferralTerm — client-scoped beats default", () => {
  const asOf = "2026-03-15";
  const def = term({ id: "def", appliesTo: "default", value: "10" });
  const cli = term({ id: "cli", appliesTo: `client:${CLIENT_X}`, value: "20" });

  it("with a matching client → the client-scoped agreement wins", () => {
    const r = resolveReferralTerm([def, cli], { referrerId: REFERRER, clientPartyId: CLIENT_X, asOf });
    assert.equal(r?.id, "cli");
  });

  it("with no client (or a non-matching client) → the default agreement wins", () => {
    assert.equal(resolveReferralTerm([def, cli], { referrerId: REFERRER, asOf })?.id, "def");
    assert.equal(
      resolveReferralTerm([def, cli], { referrerId: REFERRER, clientPartyId: CLIENT_Y, asOf })?.id,
      "def",
      "a client-scoped agreement for X must not leak to client Y",
    );
  });
});

describe("resolveReferralTerm — effective-dating (half-open [from, to))", () => {
  // Two versions of the same default agreement: v1 10% [2026-01-01,2026-06-01), v2 15% [2026-06-01,null).
  const v1 = term({ id: "v1", value: "10", effectiveFrom: "2026-01-01", effectiveTo: "2026-06-01" });
  const v2 = term({ id: "v2", value: "15", effectiveFrom: "2026-06-01", effectiveTo: null });
  const candidates = [v1, v2];
  const ctx = { referrerId: REFERRER };

  it("asOf inside v1's window → v1 (a past job settles on past terms)", () => {
    assert.equal(resolveReferralTerm(candidates, { ...ctx, asOf: "2026-03-15" })?.id, "v1");
  });

  it("asOf == v1.effectiveTo == v2.effectiveFrom → v2 (boundary belongs to the new window)", () => {
    assert.equal(resolveReferralTerm(candidates, { ...ctx, asOf: "2026-06-01" })?.id, "v2");
  });

  it("asOf on the last day of v1 (2026-05-31) → still v1", () => {
    assert.equal(resolveReferralTerm(candidates, { ...ctx, asOf: "2026-05-31" })?.id, "v1");
  });

  it("asOf before any version → null (no fabricated agreement)", () => {
    assert.equal(resolveReferralTerm(candidates, { ...ctx, asOf: "2025-12-31" }), null);
  });
});

describe("resolveReferralTerm — referrer filter + missing/empty", () => {
  it("a term for a DIFFERENT referrer is filtered out (never wins)", () => {
    const otherTerm = term({ id: "other", fromPartyId: OTHER_REFERRER, value: "99" });
    const r = resolveReferralTerm([otherTerm], { referrerId: REFERRER, asOf: "2026-03-15" });
    assert.equal(r, null, "an agreement keyed on another referrer must not leak");
  });

  it("only the requested referrer's term survives when both are present", () => {
    const mine = term({ id: "mine", fromPartyId: REFERRER, value: "10" });
    const theirs = term({ id: "theirs", fromPartyId: OTHER_REFERRER, value: "99" });
    assert.equal(resolveReferralTerm([theirs, mine], { referrerId: REFERRER, asOf: "2026-03-15" })?.id, "mine");
  });

  it("a non-referral_pct term is ignored (hard type filter)", () => {
    const split = term({ id: "split", termType: "split_pct", value: "50" });
    assert.equal(resolveReferralTerm([split], { referrerId: REFERRER, asOf: "2026-03-15" }), null);
  });

  it("no candidates → null", () => {
    assert.equal(resolveReferralTerm([], { referrerId: REFERRER, asOf: "2026-03-15" }), null);
  });
});
