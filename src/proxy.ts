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

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|favicon.svg|login|api(?:/|$)).*)",
  ],
};
