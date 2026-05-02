import { NextRequest, NextResponse } from "next/server";
import { createPayment } from "@/app/(dashboard)/payments/actions";
import { logError } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
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
