import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { API_URL, PF_ACCESS_COOKIE, PF_REFRESH_COOKIE } from "@/lib/config";
import { isAllowedRequest, isSafeProxyPath } from "@/lib/proxy-guard";
import { refreshPfTokens, setPfAuthCookies } from "@/lib/pf-server-auth";

/**
 * The PERSONAL-FINANCE BFF seam (§11). Mirrors the business proxy but uses the
 * separate PF cookies and targets the API's /pf/* routes — so the PF session is
 * fully independent (a business cookie can never reach PF data, and vice versa).
 * Refreshes the PF token once on a 401.
 */
async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (!isSafeProxyPath(path)) {
    return NextResponse.json({ message: "Invalid path" }, { status: 400 });
  }
  if (!isAllowedRequest(req.method, req.nextUrl.origin, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ message: "Cross-site request blocked" }, { status: 403 });
  }
  // Target is always under /pf/ — clients pass the path WITHOUT the pf/ prefix.
  const target = `${API_URL}/pf/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;

  const c = await cookies();
  const access = c.get(PF_ACCESS_COOKIE)?.value;
  const refresh = c.get(PF_REFRESH_COOKIE)?.value;
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
    const pair = await refreshPfTokens(refresh);
    if (pair) {
      await setPfAuthCookies(pair.accessToken, pair.refreshToken);
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
