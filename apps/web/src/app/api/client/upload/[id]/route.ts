import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { API_URL, CLIENT_ACCESS_COOKIE, CLIENT_REFRESH_COOKIE } from "@/lib/config";
import { refreshClientTokens, setClientAuthCookies } from "@/lib/client-server-auth";
import { isAllowedRequest } from "@/lib/proxy-guard";

/** Multipart brief-upload seam — forwards the file to /client/requests/:id/brief. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedRequest(req.method, req.nextUrl.origin, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ message: "Cross-site request blocked" }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ message: "Invalid id" }, { status: 400 });
  }
  const form = await req.formData();
  const c = await cookies();
  const access = c.get(CLIENT_ACCESS_COOKIE)?.value;
  const refresh = c.get(CLIENT_REFRESH_COOKIE)?.value;
  const target = `${API_URL}/client/requests/${id}/brief`;
  const send = (token: string | undefined) =>
    fetch(target, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: form });
  let res = await send(access);
  if (res.status === 401 && refresh) {
    const pair = await refreshClientTokens(refresh);
    if (pair) {
      await setClientAuthCookies(pair.accessToken, pair.refreshToken);
      res = await send(pair.accessToken);
    }
  }
  const text = await res.text();
  return new NextResponse(text, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
}
