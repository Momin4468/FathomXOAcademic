import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isFieldApplicable,
  missingRequired,
  validateCustomValue,
  type CustomFieldDefLike,
} from "@business-os/shared";

/**
 * Module 12 (custom fields) — PURE unit tests for the shared logic the API,
 * tests, and web all reuse (DESIGN_SPEC §2 #10, §8). No DB. Pins the three
 * functions so type/options validation, scope applicability, and required-ness
 * behave identically everywhere. Run via the db package's node --test runner.
 */

/** Build a def with sensible defaults; override per case. */
function def(over: Partial<CustomFieldDefLike> = {}): CustomFieldDefLike {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    targetEntity: "work_item",
    fieldName: "Field",
    fieldType: "text",
    optionsJson: null,
    scopeJson: {},
    required: false,
    archivedAt: null,
    ...over,
  };
}

describe("validateCustomValue — per type (empty always allowed)", () => {
  it("empty (null/undefined/''/[]) is OK for every type (required is a separate concern)", () => {
    for (const t of ["text", "number", "date", "select", "bool"] as const) {
      const d = def({ fieldType: t, optionsJson: t === "select" ? ["a"] : null });
      assert.equal(validateCustomValue(d, null).ok, true, `${t}: null ok`);
      assert.equal(validateCustomValue(d, undefined).ok, true, `${t}: undefined ok`);
      assert.equal(validateCustomValue(d, "").ok, true, `${t}: empty string ok`);
    }
  });

  it("text accepts a string, rejects a non-string", () => {
    assert.equal(validateCustomValue(def({ fieldType: "text" }), "hello").ok, true);
    const bad = validateCustomValue(def({ fieldType: "text" }), 123);
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.match(bad.error, /expected text/i);
  });

  it("number accepts a finite number, rejects strings/NaN/Infinity", () => {
    assert.equal(validateCustomValue(def({ fieldType: "number" }), 42).ok, true);
    assert.equal(validateCustomValue(def({ fieldType: "number" }), 0).ok, true);
    assert.equal(validateCustomValue(def({ fieldType: "number" }), "42").ok, false, "string is not a number");
    assert.equal(validateCustomValue(def({ fieldType: "number" }), Number.NaN).ok, false);
    assert.equal(validateCustomValue(def({ fieldType: "number" }), Number.POSITIVE_INFINITY).ok, false);
  });

  it("bool accepts true/false only", () => {
    assert.equal(validateCustomValue(def({ fieldType: "bool" }), true).ok, true);
    assert.equal(validateCustomValue(def({ fieldType: "bool" }), false).ok, true);
    assert.equal(validateCustomValue(def({ fieldType: "bool" }), "true").ok, false, "string is not bool");
    assert.equal(validateCustomValue(def({ fieldType: "bool" }), 1).ok, false, "1 is not bool");
  });

  it("date accepts a parseable date string, rejects garbage", () => {
    assert.equal(validateCustomValue(def({ fieldType: "date" }), "2026-06-27").ok, true);
    assert.equal(validateCustomValue(def({ fieldType: "date" }), "not-a-date").ok, false);
  });

  it("select accepts a value in options, rejects one not in options", () => {
    const d = def({ fieldType: "select", optionsJson: ["red", "green", "blue"] });
    assert.equal(validateCustomValue(d, "green").ok, true);
    const bad = validateCustomValue(d, "purple");
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.match(bad.error, /not one of the allowed options/i);
  });

  it("select with no/empty options rejects any non-empty value", () => {
    assert.equal(validateCustomValue(def({ fieldType: "select", optionsJson: [] }), "x").ok, false);
    assert.equal(validateCustomValue(def({ fieldType: "select", optionsJson: null }), "x").ok, false);
  });
});

describe("isFieldApplicable — scope matching", () => {
  it("global scope {} applies to any record", () => {
    assert.equal(isFieldApplicable(def({ scopeJson: {} }), {}), true);
    assert.equal(isFieldApplicable(def({ scopeJson: {} }), { clientPartyId: "anything" }), true);
  });

  it("a scope attribute applies only when the record's attribute matches", () => {
    const d = def({ scopeJson: { clientPartyId: "C1" } });
    assert.equal(isFieldApplicable(d, { clientPartyId: "C1" }), true, "match → applicable");
    assert.equal(isFieldApplicable(d, { clientPartyId: "C2" }), false, "mismatch → not applicable");
    assert.equal(isFieldApplicable(d, { clientPartyId: null }), false, "missing attr → not applicable");
    assert.equal(isFieldApplicable(d, {}), false, "absent attr → not applicable");
  });

  it("ALL scope attributes must match (AND)", () => {
    const d = def({ scopeJson: { clientPartyId: "C1", universityRefId: "U1" } });
    assert.equal(isFieldApplicable(d, { clientPartyId: "C1", universityRefId: "U1" }), true);
    assert.equal(isFieldApplicable(d, { clientPartyId: "C1", universityRefId: "U2" }), false);
  });

  it("an empty/null scope attribute does not constrain", () => {
    const d = def({ scopeJson: { clientPartyId: "", universityRefId: null } as Record<string, unknown> });
    assert.equal(isFieldApplicable(d, { clientPartyId: "whatever" }), true);
  });

  it("an archived def never applies (even with a matching/global scope)", () => {
    assert.equal(isFieldApplicable(def({ archivedAt: new Date() }), {}), false);
    assert.equal(
      isFieldApplicable(def({ archivedAt: "2026-01-01T00:00:00Z", scopeJson: { clientPartyId: "C1" } }), {
        clientPartyId: "C1",
      }),
      false,
    );
  });
});

describe("missingRequired — applicable + required + empty only", () => {
  const req = (id: string, over: Partial<CustomFieldDefLike> = {}) =>
    def({ id, required: true, ...over });

  it("returns required, applicable defs whose value is empty", () => {
    const defs = [req("a")];
    assert.deepEqual(missingRequired(defs, {}, {}), ["a"], "empty required → missing");
    assert.deepEqual(missingRequired(defs, { a: "x" }, {}), [], "filled → not missing");
    assert.deepEqual(missingRequired(defs, { a: "" }, {}), ["a"], "empty string counts as missing");
    assert.deepEqual(missingRequired(defs, null, {}), ["a"], "null custom_json → missing");
  });

  it("ignores non-required defs even when empty", () => {
    assert.deepEqual(missingRequired([def({ id: "a", required: false })], {}, {}), []);
  });

  it("ignores inapplicable required defs (out of scope)", () => {
    const defs = [req("a", { scopeJson: { clientPartyId: "C1" } })];
    assert.deepEqual(missingRequired(defs, {}, { clientPartyId: "C2" }), [], "out of scope → not required");
    assert.deepEqual(missingRequired(defs, {}, { clientPartyId: "C1" }), ["a"], "in scope + empty → missing");
  });

  it("ignores archived required defs", () => {
    assert.deepEqual(missingRequired([req("a", { archivedAt: new Date() })], {}, {}), []);
  });

  it("reports several missing ids together", () => {
    const defs = [req("a"), req("b"), def({ id: "c", required: false })];
    assert.deepEqual(missingRequired(defs, { a: "filled" }, {}).sort(), ["b"]);
  });
});
