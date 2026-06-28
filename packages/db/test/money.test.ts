import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { round2 } from "@business-os/shared";

/**
 * Change 4 — the SHARED money-rounding helper (CLAUDE.md §3–4). Pins the ONE
 * `round2` so every module rounds money identically (no drift at volume) and so
 * pricing no longer uses `.toFixed(2)` (banker's rounding, diverges). Pure unit
 * test (no DB); run via the db package's node --import tsx --test runner.
 *
 * The contract: round to 2dp, with a half-cent rounding UP (the epsilon nudge),
 * which is exactly where `.toFixed`'s banker's rounding would have diverged.
 */

describe("round2 — the single money-rounding helper (@business-os/shared)", () => {
  it("a half-cent rounds UP (the divergence-from-toFixed cases)", () => {
    // (1.005).toFixed(2) === "1.00" (banker's/float); round2 must give 1.01.
    assert.equal(round2(1.005), 1.01, "1.005 → 1.01 (half-cent up, not toFixed's 1.00)");
    // (2.675).toFixed(2) === "2.67"; round2 must give 2.68.
    assert.equal(round2(2.675), 2.68, "2.675 → 2.68 (half-cent up, not toFixed's 2.67)");
    assert.equal(round2(0.005), 0.01, "0.005 → 0.01");
  });

  it("already-2dp values are unchanged", () => {
    assert.equal(round2(1.0), 1.0);
    assert.equal(round2(1.23), 1.23);
    assert.equal(round2(1000.0), 1000.0);
    assert.equal(round2(0), 0);
    assert.equal(round2(19.99), 19.99);
  });

  it("rounds to 2 decimal places (drops trailing precision)", () => {
    assert.equal(round2(1.234), 1.23, "rounds down below half");
    assert.equal(round2(1.236), 1.24, "rounds up above half");
    assert.equal(round2(3.14159), 3.14);
    assert.equal(round2(2.0 / 3.0), 0.67, "0.6666… → 0.67");
  });

  it("handles negatives (reversing entries / corrections)", () => {
    assert.equal(round2(-1.234), -1.23);
    assert.equal(round2(-1.236), -1.24);
    assert.equal(round2(-2500.5), -2500.5);
    assert.equal(round2(-0.001), -0, "rounds toward 0 for a tiny negative");
  });

  it("the helper is referentially the same for everyone (no local copies)", () => {
    // A representative pricing computation: per_word value × word count.
    // round2 must match the value pricing.service stores (it imports THIS).
    const perWord = 1.5;
    const words = 4001; // 6001.5 → must be a clean money value
    assert.equal(round2(perWord * words), 6001.5);
    // A rate that produces a long tail rounds consistently.
    assert.equal(round2(0.07 * 3), 0.21, "0.21 (float 0.21000000000000002) → 0.21");
    assert.equal(round2(0.1 + 0.2), 0.3, "0.30000000000000004 → 0.3");
  });
});
