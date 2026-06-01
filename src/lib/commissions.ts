"use server";

import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { today } from "@/lib/dates";
import { addDays } from "date-fns";
import { writeActivityLog } from "@/lib/activity-log";
import { logError } from "@/lib/logger";
import { errorResult, successResult, type MutationResult } from "@/lib/mutation-utils";
import type { CommissionStatus } from "@/lib/domain-values";

export interface CommissionCalculation {
  policyId: string;
  clientId: string;
  insurerId: string;
  receiptId?: string;
  expectedAmount: number;
  actualAmount?: number;
  percentage: number;
  expectedDate: Date;
  status: "EXPECTED" | "PENDING" | "PAID" | "OVERDUE" | "CANCELLED";
}

export async function calculateCommissionsForPolicy(
  policyId: string,
  receiptId?: string,
): Promise<MutationResult> {
  const db = getDb();

  try {
    // Get policy details
    const policy = await db.policy.findUnique({
      where: { id: policyId },
      include: {
        client: true,
        insurer: true,
        receipts: receiptId ? { where: { id: receiptId } } : true,
      },
    });

    if (!policy) {
      return errorResult("La póliza no existe o fue eliminada.");
    }

    // Get insurer commission rate (default to 10% if not set)
    const commissionRate = 0.10; // Could be stored in insurer settings

    // Calculate commission for each receipt or for the policy premium
    const receiptsToProcess = receiptId 
      ? policy.receipts.filter(r => r.id === receiptId)
      : policy.receipts;

    const commissions = [];

    for (const receipt of receiptsToProcess) {
      const receiptAmount = toNumber(receipt.amount);
      const commissionAmount = receiptAmount * commissionRate;
      const expectedDate = addDays(receipt.dueDate, 30); // Commission expected 30 days after receipt due

      // Check if commission already exists
      const existingCommission = await db.commission.findFirst({
        where: {
          policyId,
          receiptId: receipt.id,
        },
      });

      if (!existingCommission) {
        const commission = await db.commission.create({
          data: {
            policyId,
            receiptId: receipt.id,
            clientId: policy.clientId,
            insurerId: policy.insurerId,
            expectedAmount: commissionAmount,
            percentage: commissionRate * 100,
            expectedDate,
            status: receipt.status === "PAID" ? "PENDING" : "EXPECTED",
          },
        });

        commissions.push(commission);

        // Log activity
        await writeActivityLog({
          action: "CALCULATE_COMMISSION",
          entityType: "COMMISSION",
          entityId: commission.id,
          newValue: JSON.stringify({
            policyId,
            receiptId: receipt.id,
            amount: commissionAmount,
            percentage: commissionRate * 100,
            expectedDate,
          }),
        });
      }
    }

    return successResult(
      policyId,
      `/policies/${policyId}`,
      `Se calcularon ${commissions.length} comisiones para la póliza.`,
    );
  } catch (error) {
    logError("commissions.calculateCommissionsForPolicy", error, { policyId, receiptId });
    return errorResult("No se pudieron calcular las comisiones. Intenta de nuevo.");
  }
}

export async function updateCommissionStatus(
  commissionId: string,
  status: CommissionStatus,
  actualAmount?: number,
): Promise<MutationResult> {
  const db = getDb();

  try {
    const commission = await db.commission.findUnique({
      where: { id: commissionId },
      include: {
        policy: true,
        client: true,
        insurer: true,
      },
    });

    if (!commission) {
      return errorResult("La comisión no existe o fue eliminada.");
    }

    const updateData: Prisma.CommissionUpdateInput = {
      status,
      updatedAt: new Date(),
      ...(actualAmount && status === "PAID"
        ? { actualAmount, paidDate: new Date() }
        : {}),
    };

    const updatedCommission = await db.commission.update({
      where: { id: commissionId },
      data: updateData,
    });

    // Log activity
    await writeActivityLog({
      action: "UPDATE_COMMISSION_STATUS",
      entityType: "COMMISSION",
      entityId: commissionId,
      oldValue: JSON.stringify({
        status: commission.status,
        actualAmount: commission.actualAmount,
      }),
      newValue: JSON.stringify({
        status,
        actualAmount: actualAmount || commission.actualAmount,
      }),
    });

    return successResult(
      updatedCommission.id,
      `/commissions/${updatedCommission.id}`,
      "Estado de comisión actualizado.",
    );
  } catch (error) {
    logError("commissions.updateCommissionStatus", error, { commissionId, status });
    return errorResult("No se pudo actualizar el estado de la comisión. Intenta de nuevo.");
  }
}

