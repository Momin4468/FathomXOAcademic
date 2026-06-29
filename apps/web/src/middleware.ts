import { NextResponse, type NextRequest } from "next/server";
import { CLIENT_REFRESH_COOKIE, PF_REFRESH_COOKIE, REFRESH_COOKIE } from "@/lib/config";

/**
 * Gate: no session cookie → bounce to the right login. UX guard only; the API
 * (RLS + guards) is the real authority. The PERSONAL-FINANCE plane (§11) is a
 * SEPARATE session: /personal-finance/* is gated on the PF cookie and its own
 * login/register, never the business cookie. Excludes /login, /api/*, internals.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/personal-finance")) {
    if (pathname === "/personal-finance/login" || pathname === "/personal-finance/register") {
      return NextResponse.next();
    }
    if (req.cookies.has(PF_REFRESH_COOKIE)) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = "/personal-finance/login";
    return NextResponse.redirect(url);
  }

  // Client portal plane (Module 18) — its own session + login.
  if (pathname.startsWith("/portal")) {
    if (pathname === "/portal/login") return NextResponse.next();
    if (req.cookies.has(CLIENT_REFRESH_COOKIE)) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = "/portal/login";
    return NextResponse.redirect(url);
  }

  if (req.cookies.has(REFRESH_COOKIE)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api|_next/static|_next/image|favicon.ico).*)"],
};
