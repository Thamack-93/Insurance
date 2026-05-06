import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { CommissionStatus } from "@/generated/prisma/client";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  try {
    const { status } = await request.json();
    
    if (!status || typeof status !== "string") {
      return NextResponse.json(
        { error: "Status is required and must be a string" },
        { status: 400 }
      );
    }

    // Validate status is a valid CommissionStatus
    const validStatuses: CommissionStatus[] = ["EXPECTED", "PENDING", "PAID", "OVERDUE", "CANCELLED"];
    if (!validStatuses.includes(status as CommissionStatus)) {
      return NextResponse.json(
        { error: "Invalid status. Must be one of: " + validStatuses.join(", ") },
        { status: 400 }
      );
    }

    const db = getDb();
    
    // Update commission status directly
    const commission = await db.commission.update({
      where: { id: params.id },
      data: { 
        status: status as CommissionStatus,
        updatedAt: new Date(),
        ...(status === "PAID" ? { paidDate: new Date() } : {}),
      },
      include: {
        client: true,
        insurer: true,
        policy: true,
        receipt: true,
      },
    });

    return NextResponse.json({
      success: true,
      commission,
    });
  } catch (error) {
    console.error("Error updating commission status:", error);
    
    // Check if it's a "record not found" error
    if (error instanceof Error && error.message.includes("No record was found for an update")) {
      return NextResponse.json(
        { error: "Commission not found" },
        { status: 404 }
      );
    }
    
    return NextResponse.json(
      { error: "Failed to update commission status", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
