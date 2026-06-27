import assert from "node:assert/strict";
import { test } from "node:test";
import { chargeCategoryLabel, clampAmount, netLabel, remainingToAllocate } from "../src/lib/billing";

// ─── remainingToAllocate ──────────────────────────────────────────────────────
test("remainingToAllocate subtracts entered amounts from the payment total", () => {
  assert.equal(remainingToAllocate(100, [60]), 40);
  assert.equal(remainingToAllocate("100", ["60", "40"]), 0);
  assert.equal(remainingToAllocate(100, []), 100);
});
test("remainingToAllocate ignores blank/negative/NaN entries and rounds to 2dp", () => {
  assert.equal(remainingToAllocate(100, ["", null, undefined, -5, "abc"]), 100);
  assert.equal(remainingToAllocate(10, [3.333, 3.333]), 3.33);
});
test("remainingToAllocate returns 0 when the payment amount is not visible", () => {
  assert.equal(remainingToAllocate(null, [10]), 0);
  assert.equal(remainingToAllocate(undefined, []), 0);
});

// ─── clampAmount ──────────────────────────────────────────────────────────────
test("clampAmount clamps to [0, max]", () => {
  assert.equal(clampAmount(50, 40), 40);
  assert.equal(clampAmount(30, 40), 30);
  assert.equal(clampAmount(-5, 40), 0);
  assert.equal(clampAmount("abc", 40), 0);
  assert.equal(clampAmount(3.333, 40), 3.33);
});

// ─── netLabel (sign-driven, not money-derived) ────────────────────────────────
test("netLabel maps the sign of the net to a label + tone", () => {
  assert.deepEqual(netLabel(500), { text: "owed to this party", tone: "green" });
  assert.deepEqual(netLabel(-500), { text: "owed to the business", tone: "red" });
  assert.deepEqual(netLabel(0), { text: "settled", tone: "gray" });
  assert.deepEqual(netLabel(null), { text: "—", tone: "gray" });
  assert.deepEqual(netLabel(undefined), { text: "—", tone: "gray" });
});

// ─── chargeCategoryLabel ──────────────────────────────────────────────────────
test("chargeCategoryLabel humanizes the enum", () => {
  assert.equal(chargeCategoryLabel("platform_fee"), "Platform fee");
  assert.equal(chargeCategoryLabel("ai_check"), "AI check");
  assert.equal(chargeCategoryLabel("other"), "Other");
  assert.equal(chargeCategoryLabel("some_new_thing"), "some new thing");
});
