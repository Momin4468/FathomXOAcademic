import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveMoneyState, derivePosition, lineBalance, sumAmounts } from "@business-os/shared";

/**
 * Module 5 — PURE money-math unit tests (no DB). Pins the three functions the
 * billing API derives every balance / money-state from, so paid/due, the
 * two-way position, and the money close are DERIVED identically and NEVER stored
 * (CLAUDE.md §3/§4, SCHEMA §F/§I). Run via the db package runner to avoid a new
 * framework; functions live in @business-os/shared (built first).
 */

describe("deriveMoneyState (the MONEY close: unbilled→invoiced→partial→settled)", () => {
  it("nothing billed → unbilled (even if some stray allocation exists)", () => {
    assert.equal(deriveMoneyState({ billedTotal: 0, allocatedTotal: 0 }), "unbilled");
    assert.equal(deriveMoneyState({ billedTotal: 0, allocatedTotal: 500 }), "unbilled");
  });

  it("billed but nothing allocated → invoiced", () => {
    assert.equal(deriveMoneyState({ billedTotal: 6000, allocatedTotal: 0 }), "invoiced");
  });

  it("0 < allocated < billed → partial", () => {
    assert.equal(deriveMoneyState({ billedTotal: 6000, allocatedTotal: 3000 }), "partial");
    assert.equal(deriveMoneyState({ billedTotal: 6000, allocatedTotal: 0.01 }), "partial");
    assert.equal(deriveMoneyState({ billedTotal: 6000, allocatedTotal: 5999.99 }), "partial");
  });

  it("allocated == billed (exact boundary) → settled", () => {
    assert.equal(deriveMoneyState({ billedTotal: 6000, allocatedTotal: 6000 }), "settled");
  });

  it("allocated >= billed (over-allocated, e.g. credit) → settled, never 'partial'", () => {
    assert.equal(deriveMoneyState({ billedTotal: 6000, allocatedTotal: 6000.5 }), "settled");
    assert.equal(deriveMoneyState({ billedTotal: 6000, allocatedTotal: 99999 }), "settled");
  });

  it("lines that net to ≤ 0 (fully discounted) → settled, NOT unbilled (P1 item 6)", () => {
    // A discount line credited the whole bill: there ARE lines, nothing is owed.
    assert.equal(deriveMoneyState({ billedTotal: 0, allocatedTotal: 0, lineCount: 2 }), "settled");
    assert.equal(deriveMoneyState({ billedTotal: -500, allocatedTotal: 0, lineCount: 3 }), "settled");
    // No lines at all is still genuinely unbilled.
    assert.equal(deriveMoneyState({ billedTotal: 0, allocatedTotal: 0, lineCount: 0 }), "unbilled");
    assert.equal(deriveMoneyState({ billedTotal: 0, allocatedTotal: 0 }), "unbilled");
  });

  it("rounds inputs to 2dp so float drift cannot flip the boundary", () => {
    // 0.1+0.2 = 0.30000000000000004; billed 0.3 must read as settled, not partial.
    assert.equal(deriveMoneyState({ billedTotal: 0.3, allocatedTotal: 0.1 + 0.2 }), "settled");
  });
});

describe("lineBalance (per-line client tracking: paid=Σallocations, due=amount−paid)", () => {
  it("no allocations → fully due", () => {
    assert.deepEqual(lineBalance(6000, []), { amount: 6000, paid: 0, due: 6000 });
  });

  it("partial allocation → due is the remainder", () => {
    assert.deepEqual(lineBalance(6000, [3000]), { amount: 6000, paid: 3000, due: 3000 });
  });

  it("multiple allocations sum into paid", () => {
    assert.deepEqual(lineBalance(6000, [2000, 1000, 500]), { amount: 6000, paid: 3500, due: 2500 });
  });

  it("a NEGATIVE reversal allocation reduces paid (append-only correction)", () => {
    // pay 6000, then reverse 6000 → paid back to 0, due back to full.
    assert.deepEqual(lineBalance(6000, [6000, -6000]), { amount: 6000, paid: 0, due: 6000 });
    // pay 6000, reverse only 2000 → net paid 4000.
    assert.deepEqual(lineBalance(6000, [6000, -2000]), { amount: 6000, paid: 4000, due: 2000 });
  });

  it("fully paid → due 0 exactly", () => {
    assert.deepEqual(lineBalance(6000, [6000]), { amount: 6000, paid: 6000, due: 0 });
  });

  it("accepts string amounts (pg numeric comes back as strings)", () => {
    assert.deepEqual(lineBalance("6000.00", ["3000.00", "1500.50"]), {
      amount: 6000,
      paid: 4500.5,
      due: 1499.5,
    });
  });

  it("rounds to 2dp — no float drift in due", () => {
    const b = lineBalance(0.3, [0.1, 0.2]);
    assert.equal(b.paid, 0.3);
    assert.equal(b.due, 0);
  });
});

describe("sumAmounts (reversal-aware Σ, the primitive under every balance)", () => {
  it("treats null/undefined as 0 (empty/partial data)", () => {
    assert.equal(sumAmounts([1000, null, undefined, "500"]), 1500);
  });
  it("nets positive and negative (reversals)", () => {
    assert.equal(sumAmounts([6000, -6000, 100]), 100);
  });
});

describe("derivePosition (two-way: net = earningsOutstanding − chargesOutstanding)", () => {
  it("pure earnings, no charges → net is the earnings outstanding", () => {
    const p = derivePosition({ earningsOwed: 3000, earningsPaid: 0, chargesOwed: 0, chargesPaid: 0 });
    assert.deepEqual(p, { earningsOutstanding: 3000, chargesOutstanding: 0, net: 3000 });
  });

  it("a charge (party owes business) REDUCES the net position", () => {
    // owed 3000 earnings, owes a 500 platform fee, nothing settled either side.
    const p = derivePosition({ earningsOwed: 3000, earningsPaid: 0, chargesOwed: 500, chargesPaid: 0 });
    assert.deepEqual(p, { earningsOutstanding: 3000, chargesOutstanding: 500, net: 2500 });
  });

  it("a settled charge no longer drags the net (chargesPaid cancels chargesOwed)", () => {
    const p = derivePosition({ earningsOwed: 3000, earningsPaid: 0, chargesOwed: 500, chargesPaid: 500 });
    assert.deepEqual(p, { earningsOutstanding: 3000, chargesOutstanding: 0, net: 3000 });
  });

  it("paid-out earnings are removed from outstanding", () => {
    const p = derivePosition({ earningsOwed: 3000, earningsPaid: 1000, chargesOwed: 0, chargesPaid: 0 });
    assert.equal(p.earningsOutstanding, 2000);
    assert.equal(p.net, 2000);
  });

  it("net can go NEGATIVE when charges exceed earnings (party owes business)", () => {
    const p = derivePosition({ earningsOwed: 100, earningsPaid: 0, chargesOwed: 500, chargesPaid: 0 });
    assert.equal(p.net, -400);
  });

  it("rounds to 2dp on every output", () => {
    const p = derivePosition({ earningsOwed: 0.3, earningsPaid: 0.1, chargesOwed: 0.1, chargesPaid: 0 });
    assert.equal(p.earningsOutstanding, 0.2);
    assert.equal(p.chargesOutstanding, 0.1);
    assert.equal(p.net, 0.1);
  });
});
