import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { API_URL, PF_ACCESS_COOKIE, PF_REFRESH_COOKIE } from "@/lib/config";
import { refreshPfTokens, setPfAuthCookies } from "@/lib/pf-server-auth";

/**
 * PF binary-safe download seam (§11). Forwards GET /pf/attachments/:id/download
 * to the API with the PF Bearer cookie and streams the body straight back. Link
 * attachments are opened directly from their metadata URL (never relayed — that
 * would be an open redirect). Mirrors the business /api/files/[id].
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    return NextResponse.json({ message: "Invalid id" }, { status: 400 });
  }
  const c = await cookies();
  const access = c.get(PF_ACCESS_COOKIE)?.value;
  const refresh = c.get(PF_REFRESH_COOKIE)?.value;

  const send = (token: string | undefined) =>
    fetch(`${API_URL}/pf/attachments/${encodeURIComponent(id)}/download`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  let res = await send(access);
  if (res.status === 401 && refresh) {
    const pair = await refreshPfTokens(refresh);
    if (pair) {
      await setPfAuthCookies(pair.accessToken, pair.refreshToken);
      res = await send(pair.accessToken);
    }
  }

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
