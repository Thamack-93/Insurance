import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    
    // Calculate commission stats directly
    const commissions = await db.commission.findMany({
      include: {
        client: true,
        insurer: true,
        policy: true,
        receipt: true,
      },
    });

    const totalExpected = commissions.reduce((sum, c) => sum + Number(c.expectedAmount), 0);
    const totalActual = commissions.reduce((sum, c) => sum + (c.actualAmount ? Number(c.actualAmount) : 0), 0);
    const totalCount = commissions.length;

    // Group by status
    const statusBreakdown = commissions.reduce((acc, commission) => {
      const status = commission.status;
      const existing = acc.find(item => item.status === status);
      if (existing) {
        existing.count++;
        existing.total += Number(commission.expectedAmount);
      } else {
        acc.push({
          status,
          count: 1,
          total: Number(commission.expectedAmount),
        });
      }
      return acc;
    }, [] as Array<{ status: string; count: number; total: number }>);

    return NextResponse.json({
      totalExpected,
      totalActual,
      totalCount,
      statusBreakdown,
    });
  } catch (error) {
    console.error("Error fetching commission stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch commission statistics" },
      { status: 500 }
    );
  }
}
