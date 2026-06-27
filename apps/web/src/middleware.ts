import { NextResponse, type NextRequest } from "next/server";
import { REFRESH_COOKIE } from "@/lib/config";

/**
 * Gate: no session cookie → bounce to /login. This is a UX guard only; the API
 * (RLS + guards) is the real authority. Excludes /login, /api/*, and Next internals.
 */
export function middleware(req: NextRequest) {
  if (req.cookies.has(REFRESH_COOKIE)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api|_next/static|_next/image|favicon.ico).*)"],
};
