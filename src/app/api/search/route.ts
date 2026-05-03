import { NextRequest, NextResponse } from "next/server";
import { globalSearch } from "@/lib/search";
import { logError } from "@/lib/logger";
import { AuthError, requireUser } from "@/lib/auth";

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
