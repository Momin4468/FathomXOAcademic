import "server-only";
import { cookies } from "next/headers";
import { API_URL, PF_ACCESS_COOKIE, PF_REFRESH_COOKIE } from "./config";

const TEN_DAYS = 60 * 60 * 24 * 10;
const COOKIE_BASE = {
  httpOnly: true as const, // PF tokens never reachable by client JS (XSS-safe)
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};

/** Store the PF token pair as separate httpOnly cookies (independent session). */
export async function setPfAuthCookies(accessToken: string, refreshToken: string): Promise<void> {
  const c = await cookies();
  c.set(PF_ACCESS_COOKIE, accessToken, { ...COOKIE_BASE, maxAge: TEN_DAYS });
  c.set(PF_REFRESH_COOKIE, refreshToken, { ...COOKIE_BASE, maxAge: TEN_DAYS });
}

export async function clearPfAuthCookies(): Promise<void> {
  const c = await cookies();
  c.delete(PF_ACCESS_COOKIE);
  c.delete(PF_REFRESH_COOKIE);
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Single-flight PF refresh (PF tokens rotate; reuse is treated as theft). */
const inflight = new Map<string, Promise<TokenPair | null>>();

export function refreshPfTokens(refreshToken: string): Promise<TokenPair | null> {
  const existing = inflight.get(refreshToken);
  if (existing) return existing;
  const p = (async (): Promise<TokenPair | null> => {
    try {
      const r = await fetch(`${API_URL}/pf/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      return r.ok ? ((await r.json()) as TokenPair) : null;
    } catch {
      return null;
    } finally {
      inflight.delete(refreshToken);
    }
  })();
  inflight.set(refreshToken, p);
  return p;
}
