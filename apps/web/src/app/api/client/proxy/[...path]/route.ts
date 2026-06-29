import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { API_URL, CLIENT_ACCESS_COOKIE, CLIENT_REFRESH_COOKIE } from "@/lib/config";
import { refreshClientTokens, setClientAuthCookies } from "@/lib/client-server-auth";
import { isAllowedRequest, isSafeProxyPath } from "@/lib/proxy-guard";

/**
 * Client-portal BFF proxy (Module 18). Forwards to the API under /client/*, with
 * the client token from the httpOnly cookie; refreshes once on 401. CSRF-guarded
 * (same-origin for unsafe methods). The token never reaches the browser.
 */
async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (!isSafeProxyPath(path)) {
    return NextResponse.json({ message: "Invalid path" }, { status: 400 });
  }
  if (!isAllowedRequest(req.method, req.nextUrl.origin, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ message: "Cross-site request blocked" }, { status: 403 });
  }
  // Target is always under /client/ — clients pass the path WITHOUT the prefix.
  const target = `${API_URL}/client/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;

  const c = await cookies();
  const access = c.get(CLIENT_ACCESS_COOKIE)?.value;
  const refresh = c.get(CLIENT_REFRESH_COOKIE)?.value;
  const bodyText = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();

  const send = (token: string | undefined) =>
    fetch(target, {
      method: req.method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: bodyText,
      redirect: "manual",
    });

  let res = await send(access);
  if (res.status === 401 && refresh) {
    const pair = await refreshClientTokens(refresh);
    if (pair) {
      await setClientAuthCookies(pair.accessToken, pair.refreshToken);
      res = await send(pair.accessToken);
    }
  }

  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
  });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
