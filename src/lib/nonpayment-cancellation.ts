import "server-only";

import { randomUUID } from "node:crypto";
import { addDays } from "date-fns";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { writeActivityLog } from "@/lib/activity-log";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";
import { SYSTEM_USER_ID } from "@/lib/auth";
import { NON_PAYMENT_CANCELLATION_DAYS } from "@/lib/nonpayment-cancellation.logic";

type DbClient = PrismaClient | Prisma.TransactionClient;

function cancellationCutoff(now: Date) {
  return addDays(now, -NON_PAYMENT_CANCELLATION_DAYS);
}

const unpaidReceiptWhere: Prisma.ReceiptWhereInput = {
  status: { in: ["PENDING", "OVERDUE"] },
  payments: { none: { status: "POSTED" } },
};

export type NonPaymentCancellationResult = {
  cancelled: boolean;
  policyId: string;
  policyNumber: string;
  cancellationBatchId?: string;
  cancelledReceiptCount?: number;
  oldestUnpaidDueDate?: Date;
};

export async function cancelPolicyForNonPayment(
  receiptId: string,
  actorId: string,
  now = new Date(),
  options: { client?: DbClient; enforceCutoff?: boolean } = {},
): Promise<NonPaymentCancellationResult> {
  const db = options.client ?? getDb();
  const cutoff = cancellationCutoff(now);

  const cancel = async (tx: DbClient) => {
    const sourceReceipt = await tx.receipt.findUnique({
      where: { id: receiptId },
      include: {
        policy: {
          select: {
            id: true,
            policyNumber: true,
            status: true,
            clientId: true,
            cancellationReason: true,
            cancellationBatchId: true,
          },
        },
      },
    });

    if (!sourceReceipt) throw new Error("El recibo no existe o fue eliminado.");

    const oldestUnpaid = await tx.receipt.findFirst({
      where: { policyId: sourceReceipt.policyId, ...unpaidReceiptWhere },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      select: { id: true, dueDate: true },
    });

    if (!oldestUnpaid) {
      throw new Error("No hay recibos pendientes de pago para cancelar en esta póliza.");
    }
    if (options.enforceCutoff !== false && oldestUnpaid.dueDate >= cutoff) {
      throw new Error(`La póliza solo puede cancelarse después de ${NON_PAYMENT_CANCELLATION_DAYS} días sin pago.`);
    }

    if (sourceReceipt.policy.status === "CANCELLED" && sourceReceipt.policy.cancellationReason === "NON_PAYMENT") {
      return {
        cancelled: false,
        policyId: sourceReceipt.policy.id,
        policyNumber: sourceReceipt.policy.policyNumber,
        oldestUnpaidDueDate: oldestUnpaid.dueDate,
      };
    }

    const batchId = randomUUID();
    const openReceipts = await tx.receipt.findMany({
      where: {
        policyId: sourceReceipt.policyId,
        status: { notIn: ["PAID", "CANCELLED"] },
      },
      select: {
        id: true,
        receiptNumber: true,
        policyId: true,
        clientId: true,
        status: true,
        paidDate: true,
        paymentMethod: true,
        cancellationReason: true,
        cancellationBatchId: true,
        cancelledAt: true,
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    });

    const cancelledAt = now;
    const policy = await tx.policy.update({
      where: { id: sourceReceipt.policyId },
      data: {
        status: "CANCELLED",
        cancellationReason: "NON_PAYMENT",
        cancellationBatchId: batchId,
        cancelledAt,
        updatedById: actorId,
      },
    });

    for (const receipt of openReceipts) {
      const updatedReceipt = await tx.receipt.update({
        where: { id: receipt.id },
        data: {
          status: "CANCELLED",
          paidDate: null,
          paymentMethod: null,
          cancellationReason: "NON_PAYMENT",
          cancellationBatchId: batchId,
          cancelledAt,
          updatedById: actorId,
        },
      });

      await writeActivityLog({
        entityType: "Receipt",
        entityId: updatedReceipt.id,
        action: "RECEIPT_CANCEL_NON_PAYMENT",
        oldValue: receipt,
        newValue: updatedReceipt,
        userId: actorId,
        db: tx,
      });
    }

    if (openReceipts.length > 0) {
      await tx.receiptReconciliationIssue.updateMany({
        where: { receiptId: { in: openReceipts.map((receipt) => receipt.id) }, status: "OPEN" },
        data: {
          status: "RESOLVED",
          reviewedAt: now,
          reviewedById: actorId,
          resolutionNote: "Cancelado por falta de pago después de 65 días.",
        },
      });
    }

    await writeActivityLog({
      entityType: "Policy",
      entityId: policy.id,
      action: "POLICY_CANCEL_NON_PAYMENT",
      oldValue: sourceReceipt.policy,
      newValue: policy,
      userId: actorId,
      db: tx,
    });

    return {
      cancelled: true,
      policyId: policy.id,
      policyNumber: policy.policyNumber,
      cancellationBatchId: batchId,
      cancelledReceiptCount: openReceipts.length,
      oldestUnpaidDueDate: oldestUnpaid.dueDate,
    };
  };

  if (options.client) return cancel(db);
  return db.$transaction(cancel);
}

export async function runNonPaymentCancellationJob(options: { now?: Date; actorId?: string } = {}) {
  const db = getDb();
  const now = options.now ?? new Date();
  const actorId = options.actorId ?? SYSTEM_USER_ID;
  const cutoff = cancellationCutoff(now);

  const candidates = await db.receipt.findMany({
    where: {
      ...unpaidReceiptWhere,
      dueDate: { lt: cutoff },
      policy: { status: { notIn: ["CANCELLED", "EXPIRED", "RENEWED"] } },
    },
    select: { id: true, policyId: true },
    orderBy: { dueDate: "asc" },
  });

  const policyIds = [...new Set(candidates.map((candidate) => candidate.policyId))];
  let cancelledPolicies = 0;
  let cancelledReceipts = 0;

  for (const policyId of policyIds) {
    const source = candidates.find((candidate) => candidate.policyId === policyId);
    if (!source) continue;
    try {
      const result = await cancelPolicyForNonPayment(source.id, actorId, now);
      if (result.cancelled) {
        cancelledPolicies += 1;
        cancelledReceipts += result.cancelledReceiptCount ?? 0;
      }
    } catch (error) {
      // A concurrent payment or cancellation makes this candidate stale; the next run will re-evaluate it.
      logError("nonpayment-cancellation.policy", error, { policyId });
    }
  }

  return {
    ok: true,
    evaluatedPolicies: policyIds.length,
    cancelledPolicies,
    cancelledReceipts,
    cutoff,
  };
}
