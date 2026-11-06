import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "gw_session";

/**
 * An optimistic redirect only, from the presence of the cookie. Every API route checks the session
 * and the role for itself, so nothing is protected by this file.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const url = request.nextUrl.clone();
  const next = `${url.pathname}${url.search}`;
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/dashboard/:path*", "/onboarding"] };
