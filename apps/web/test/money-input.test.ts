import assert from "node:assert/strict";
import { test } from "node:test";
import { displayAmount, sanitizeAmount } from "../src/lib/format";

// ─── sanitizeAmount (R1 MoneyInput parse) ─────────────────────────────────────
test("sanitizeAmount strips currency symbols and thousand separators", () => {
  assert.equal(sanitizeAmount("৳1,500.50"), "1500.50");
  assert.equal(sanitizeAmount("1,000,000"), "1000000");
  assert.equal(sanitizeAmount("$ 42.9"), "42.9");
});
test("sanitizeAmount keeps only one decimal point", () => {
  assert.equal(sanitizeAmount("1.2.3"), "1.23");
  assert.equal(sanitizeAmount("1."), "1.");
});
test("sanitizeAmount drops the minus unless negatives are allowed", () => {
  assert.equal(sanitizeAmount("-50"), "50");
  assert.equal(sanitizeAmount("-50", true), "-50");
  assert.equal(sanitizeAmount("5-0", true), "50"); // minus only honored at the start
});
test("sanitizeAmount on empty/garbage yields empty", () => {
  assert.equal(sanitizeAmount(""), "");
  assert.equal(sanitizeAmount("abc"), "");
});

// ─── displayAmount (R1 MoneyInput blur format) ────────────────────────────────
test("displayAmount forces 2 decimals + thousand separators", () => {
  assert.equal(displayAmount("1500"), "1,500.00");
  assert.equal(displayAmount("1500.5"), "1,500.50");
  assert.equal(displayAmount(1000000), "1,000,000.00");
});
test("displayAmount leaves empty empty and preserves non-numeric mid-typed text", () => {
  assert.equal(displayAmount(""), "");
  assert.equal(displayAmount(null), "");
  assert.equal(displayAmount("-"), "-"); // not a number yet → returned unchanged
  assert.equal(displayAmount("."), "."); // not a number yet → returned unchanged
});
