import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { API_URL, PF_ACCESS_COOKIE, PF_REFRESH_COOKIE } from "@/lib/config";
import { isAllowedRequest } from "@/lib/proxy-guard";
import { refreshPfTokens, setPfAuthCookies } from "@/lib/pf-server-auth";

/**
 * PF multipart upload seam (§11). The JSON proxy can't carry files, so this
 * dedicated route forwards multipart/form-data to the API's
 * POST /pf/notes/:noteId/attachments using the PF session cookies (refreshing
 * once on 401). Same-origin only (CSRF). Mirrors the business /api/upload.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ noteId: string }> }) {
  if (!isAllowedRequest(req.method, req.nextUrl.origin, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ message: "Cross-site request blocked" }, { status: 403 });
  }
  const { noteId } = await ctx.params;
  if (!/^[0-9a-fA-F-]{36}$/.test(noteId)) {
    return NextResponse.json({ message: "Invalid id" }, { status: 400 });
  }
  const form = await req.formData();

  const c = await cookies();
  const access = c.get(PF_ACCESS_COOKIE)?.value;
  const refresh = c.get(PF_REFRESH_COOKIE)?.value;

  const send = (token: string | undefined) =>
    fetch(`${API_URL}/pf/notes/${encodeURIComponent(noteId)}/attachments`, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: form,
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
