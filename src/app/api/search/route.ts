import { NextRequest, NextResponse } from "next/server";
import { globalSearch } from "@/lib/search";
import { logError } from "@/lib/logger";
import { AuthError, requireUser } from "@/lib/auth";
import { checkDistributedRateLimit, getRequestIp, securityFingerprint } from "@/lib/request-guards";
import { rateLimitResponse } from "@/lib/api-security";

export async function GET(request: NextRequest) {
  let query = "";
  try {
    // Reject inactive/unauthenticated users on every search request.
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    query = searchParams.get("q") ?? "";
    const scope = searchParams.get("scope");

    if (query.length > 1000) {
      return NextResponse.json({ error: "La búsqueda es demasiado larga." }, { status: 413 });
    }
    const rateLimit = await checkDistributedRateLimit(`search:${securityFingerprint(`ip:${getRequestIp(request)}`)}`, {
      limit: 60,
      windowMs: 60 * 1000,
    });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit, "Demasiadas búsquedas.");

    if (!query || !query.trim()) {
      return NextResponse.json([]);
    }

    const results = await globalSearch(query, user.role === "ADMIN" && scope === "all" ? undefined : user.id);
    return NextResponse.json(results);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.status >= 500 ? error.message : "No autorizado.", ...(error.code ? { code: error.code } : {}) }, { status: error.status });
    }
    logError("api.search", error, { query });
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
