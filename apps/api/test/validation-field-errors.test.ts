import assert from "node:assert/strict";
import { test } from "node:test";
import type { ValidationError } from "class-validator";
import { flattenValidationErrors } from "../src/common/validation-field-errors.js";

/** Build a class-validator-shaped ValidationError for a leaf property. */
function verr(property: string, constraints: Record<string, string>, children: ValidationError[] = []): ValidationError {
  return { property, constraints, children } as ValidationError;
}

test("a multi-field failure surfaces each message at its own field", () => {
  const errors: ValidationError[] = [
    verr("amount", { isPositive: "amount must be a positive number" }),
    verr("workItemId", { isUuid: "workItemId must be a UUID" }),
  ];

  const { messages, fieldErrors } = flattenValidationErrors(errors);

  // The flat `message[]` shape the default pipe produced is preserved…
  assert.deepEqual(messages, [
    "amount must be a positive number",
    "workItemId must be a UUID",
  ]);
  // …and each message is also pinned to its own field.
  assert.deepEqual(fieldErrors, [
    { field: "amount", message: "amount must be a positive number" },
    { field: "workItemId", message: "workItemId must be a UUID" },
  ]);
});

test("a field with several failed constraints keeps every message but shows the first per field", () => {
  const errors: ValidationError[] = [
    verr("email", {
      isEmail: "email must be an email",
      isNotEmpty: "email should not be empty",
    }),
  ];

  const { messages, fieldErrors } = flattenValidationErrors(errors);

  assert.deepEqual(messages, ["email must be an email", "email should not be empty"]);
  // One entry per field — the first message is the one a form displays.
  assert.deepEqual(fieldErrors, [{ field: "email", message: "email must be an email" }]);
});

test("nested DTO / array errors produce a dotted field path", () => {
  const errors: ValidationError[] = [
    verr("lines", {}, [
      verr("0", {}, [verr("rate", { min: "rate must not be less than 0" })]),
    ]),
    verr("client", {}, [verr("id", { isUuid: "id must be a UUID" })]),
  ];

  const { messages, fieldErrors } = flattenValidationErrors(errors);

  assert.deepEqual(messages, ["rate must not be less than 0", "id must be a UUID"]);
  assert.deepEqual(fieldErrors, [
    { field: "lines.0.rate", message: "rate must not be less than 0" },
    { field: "client.id", message: "id must be a UUID" },
  ]);
});

test("errors with no constraints (a pure container) add nothing on their own", () => {
  const errors: ValidationError[] = [verr("meta", {}, [])];
  const { messages, fieldErrors } = flattenValidationErrors(errors);
  assert.deepEqual(messages, []);
  assert.deepEqual(fieldErrors, []);
});
