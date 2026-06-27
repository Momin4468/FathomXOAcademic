import "server-only";
import { cookies } from "next/headers";
import { ACCESS_COOKIE, API_URL, REFRESH_COOKIE } from "./config";

const TEN_DAYS = 60 * 60 * 24 * 10;
const COOKIE_BASE = {
  httpOnly: true as const, // tokens are never reachable by client JS (XSS-safe)
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};

export async function setAuthCookies(accessToken: string, refreshToken: string): Promise<void> {
  const c = await cookies();
  c.set(ACCESS_COOKIE, accessToken, { ...COOKIE_BASE, maxAge: TEN_DAYS });
  c.set(REFRESH_COOKIE, refreshToken, { ...COOKIE_BASE, maxAge: TEN_DAYS });
}

export async function clearAuthCookies(): Promise<void> {
  const c = await cookies();
  c.delete(ACCESS_COOKIE);
  c.delete(REFRESH_COOKIE);
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Single-flight refresh. Our refresh tokens ROTATE and reuse is treated as theft
 * (the family is revoked). If several proxy calls 401 at once they must not each
 * spend the same refresh token — that would trip reuse-detection and log the user
 * out. Dedupe concurrent refreshes for the same token within this process.
 */
const inflight = new Map<string, Promise<TokenPair | null>>();

export function refreshTokens(refreshToken: string): Promise<TokenPair | null> {
  const existing = inflight.get(refreshToken);
  if (existing) return existing;
  const p = (async (): Promise<TokenPair | null> => {
    try {
      const r = await fetch(`${API_URL}/auth/refresh`, {
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
