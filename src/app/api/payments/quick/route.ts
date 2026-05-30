import { NextRequest, NextResponse } from "next/server";
import { createPayment } from "@/app/(dashboard)/payments/actions";
import { AuthError, requireUser } from "@/lib/auth";
import { logError } from "@/lib/logger";
import { assertSameOrigin, checkRateLimit, getRequestIp } from "@/lib/request-guards";

export async function POST(request: NextRequest) {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  try {
    assertSameOrigin(request, "quick payment");
    const rateLimit = checkRateLimit(`quick-payment:${getRequestIp(request)}`, {
      limit: 20,
      windowMs: 15 * 60 * 1000,
    });
    if (!rateLimit.allowed) {
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
