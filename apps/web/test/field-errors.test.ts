import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../src/lib/api";
import { fieldErrorMap, hasFieldErrors, bannerMessage } from "../src/lib/field-errors";

// ─── fieldErrorMap ────────────────────────────────────────────────────────────
test("a multi-field validation error surfaces each message at its own field", () => {
  const err = new ApiError(400, "amount must be a positive number, workItemId must be a UUID", [
    { field: "amount", message: "amount must be a positive number" },
    { field: "workItemId", message: "workItemId must be a UUID" },
  ]);
  const map = fieldErrorMap(err);
  assert.equal(map.amount, "amount must be a positive number");
  assert.equal(map.workItemId, "workItemId must be a UUID");
  // Only the two reported fields are present — no cross-contamination.
  assert.deepEqual(Object.keys(map).sort(), ["amount", "workItemId"]);
});

test("when the API reports a field twice, the first message wins", () => {
  const err = new ApiError(400, "x", [
    { field: "email", message: "email must be an email" },
    { field: "email", message: "email should not be empty" },
  ]);
  assert.equal(fieldErrorMap(err).email, "email must be an email");
});

test("non-ApiError throws (network failure, plain Error) carry no field errors", () => {
  assert.deepEqual(fieldErrorMap(new Error("Failed to fetch")), {});
  assert.deepEqual(fieldErrorMap("boom"), {});
  assert.deepEqual(fieldErrorMap(null), {});
});

test("an ApiError without fieldErrors (e.g. a 500) maps to nothing", () => {
  assert.deepEqual(fieldErrorMap(new ApiError(500, "Internal Server Error")), {});
});

// ─── hasFieldErrors / bannerMessage (fallback banner logic) ───────────────────
test("hasFieldErrors distinguishes field-level failures from everything else", () => {
  assert.equal(hasFieldErrors(new ApiError(400, "x", [{ field: "a", message: "m" }])), true);
  assert.equal(hasFieldErrors(new ApiError(400, "x", [])), false);
  assert.equal(hasFieldErrors(new ApiError(500, "boom")), false);
  assert.equal(hasFieldErrors(new Error("network")), false);
});

test("the fallback banner is hidden once every failure is pinned to a field", () => {
  const fieldy = new ApiError(400, "amount must be positive", [{ field: "amount", message: "amount must be positive" }]);
  assert.equal(bannerMessage(fieldy), undefined);
});

test("the fallback banner shows for non-field errors (network, 500) with a friendly default", () => {
  assert.equal(bannerMessage(new ApiError(500, "Internal Server Error")), "Internal Server Error");
  assert.equal(bannerMessage(new Error("Failed to fetch")), "Failed to fetch");
  assert.equal(bannerMessage("weird", "Could not save"), "Could not save");
  assert.equal(bannerMessage(null), undefined);
});
