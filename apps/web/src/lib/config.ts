/** Server-only config. API_URL is never exposed to the browser. */
export const API_URL = process.env.API_URL ?? "http://localhost:3001";

export const ACCESS_COOKIE = "bos_access";
export const REFRESH_COOKIE = "bos_refresh";
