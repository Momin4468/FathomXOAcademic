/** Server-only config. API_URL is never exposed to the browser. */
export const API_URL = process.env.API_URL ?? "http://localhost:3001";

export const ACCESS_COOKIE = "bos_access";
export const REFRESH_COOKIE = "bos_refresh";

// Personal-finance plane (§11) — SEPARATE cookies so the PF session is fully
// independent of the business session (a different login, different tokens).
export const PF_ACCESS_COOKIE = "pf_access";
export const PF_REFRESH_COOKIE = "pf_refresh";
