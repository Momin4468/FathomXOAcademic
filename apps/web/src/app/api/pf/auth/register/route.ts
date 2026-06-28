import { NextResponse } from "next/server";
import { API_URL } from "@/lib/config";
import { setPfAuthCookies } from "@/lib/pf-server-auth";

/** PF self-service registration; on success stores PF tokens as httpOnly cookies. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${API_URL}/pf/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Registration failed" }));
    return NextResponse.json(err, { status: res.status });
  }
  const { accessToken, refreshToken } = await res.json();
  await setPfAuthCookies(accessToken, refreshToken);
  return NextResponse.json({ ok: true });
}
