import { NextRequest, NextResponse } from "next/server";
import { createPayment } from "@/app/(dashboard)/payments/actions";
import { AuthError, requireUser } from "@/lib/auth";
import { logError } from "@/lib/logger";
import { assertSameOrigin, checkRateLimit, getRequestIp } from "@/lib/request-guards";
import { recordSecurityAccessDenied, recordSecurityRateLimit, SECURITY_EVENT_TYPES } from "@/lib/security-events";

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
    const rateLimit = checkRateLimit(`quick-payment:${getRequestIp(request)}`, {
      limit: 20,
      windowMs: 15 * 60 * 1000,
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
      return NextResponse.json(
        { error: "Demasiados intentos. Espera un momento e inténtalo de nuevo." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000))) },
        },
      );
    }

    const body = await request.json();

    if (!body.receiptId || !body.amount || !body.paidDate || !body.paymentMethod) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
    }

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
    logError("api.payments.quick", error);
    return NextResponse.json({ error: "Error al procesar el pago" }, { status: 500 });
  }
}
