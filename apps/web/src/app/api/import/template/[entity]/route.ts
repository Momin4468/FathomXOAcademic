import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, API_URL, REFRESH_COOKIE } from "@/lib/config";
import { refreshTokens, setAuthCookies } from "@/lib/server-auth";

/** Streams the per-entity template CSV (with its download filename header). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ entity: string }> }) {
  const { entity } = await ctx.params;
  if (!/^[a-z_]+$/.test(entity)) return NextResponse.json({ message: "Invalid entity" }, { status: 400 });
  const c = await cookies();
  const access = c.get(ACCESS_COOKIE)?.value;
  const refresh = c.get(REFRESH_COOKIE)?.value;
  const send = (token: string | undefined) =>
    fetch(`${API_URL}/import/template/${encodeURIComponent(entity)}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
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
    headers: {
      "content-type": res.headers.get("content-type") ?? "text/csv",
      ...(res.headers.get("content-disposition") ? { "content-disposition": res.headers.get("content-disposition") as string } : {}),
    },
  });
}