export async function getCommissionStats(dateRange?: { start: Date; end: Date }) {
  const db = getDb();
  
  try {
    const whereClause = dateRange 
      ? {
          expectedDate: {
            gte: dateRange.start,
            lte: dateRange.end,
          },
        }
      : {};

    const stats = await db.commission.aggregate({
      where: whereClause,
      _sum: {
        expectedAmount: true,
        actualAmount: true,
      },
      _count: {
        id: true,
      },
    });

    const statusBreakdown = await db.commission.groupBy({
      by: ["status"],
      where: whereClause,
      _sum: {
        expectedAmount: true,
        actualAmount: true,
      },
      _count: {
        id: true,
      },
    });

    return {
      totalExpected: Number(stats._sum.expectedAmount || 0),
      totalActual: Number(stats._sum.actualAmount || 0),
      totalCount: stats._count.id,
      statusBreakdown: statusBreakdown.map(item => ({
        status: item.status,
        count: item._count.id,
        expectedAmount: Number(item._sum.expectedAmount || 0),
        actualAmount: Number(item._sum.actualAmount || 0),
      })),
    };
  } catch (error) {
    logError("commissions.getCommissionStats", error);
    return {
      totalExpected: 0,
      totalActual: 0,
      totalCount: 0,
      statusBreakdown: [],
    };
  }
}

export async function getOverdueCommissions() {
  const db = getDb();
  
  try {
    const todayDate = new Date(today());
    
    const overdueCommissions = await db.commission.findMany({
      where: {
        expectedDate: {
          lt: todayDate,
        },
        status: {
          in: ["EXPECTED", "PENDING"],
        },
      },
      include: {
        policy: {
          select: {
            policyNumber: true,
            policyType: true,
          },
        },
        client: {
          select: {
            fullName: true,
            email: true,
          },
        },
        insurer: {
          select: {
            name: true,
          },
        },
        receipt: {
          select: {
            receiptNumber: true,
            dueDate: true,
          },
        },
      },
      orderBy: {
        expectedDate: "asc",
      },
    });

    return overdueCommissions.map(commission => ({
      ...commission,
      expectedAmount: Number(commission.expectedAmount),
      actualAmount: commission.actualAmount ? Number(commission.actualAmount) : null,
      percentage: Number(commission.percentage),
    }));
  } catch (error) {
    logError("commissions.getOverdueCommissions", error);
    return [];
  }
}

export async function autoUpdateCommissionStatuses() {
  const db = getDb();

  try {
    const todayDate = new Date(today());

    // Sequential transitions: a commission may need EXPECTED→PENDING→OVERDUE
    // in the same run if its receipt was just paid AND it's already past due.
    const pendingResult = await db.commission.updateMany({
      where: {
        status: "EXPECTED",
        receipt: { status: "PAID" },
      },
      data: { status: "PENDING", updatedAt: new Date() },
    });
    const overdueResult = await db.commission.updateMany({
      where: {
        status: "PENDING",
        expectedDate: { lt: todayDate },
      },
      data: { status: "OVERDUE", updatedAt: new Date() },
    });

    return {
      updatedToPending: pendingResult.count,
      updatedToOverdue: overdueResult.count,
    };
  } catch (error) {
    logError("commissions.autoUpdateCommissionStatuses", error);
    return {
      updatedToPending: 0,
      updatedToOverdue: 0,
    };
  }
}
