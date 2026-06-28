import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { API_URL, PF_REFRESH_COOKIE } from "@/lib/config";
import { clearPfAuthCookies } from "@/lib/pf-server-auth";

/** Revokes the PF refresh token server-side and clears PF cookies. */
export async function POST() {
  const refreshToken = (await cookies()).get(PF_REFRESH_COOKIE)?.value;
  if (refreshToken) {
    await fetch(`${API_URL}/pf/auth/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined);
  }
  await clearPfAuthCookies();
  return NextResponse.json({ ok: true });
}
