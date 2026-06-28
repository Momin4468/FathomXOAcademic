import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, API_URL, REFRESH_COOKIE } from "@/lib/config";
import { isAllowedRequest } from "@/lib/proxy-guard";
import { refreshTokens, setAuthCookies } from "@/lib/server-auth";

/**
 * Multipart upload seam. The JSON proxy can't carry files, so this dedicated
 * route forwards multipart/form-data to the API's POST /files, attaching the
 * access token from the httpOnly cookie (refreshing once on 401). Same-origin
 * only (CSRF), exactly like the proxy.
 */
export async function POST(req: NextRequest) {
  if (!isAllowedRequest(req.method, req.nextUrl.origin, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ message: "Cross-site request blocked" }, { status: 403 });
  }
  const form = await req.formData(); // parsed into memory; reusable across the retry

  const c = await cookies();
  const access = c.get(ACCESS_COOKIE)?.value;
  const refresh = c.get(REFRESH_COOKIE)?.value;

  // Let fetch set the multipart boundary; only attach auth.
  const send = (token: string | undefined) =>
    fetch(`${API_URL}/files`, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: form,
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
