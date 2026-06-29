import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { API_URL, CLIENT_REFRESH_COOKIE } from "@/lib/config";
import { clearClientAuthCookies } from "@/lib/client-server-auth";

export async function POST() {
  const refreshToken = (await cookies()).get(CLIENT_REFRESH_COOKIE)?.value;
  if (refreshToken) {
    await fetch(`${API_URL}/client/auth/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined);
  }
  await clearClientAuthCookies();
  return NextResponse.json({ ok: true });
}
