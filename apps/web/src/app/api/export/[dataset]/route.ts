import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, API_URL, REFRESH_COOKIE } from "@/lib/config";
import { refreshTokens, setAuthCookies } from "@/lib/server-auth";

/** Binary-safe export download — streams the API's CSV/XLSX back with its
 *  content-disposition (a 403 from the dataset's permission gate is relayed). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ dataset: string }> }) {
  const { dataset } = await ctx.params;
  if (!/^[a-z_]+$/.test(dataset)) return NextResponse.json({ message: "Invalid dataset" }, { status: 400 });
  const format = req.nextUrl.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const c = await cookies();
  const access = c.get(ACCESS_COOKIE)?.value;
  const refresh = c.get(REFRESH_COOKIE)?.value;
  const send = (token: string | undefined) =>
    fetch(`${API_URL}/export/${encodeURIComponent(dataset)}?format=${format}`, {
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
  if (!res.ok || !res.body) {
    const msg = await res.text().catch(() => "Export failed");
    return new NextResponse(msg || "Export failed", { status: res.status || 502 });
  }
  return new NextResponse(res.body, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/octet-stream",
      ...(res.headers.get("content-disposition") ? { "content-disposition": res.headers.get("content-disposition") as string } : {}),
    },
  });
}
