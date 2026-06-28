import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveJobPnl } from "@business-os/shared";

/**
 * Resit / fail handling (0022) — PURE job-P&L unit tests (no DB). Pins the one
 * function the API and (later) web share so a fail/resit NET LOSS is reported
 * TRUTHFULLY and identically everywhere, never stored (CLAUDE.md §3, SCHEMA §I).
 * Run via the db package's node test runner (no new framework), mirroring
 * work-money-math.test.ts which already exercises @business-os/shared pure fns.
 *
 *   net = revenue − writerCost + clawback − reworkCost ; isLoss = net < 0
 */

describe("deriveJobPnl (job net = revenue − writerCost + clawback − reworkCost; derived, never stored)", () => {
  it("profit case: revenue exceeds writer cost → positive net, not a loss", () => {
    const p = deriveJobPnl({ revenue: 6000, writerCost: 3000, clawback: 0, reworkCost: 0 });
    assert.equal(p.net, 3000, "6000 − 3000 = 3000");
    assert.equal(p.isLoss, false, "a positive net is not a loss");
    // The inputs are echoed back (the read model carries the components).
    assert.equal(p.revenue, 6000);
    assert.equal(p.writerCost, 3000);
    assert.equal(p.clawback, 0);
    assert.equal(p.reworkCost, 0);
  });

  it("loss case: writerCost > revenue (two writers paid on one job) → negative net, isLoss=true", () => {
    // The crux of resit: a redone job can cost more in writers than the client paid.
    const p = deriveJobPnl({ revenue: 6000, writerCost: 9000, clawback: 0, reworkCost: 0 });
    assert.equal(p.net, -3000, "6000 − 9000 = −3000");
    assert.equal(p.isLoss, true, "a negative net MUST surface as a loss (no rounding to 0)");
  });

  it("a clawback (recovered from the original writer) REDUCES the loss", () => {
    const without = deriveJobPnl({ revenue: 6000, writerCost: 9000, clawback: 0, reworkCost: 0 });
    const withClaw = deriveJobPnl({ revenue: 6000, writerCost: 9000, clawback: 2000, reworkCost: 0 });
    assert.equal(without.net, -3000);
    assert.equal(withClaw.net, -1000, "6000 − 9000 + 2000 = −1000 (clawback recovers 2000)");
    assert.ok(withClaw.net > without.net, "the clawback strictly reduces the loss");
    assert.equal(withClaw.isLoss, true, "still a loss, just a smaller one");
  });

  it("a clawback can flip a loss back to break-even / profit", () => {
    const p = deriveJobPnl({ revenue: 6000, writerCost: 9000, clawback: 3000, reworkCost: 0 });
    assert.equal(p.net, 0, "6000 − 9000 + 3000 = 0");
    assert.equal(p.isLoss, false, "net 0 is not a loss (strictly < 0)");
  });

  it("rework cost INCREASES the loss (remediation is a real cost)", () => {
    const base = deriveJobPnl({ revenue: 6000, writerCost: 3000, clawback: 0, reworkCost: 0 });
    const reworked = deriveJobPnl({ revenue: 6000, writerCost: 3000, clawback: 0, reworkCost: 4000 });
    assert.equal(base.net, 3000);
    assert.equal(reworked.net, -1000, "6000 − 3000 − 4000 = −1000 (rework turns profit to loss)");
    assert.equal(reworked.isLoss, true, "enough rework cost makes the job a loss");
  });

  it("client billed to 0 (revenue=0) with two writers paid is a full loss", () => {
    // zeroClientBilling nets revenue to 0; the writer costs remain real.
    const p = deriveJobPnl({ revenue: 0, writerCost: 5000, clawback: 0, reworkCost: 0 });
    assert.equal(p.net, -5000, "0 − 5000 = −5000");
    assert.equal(p.isLoss, true);
  });

  it("all-zero (an untouched job) nets to 0 and is not a loss", () => {
    const p = deriveJobPnl({ revenue: 0, writerCost: 0, clawback: 0, reworkCost: 0 });
    assert.equal(p.net, 0);
    assert.equal(p.isLoss, false);
  });

  it("rounds every component and the net to 2dp (no IEEE754 drift)", () => {
    // 0.1 + 0.2 = 0.30000000000000004 etc. — all must settle to 2dp.
    const p = deriveJobPnl({ revenue: 0.1, writerCost: 0.2, clawback: 0.1, reworkCost: 0 });
    assert.equal(p.revenue, 0.1);
    assert.equal(p.writerCost, 0.2);
    assert.equal(p.clawback, 0.1);
    assert.equal(p.net, 0, "0.1 − 0.2 + 0.1 = 0.0 (not 2.77e-17)");
    assert.equal(p.isLoss, false);
  });

  it("accepts realistic 2dp money and keeps the arithmetic exact", () => {
    const p = deriveJobPnl({ revenue: 1234.56, writerCost: 1000.00, clawback: 12.34, reworkCost: 100.9 });
    assert.equal(p.net, 146, "1234.56 − 1000 + 12.34 − 100.9 = 146.00");
    assert.equal(p.isLoss, false);
  });

  it("the components are independent — clawback never silently nets into writerCost", () => {
    // Guard against a refactor that double-counts a clawback as negative writer cost.
    const p = deriveJobPnl({ revenue: 100, writerCost: 100, clawback: 50, reworkCost: 0 });
    assert.equal(p.writerCost, 100, "writerCost is reported as-is");
    assert.equal(p.clawback, 50, "clawback is reported as-is");
    assert.equal(p.net, 50, "100 − 100 + 50 = 50 (clawback adds, not subtracts)");
  });
});
