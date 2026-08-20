import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";

const PUBLIC_PREFIXES = [
  "/login",
  // API handlers own their authentication response; do not turn 401/403
  // responses into a page redirect that Playwright (or API clients) follows.
  "/api",
  "/api/auth",
  "/api/integrations/telegram/webhook",
  "/_next",
  "/favicon",
  "/public",
  "/api/jobs/backup",
  "/api/jobs/telegram-digest",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionToken(token);

  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  if (session.mustChangePassword) {
    const allowed = (pathname === "/settings/account" && session.platformRole !== "SUPERADMIN") || (session.platformRole === "SUPERADMIN" && pathname === "/platform");
    if (!allowed) {
      const url = request.nextUrl.clone();
      url.pathname = session.platformRole === "SUPERADMIN" ? "/platform" : "/settings/account";
      url.search = "";
      url.searchParams.set("forcePassword", "1");
      return NextResponse.redirect(url);
    }
  }

  if (session.platformRole === "SUPERADMIN" && !session.organizationId && pathname !== "/platform" && !pathname.startsWith("/platform/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/platform";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|favicon.svg|login|api(?:/|$)).*)",
  ],
};
