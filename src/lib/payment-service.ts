import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { writeActivityLog } from "@/lib/activity-log";
import { getDb } from "@/lib/db";
import { reconcileReceiptState } from "@/lib/receipt-reconciliation";

type DbClient = PrismaClient | Prisma.TransactionClient;

const CLOSE_TOLERANCE = 5;

export type RecordPaymentInput = {
  receiptId: string;
  amount: number;
  paidDate: Date;
  paymentMethod: string;
  reference?: string | null;
  notes?: string | null;
  sourceEvidenceKey?: string | null;
  actorId: string;
};

export class PaymentConflictError extends Error {}

function normalizedReference(value?: string | null) {
  return value?.trim() || null;
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

export async function reconcileReceiptById(
  receiptId: string,
  actorId: string,
  client?: DbClient,
) {
  const db = client ?? getDb();
  const receipt = await db.receipt.findUnique({
    where: { id: receiptId },
    include: {
      payments: {
        orderBy: [{ paidDate: "desc" }, { createdAt: "desc" }],
      },
    },
  });

  if (!receipt) {
    throw new Error("El recibo no existe o fue eliminado.");
  }

  const snapshot = reconcileReceiptState({
    amount: Number(receipt.amount),
    status: receipt.status as "PENDING" | "PAID" | "OVERDUE" | "CANCELLED",
    dueDate: receipt.dueDate,
    paidDate: receipt.paidDate,
    paymentMethod: receipt.paymentMethod,
    payments: receipt.payments.map((payment) => ({
      amount: Number(payment.amount),
      paidDate: payment.paidDate,
      paymentMethod: payment.paymentMethod,
    })),
    closeTolerance: CLOSE_TOLERANCE,
  });

  const adjustment =
    snapshot.nextStatus === "PAID"
      ? Math.round((Number(receipt.amount) - snapshot.paidAmount) * 100) / 100
      : 0;
  const reconciliationNote =
    adjustment !== 0
      ? `Ajuste auditado de conciliación: ${adjustment.toFixed(2)} ${receipt.currency}.`
      : null;

  const changed =
    receipt.status !== snapshot.nextStatus ||
    (receipt.paidDate?.getTime() ?? null) !== (snapshot.nextPaidDate?.getTime() ?? null) ||
    receipt.paymentMethod !== snapshot.nextPaymentMethod ||
    Number(receipt.reconciliationAdjustment) !== adjustment ||
    receipt.reconciliationNote !== reconciliationNote;

  if (changed) {
    await db.receipt.update({
      where: { id: receipt.id },
      data: {
        status: snapshot.nextStatus,
        paidDate: snapshot.nextPaidDate,
        paymentMethod: snapshot.nextPaymentMethod,
        reconciliationAdjustment: adjustment,
        reconciliationNote,
        updatedById: actorId,
      },
    });
  }

  if (snapshot.shouldReview) {
    const reason = snapshot.reasons.join(",") || "REVIEW_REQUIRED";
    const existingIssue = await db.receiptReconciliationIssue.findFirst({
      where: { receiptId: receipt.id, reason, status: "OPEN" },
      select: { id: true },
    });
    if (existingIssue) {
      await db.receiptReconciliationIssue.update({
        where: { id: existingIssue.id },
        data: {
          detailsJson: JSON.stringify(snapshot),
          expectedAmount: receipt.amount,
          paidAmount: snapshot.paidAmount,
        },
      });
    } else {
      await db.receiptReconciliationIssue.create({
        data: {
          receiptId: receipt.id,
          policyId: receipt.policyId,
          reason,
          status: "OPEN",
          detailsJson: JSON.stringify(snapshot),
          expectedAmount: receipt.amount,
          paidAmount: snapshot.paidAmount,
        },
      });
    }
  }

  if (changed || snapshot.shouldReview) {
    await writeActivityLog({
      entityType: "Receipt",
      entityId: receipt.id,
      action: "RECEIPT_RECONCILED",
      oldValue: {
        status: receipt.status,
        paidDate: receipt.paidDate,
        paymentMethod: receipt.paymentMethod,
      },
      newValue: {
        status: snapshot.nextStatus,
        paidAmount: snapshot.paidAmount,
        adjustment,
        reasons: snapshot.reasons,
      },
      userId: actorId,
      db,
    });
  }

  return snapshot;
}

export async function recordPayment(input: RecordPaymentInput, client?: DbClient) {
  const db = client ?? getDb();
  const reference = normalizedReference(input.reference);

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("El monto del pago debe ser mayor a cero.");
  }

  const applyPayment = async (tx: DbClient) => {
    const receipt = await tx.receipt.findUnique({
      where: { id: input.receiptId },
      include: {
        client: true,
        policy: true,
      },
    });

    if (!receipt) {
      throw new Error("El recibo no existe o fue eliminado.");
    }

    if (receipt.status === "CANCELLED") {
      throw new Error("No puedes aplicar pagos a un recibo cancelado.");
    }

    if (input.sourceEvidenceKey) {
      const evidenceMatch = await tx.payment.findUnique({
        where: { sourceEvidenceKey: input.sourceEvidenceKey },
        select: { id: true },
      });
      if (evidenceMatch) {
        throw new PaymentConflictError("Este comprobante ya fue aplicado anteriormente.");
      }
    }

    const exactDuplicate = await tx.payment.findFirst({
      where: {
        receiptId: input.receiptId,
        amount: input.amount,
        paidDate: input.paidDate,
        reference,
      },
      select: { id: true },
    });
    if (exactDuplicate) {
      throw new PaymentConflictError("Este pago ya fue registrado.");
    }

    const payment = await tx.payment.create({
      data: {
        receiptId: receipt.id,
        policyId: receipt.policyId,
        clientId: receipt.clientId,
        amount: input.amount,
        currency: receipt.currency,
        paidDate: input.paidDate,
        paymentMethod: input.paymentMethod,
        reference,
        notes: input.notes?.trim() || null,
        sourceEvidenceKey: input.sourceEvidenceKey?.trim() || null,
        createdById: input.actorId,
        updatedById: input.actorId,
      },
    });

    await writeActivityLog({
      entityType: "Payment",
      entityId: payment.id,
      action: "PAYMENT_CREATE",
      newValue: {
        receiptId: receipt.id,
        receiptNumber: receipt.receiptNumber,
        policyId: receipt.policyId,
        policyNumber: receipt.policy.policyNumber,
        clientId: receipt.clientId,
        clientName: receipt.client.fullName,
        amount: input.amount,
        paymentMethod: input.paymentMethod,
        paidDate: dateKey(input.paidDate),
        reference,
      },
      userId: input.actorId,
      db: tx,
    });

    const reconciliation = await reconcileReceiptById(receipt.id, input.actorId, tx);
    return { payment, receipt, reconciliation };
  };

  if (client) {
    return applyPayment(db);
  }

  return db.$transaction(applyPayment);
}
