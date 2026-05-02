import { NextRequest, NextResponse } from "next/server";
import { createPayment } from "@/app/(dashboard)/payments/actions";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate required fields
    if (!body.receiptId || !body.amount || !body.paidDate || !body.paymentMethod) {
      return NextResponse.json(
        { error: "Faltan campos requeridos" },
        { status: 400 }
      );
    }

    // Create payment
    const payment = await createPayment({
      receiptId: body.receiptId,
      amount: body.amount,
      paidDate: body.paidDate,
      paymentMethod: body.paymentMethod,
      reference: body.reference,
      notes: body.notes,
    });

    return NextResponse.json({
      success: true,
      payment,
    });
  } catch (error) {
    console.error("Quick payment API error:", error);
    
    return NextResponse.json(
      { error: "Error al procesar el pago" },
      { status: 500 }
    );
  }
}
