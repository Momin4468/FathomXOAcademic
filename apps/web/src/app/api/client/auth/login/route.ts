import { NextResponse } from "next/server";
import { API_URL } from "@/lib/config";
import { setClientAuthCookies } from "@/lib/client-server-auth";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${API_URL}/client/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Login failed" }));
    return NextResponse.json(err, { status: res.status });
  }
  const { accessToken, refreshToken } = await res.json();
  await setClientAuthCookies(accessToken, refreshToken);
  return NextResponse.json({ ok: true });
}
