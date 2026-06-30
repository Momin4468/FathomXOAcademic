import { NextResponse } from "next/server";
import { API_URL } from "@/lib/config";

/** Forwards a forgot-password request to NestJS. No session/cookies; the API
 *  always responds generically (no account enumeration). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${API_URL}/auth/request-reset`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": req.headers.get("x-forwarded-for") ?? "",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
