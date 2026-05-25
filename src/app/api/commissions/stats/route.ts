import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { getCommissionStats } from "@/lib/commissions";
import { logError } from "@/lib/logger";

export async function GET() {
  try {
    await requireUser();
    const stats = await getCommissionStats();
    return NextResponse.json(stats);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logError("api.commissions.stats", error);
    return NextResponse.json(
      { error: "No se pudieron cargar las estadísticas de comisiones." },
      { status: 500 },
    );
  }
}
