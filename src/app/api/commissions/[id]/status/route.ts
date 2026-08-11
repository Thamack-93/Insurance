import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAdmin } from "@/lib/auth";
import { updateCommissionStatus } from "@/lib/commissions";
import { logError } from "@/lib/logger";
import { COMMISSION_STATUSES, type CommissionStatus } from "@/lib/domain-values";
import { assertSameOrigin, checkDistributedRateLimit, readJsonBody, securityFingerprint, getRequestIp } from "@/lib/request-guards";
import { rateLimitResponse, guardErrorResponse } from "@/lib/api-security";
import { recordSecurityAccessDenied, SECURITY_EVENT_TYPES } from "@/lib/security-events";

const VALID_STATUSES: readonly CommissionStatus[] = COMMISSION_STATUSES;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;

  try {
    await requireAdmin();
    try {
      assertSameOrigin(request, "commission status update");
    } catch {
      await recordSecurityAccessDenied({
        alertType: SECURITY_EVENT_TYPES.sameOriginBlocked,
        title: "Actualización de comisión bloqueada por same-origin",
        description: "Se intentó cambiar el estado de una comisión desde un origen no permitido.",
        severity: "WARNING",
        entityType: "SecurityEvent",
        entityId: `commission-status:same-origin:${params.id}`,
      });
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.status >= 500) return guardErrorResponse(error);
      await recordSecurityAccessDenied({
        alertType: SECURITY_EVENT_TYPES.accessDenied,
        title: "Actualización de comisión sin permisos",
        description: "Se intentó cambiar el estado de una comisión sin permisos de administrador.",
        severity: "WARNING",
        entityType: "SecurityEvent",
        entityId: `commission-status:auth:${params.id}`,
      });
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error) {
      logError("api.commissions.status.origin", error, { commissionId: params.id });
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    throw error;
  }

  try {
    const rateLimit = await checkDistributedRateLimit(`commission-status:${params.id}:${securityFingerprint(`ip:${getRequestIp(request)}`)}`, {
      limit: 20,
      windowMs: 15 * 60 * 1000,
      requireDistributed: true,
    });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

    const body = await readJsonBody<Record<string, unknown>>(request, 16 * 1024);
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
    if (error instanceof Error && "status" in error) return guardErrorResponse(error);
    logError("api.commissions.status", error, { commissionId: params.id });
    return NextResponse.json(
      { error: "No se pudo actualizar el estado de la comisión." },
      { status: 500 },
    );
  }
}
