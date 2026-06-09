import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAdmin } from "@/lib/auth";
import { updateCommissionStatus } from "@/lib/commissions";
import { logError } from "@/lib/logger";
import { COMMISSION_STATUSES, type CommissionStatus } from "@/lib/domain-values";
import { assertSameOrigin } from "@/lib/request-guards";

const VALID_STATUSES: readonly CommissionStatus[] = COMMISSION_STATUSES;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;

  try {
    await requireAdmin();
    assertSameOrigin(request, "commission status update");
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error) {
      logError("api.commissions.status.origin", error, { commissionId: params.id });
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    throw error;
  }

  try {
    const body = await request.json();
    const { status, actualAmount } = body;

    if (!status || typeof status !== "string") {
      return NextResponse.json(
        { error: "El estado es obligatorio." },
        { status: 400 },
      );
    }

    if (!VALID_STATUSES.includes(status as CommissionStatus)) {
      return NextResponse.json(
        { error: `Estado inválido. Debe ser uno de: ${VALID_STATUSES.join(", ")}` },
        { status: 400 },
      );
    }

    const result = await updateCommissionStatus(
      params.id,
      status as CommissionStatus,
      typeof actualAmount === "number" ? actualAmount : undefined,
    );

    if (!result.ok) {
      const statusCode = result.error?.includes("no existe") ? 404 : 400;
      return NextResponse.json({ error: result.error }, { status: statusCode });
    }

    return NextResponse.json({
      success: true,
      commissionId: result.id,
      redirectTo: result.redirectTo,
    });
  } catch (error) {
    logError("api.commissions.status", error, { commissionId: params.id });
    return NextResponse.json(
      { error: "No se pudo actualizar el estado de la comisión." },
      { status: 500 },
    );
  }
}
