import { NextResponse } from "next/server";
import { AuthError, requireAdmin } from "@/lib/auth";
import { getCommissionStats } from "@/lib/commissions";
import { logError } from "@/lib/logger";

export async function GET() {
  try {
    await requireAdmin();
    const stats = await getCommissionStats();
    return NextResponse.json(stats);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status });
    }
    logError("api.commissions.stats", error);
    return NextResponse.json(
      { error: "No se pudieron cargar las estadísticas de comisiones." },
      { status: 500 },
    );
  }
}
