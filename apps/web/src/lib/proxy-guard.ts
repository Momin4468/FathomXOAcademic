/** Pure guards for the BFF proxy (unit-tested; no Next/server imports). */

/** Reject path segments that could escape the API base (SSRF / traversal). */
export function isSafeProxyPath(path: string[]): boolean {
  return path.every((p) => p !== "" && p !== "." && p !== ".." && !p.includes("/") && !p.includes("\\"));
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF guard: a state-changing request must be same-origin. SameSite=Lax still
 * allows cross-site top-level form POSTs, so we additionally require the Origin
 * header (or Sec-Fetch-Site) to match the app's own origin. Safe methods pass.
 */
export function isAllowedRequest(method: string, appOrigin: string, origin: string | null, secFetchSite: string | null): boolean {
  if (!UNSAFE_METHODS.has(method.toUpperCase())) return true;
  if (secFetchSite) return secFetchSite === "same-origin";
  return origin === appOrigin; // no Sec-Fetch-Site → fall back to strict Origin match
}
