import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMoney } from "../src/lib/format";
import { isAllowedRequest, isSafeProxyPath } from "../src/lib/proxy-guard";

// ─── Money: absent ⇒ null (never a 0/— placeholder) ──────────────────────────
test("formatMoney returns null for absent/invalid values (redacted money stays hidden)", () => {
  for (const v of [null, undefined, "", "abc", NaN]) {
    assert.equal(formatMoney(v as never), null);
  }
});
test("formatMoney forces 2 decimals + thousand separators (R7 finance convention)", () => {
  assert.equal(formatMoney(0), "৳0.00");
  assert.equal(formatMoney("1500"), "৳1,500.00");
  assert.equal(formatMoney(2000.5, "$"), "$2,000.50");
});

// ─── Proxy path guard (SSRF / traversal) ─────────────────────────────────────
test("isSafeProxyPath rejects traversal / escape segments", () => {
  assert.equal(isSafeProxyPath(["work", "123"]), true);
  assert.equal(isSafeProxyPath(["..", "etc"]), false);
  assert.equal(isSafeProxyPath(["a/b"]), false);
  assert.equal(isSafeProxyPath(["a\\b"]), false);
  assert.equal(isSafeProxyPath([""]), false);
  assert.equal(isSafeProxyPath(["."]), false);
});

// ─── CSRF guard ──────────────────────────────────────────────────────────────
test("isAllowedRequest allows safe methods regardless of origin", () => {
  assert.equal(isAllowedRequest("GET", "https://app", null, null), true);
  assert.equal(isAllowedRequest("HEAD", "https://app", "https://evil", "cross-site"), true);
});
test("isAllowedRequest blocks cross-site state-changing requests", () => {
  assert.equal(isAllowedRequest("POST", "https://app", "https://evil", "cross-site"), false);
  assert.equal(isAllowedRequest("POST", "https://app", "https://evil", null), false);
  assert.equal(isAllowedRequest("DELETE", "https://app", null, null), false); // no signal → deny
});
test("isAllowedRequest allows same-origin state-changing requests", () => {
  assert.equal(isAllowedRequest("POST", "https://app", "https://app", "same-origin"), true);
  assert.equal(isAllowedRequest("PATCH", "https://app", "https://app", null), true);
});
