import { NextRequest, NextResponse } from "next/server";
import { globalSearch } from "@/lib/search";
import { logError } from "@/lib/logger";
import { AuthError, requireUser } from "@/lib/auth";
import { checkRateLimit, getRequestIp } from "@/lib/request-guards";

export async function GET(request: NextRequest) {
  // Reject inactive/unauthenticated users on every search request.
  try {
    await requireUser();
  } catch (authErr) {
    if (authErr instanceof AuthError) {
      return NextResponse.json({ error: "No autorizado." }, { status: authErr.status });
    }
    throw authErr;
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");

  const rateLimit = checkRateLimit(`search:${getRequestIp(request)}`, {
    limit: 60,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Demasiadas búsquedas. Intenta de nuevo en un momento." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000))) },
      },
    );
  }

  if (!query || !query.trim()) {
    return NextResponse.json([]);
  }

  try {
    const results = await globalSearch(query);
    return NextResponse.json(results);
  } catch (error) {
    logError("api.search", error, { query });
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
