import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createPayment } from "@/app/(dashboard)/payments/actions";
import { AuthError, requireUser } from "@/lib/auth";
import { logError } from "@/lib/logger";
import { assertSameOrigin, checkDistributedRateLimit, getRequestIp, readJsonBody, securityFingerprint } from "@/lib/request-guards";
import { rateLimitResponse, guardErrorResponse } from "@/lib/api-security";
import { recordSecurityAccessDenied, recordSecurityRateLimit, SECURITY_EVENT_TYPES } from "@/lib/security-events";

const quickPaymentSchema = z.object({
  receiptId: z.string().min(1),
  amount: z.number().positive(),
  paidDate: z.string().min(1),
  paymentMethod: z.string().min(1),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof AuthError) {
      await recordSecurityAccessDenied({
        alertType: SECURITY_EVENT_TYPES.accessDenied,
        title: "Pago rápido sin sesión válida",
        description: "Se intentó registrar un pago rápido sin una sesión válida.",
        severity: "WARNING",
        entityType: "SecurityEvent",
        entityId: "quick-payment:auth",
      });
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  try {
    try {
      assertSameOrigin(request, "quick payment");
    } catch {
      await recordSecurityAccessDenied({
        alertType: SECURITY_EVENT_TYPES.sameOriginBlocked,
        title: "Pago rápido bloqueado por same-origin",
        description: "Se intentó registrar un pago desde un origen no permitido.",
        severity: "WARNING",
        entityType: "SecurityEvent",
        entityId: "quick-payment:same-origin",
      });
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    const rateLimit = await checkDistributedRateLimit(`quick-payment:${securityFingerprint(`ip:${getRequestIp(request)}`)}`, {
      limit: 20,
      windowMs: 15 * 60 * 1000,
      requireDistributed: true,
    });
    if (!rateLimit.allowed) {
      await recordSecurityRateLimit({
        alertType: SECURITY_EVENT_TYPES.rateLimitedRequest,
        title: "Límite de pagos rápidos alcanzado",
        description: "Se bloqueó un pago rápido por exceso de intentos.",
        severity: "WARNING",
        entityType: "SecurityEvent",
        entityId: "quick-payment:rate-limit",
      });
      return rateLimitResponse(rateLimit, "Demasiados intentos. Espera un momento e inténtalo de nuevo.");
    }

    const body = quickPaymentSchema.parse(await readJsonBody(request, 16 * 1024));

    const result = await createPayment({
      receiptId: body.receiptId,
      amount: body.amount,
      paidDate: body.paidDate,
      paymentMethod: body.paymentMethod,
      reference: body.reference,
      notes: body.notes,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      paymentId: result.id,
      redirectTo: result.redirectTo,
      message: result.message,
    });
  } catch (error) {
    if (error instanceof Error && "status" in error) return guardErrorResponse(error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Faltan campos requeridos o tienen un formato inválido." }, { status: 400 });
    }
    logError("api.payments.quick", error);
    return NextResponse.json({ error: "Error al procesar el pago" }, { status: 500 });
  }
}
