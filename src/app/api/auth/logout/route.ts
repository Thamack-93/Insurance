import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/request-guards";

export async function POST(request: Request) {
  assertSameOrigin(request, "logout");
  await clearSessionCookie();
  const url = new URL("/login", request.url);
  return NextResponse.redirect(url, { status: 303 });
}
