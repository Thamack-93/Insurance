import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { requireOrganizationRole } from "@/lib/organization-context";
import { getCommissionStats } from "@/lib/commissions";
import { logError } from "@/lib/logger";

export async function GET() {
  try {
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
    const stats = await getCommissionStats(undefined, context);
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
