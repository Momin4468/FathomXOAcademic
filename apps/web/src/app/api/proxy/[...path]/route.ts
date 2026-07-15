import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, API_URL, REFRESH_COOKIE } from "@/lib/config";
import { isAllowedRequest, isSafeProxyPath } from "@/lib/proxy-guard";
import { refreshTokens, setAuthCookies } from "@/lib/server-auth";

/**
 * The single seam the browser uses to reach the API. Attaches the access token
 * (from the httpOnly cookie) as a Bearer header; on a 401 it refreshes once and
 * retries. Tokens never leave the server. Only paths under API_URL are reachable
 * (no SSRF: the base host is fixed and '..' segments are rejected).
 */
async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (!isSafeProxyPath(path)) {
    return NextResponse.json({ message: "Invalid path" }, { status: 400 });
  }
  // CSRF: state-changing requests must be same-origin (Lax cookies allow cross-
  // site top-level form POSTs, so verify Origin / Sec-Fetch-Site explicitly).
  if (!isAllowedRequest(req.method, req.nextUrl.origin, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ message: "Cross-site request blocked" }, { status: 403 });
  }
  const target = `${API_URL}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;

  const c = await cookies();
  const access = c.get(ACCESS_COOKIE)?.value;
  const refresh = c.get(REFRESH_COOKIE)?.value;
  // "View as" preview: the SuperAdmin's chosen target party (a plain UI cookie).
  // Forwarded as x-view-as on EVERY request so the API can scope reads to it AND
  // reject writes while it's active. The API only honors it for a SuperAdmin, so a
  // forged cookie from anyone else is inert.
  const viewAs = c.get("view-as")?.value;
  const bodyText =
    req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();

  const send = (token: string | undefined) =>
    fetch(target, {
      method: req.method,
      // The BFF speaks JSON to the API regardless of the inbound content-type.
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(viewAs ? { "x-view-as": viewAs } : {}),
      },
      body: bodyText,
      redirect: "manual",
    });

  let res = await send(access);
  if (res.status === 401 && refresh) {
    const pair = await refreshTokens(refresh);
    if (pair) {
      await setAuthCookies(pair.accessToken, pair.refreshToken);
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
