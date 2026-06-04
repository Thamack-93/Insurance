import { NextRequest, NextResponse } from "next/server";
import { globalSearch } from "@/lib/search";
import { logError } from "@/lib/logger";
import { AuthError, requireUser } from "@/lib/auth";
import { checkRateLimit, getRequestIp } from "@/lib/request-guards";

export async function GET(request: NextRequest) {
  let query = "";
  try {
    // Reject inactive/unauthenticated users on every search request.
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    query = searchParams.get("q") ?? "";

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

    const results = await globalSearch(query, user.role === "ADMIN" ? undefined : user.id);
    return NextResponse.json(results);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: "No autorizado." }, { status: error.status });
    }
    logError("api.search", error, { query });
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
