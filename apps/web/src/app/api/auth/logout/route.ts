import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_URL, REFRESH_COOKIE } from "@/lib/config";
import { clearAuthCookies } from "@/lib/server-auth";

/** Revokes the refresh token server-side and clears cookies. */
export async function POST() {
  const refreshToken = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    await fetch(`${API_URL}/auth/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined);
  }
  await clearAuthCookies();
  return NextResponse.json({ ok: true });
}
