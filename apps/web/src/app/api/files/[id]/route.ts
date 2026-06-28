import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, API_URL, REFRESH_COOKIE } from "@/lib/config";
import { refreshTokens, setAuthCookies } from "@/lib/server-auth";

/**
 * Binary-safe download seam. Forwards GET /files/:id/download to the API with the
 * Bearer from the httpOnly cookie and streams the response body straight back
 * (never .text(), which would corrupt binary). A link file answers 302 → relay
 * the redirect so the browser goes to the external URL directly.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    return NextResponse.json({ message: "Invalid id" }, { status: 400 });
  }
  const c = await cookies();
  const access = c.get(ACCESS_COOKIE)?.value;
  const refresh = c.get(REFRESH_COOKIE)?.value;

  const send = (token: string | undefined) =>
    fetch(`${API_URL}/files/${encodeURIComponent(id)}/download`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  let res = await send(access);
  if (res.status === 401 && refresh) {
    const pair = await refreshTokens(refresh);
    if (pair) {
      await setAuthCookies(pair.accessToken, pair.refreshToken);
      res = await send(pair.accessToken);
    }
  }

  // Stored files only (link files are opened directly from their metadata URL,
  // never relayed here — that would be an open redirect from our own origin).
  if (!res.ok || !res.body) {
    return NextResponse.json({ message: "Download failed" }, { status: res.status || 502 });
  }
  return new NextResponse(res.body, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/octet-stream",
      ...(res.headers.get("content-disposition")
        ? { "content-disposition": res.headers.get("content-disposition") as string }
        : {}),
    },
  });
}
