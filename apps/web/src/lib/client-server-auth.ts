import "server-only";
import { cookies } from "next/headers";
import { API_URL, CLIENT_ACCESS_COOKIE, CLIENT_REFRESH_COOKIE } from "./config";

const TEN_DAYS = 60 * 60 * 24 * 10;
const COOKIE_BASE = {
  httpOnly: true as const, // client tokens never reachable by client JS (XSS-safe)
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};

/** Store the client token pair as separate httpOnly cookies (independent session). */
export async function setClientAuthCookies(accessToken: string, refreshToken: string): Promise<void> {
  const c = await cookies();
  c.set(CLIENT_ACCESS_COOKIE, accessToken, { ...COOKIE_BASE, maxAge: TEN_DAYS });
  c.set(CLIENT_REFRESH_COOKIE, refreshToken, { ...COOKIE_BASE, maxAge: TEN_DAYS });
}

export async function clearClientAuthCookies(): Promise<void> {
  const c = await cookies();
  c.delete(CLIENT_ACCESS_COOKIE);
  c.delete(CLIENT_REFRESH_COOKIE);
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Single-flight client refresh (client tokens rotate; reuse is treated as theft). */
const inflight = new Map<string, Promise<TokenPair | null>>();

export function refreshClientTokens(refreshToken: string): Promise<TokenPair | null> {
  const existing = inflight.get(refreshToken);
  if (existing) return existing;
  const p = (async (): Promise<TokenPair | null> => {
    try {
      const r = await fetch(`${API_URL}/client/auth/refresh`, {
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
