import { NextResponse, type NextRequest } from "next/server";
import { embedFrameAncestors } from "@/server/embed-policy";

const SESSION_COOKIE = "gw_session";

/**
 * Two things. An optimistic redirect from the presence of the cookie: every API route checks the session
 * and the role for itself, so nothing is protected by that. And which sites may frame a widget, the one
 * response header that depends on stored data.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/embed/")) {
    const response = NextResponse.next();
    response.headers.set("Content-Security-Policy", await embedFrameAncestors(pathname.slice("/embed/".length)));
    return response;
  }
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(`${pathname}${search}`)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/dashboard/:path*", "/onboarding", "/embed/:path*"] };
