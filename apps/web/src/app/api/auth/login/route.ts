import { NextResponse } from "next/server";
import { API_URL } from "@/lib/config";
import { setAuthCookies } from "@/lib/server-auth";

/** Logs in against NestJS and stores tokens as httpOnly cookies. No token in the body. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Login failed" }));
    return NextResponse.json(err, { status: res.status });
  }
  const { accessToken, refreshToken } = await res.json();
  await setAuthCookies(accessToken, refreshToken);

  // Return the principal (handy for the client) — never the tokens.
  const me = await fetch(`${API_URL}/auth/me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const principal = me.ok ? (await me.json()).principal : null;
  return NextResponse.json({ principal });
}
