import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { writeActivityLog } from "@/lib/activity-log";
import { getDb } from "@/lib/db";
import {
  PAYMENT_CLOSE_TOLERANCE,
  reconcileReceiptState,
} from "@/lib/receipt-reconciliation";
import { isBusinessDateOverdue } from "@/lib/business-dates";

type DbClient = PrismaClient | Prisma.TransactionClient;

const CLOSE_TOLERANCE = PAYMENT_CLOSE_TOLERANCE;

export type RecordPaymentInput = {
  organizationId: string;
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
  organizationId: string,
  receiptId: string,
  actorId: string,
  client?: DbClient,
) {
  const db = client ?? getDb();
  const receipt = await db.receipt.findFirst({
    where: { id: receiptId, organizationId },
    include: {
      payments: {
        where: { status: "POSTED" },
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
      where: { organizationId, receiptId: receipt.id, reason, status: "OPEN" },
      select: { id: true },
    });
    if (existingIssue) {
      await db.receiptReconciliationIssue.update({
        where: { id: existingIssue.id },
        data: {
          organizationId,
          detailsJson: JSON.stringify(snapshot),
          expectedAmount: receipt.amount,
          paidAmount: snapshot.paidAmount,
        },
      });
    } else {
      await db.receiptReconciliationIssue.create({
        data: {
          organizationId,
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
      organizationId,
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
    const receipt = await tx.receipt.findFirst({
      where: { id: input.receiptId, organizationId: input.organizationId },
      include: {
        client: true,
        policy: true,
        payments: {
          where: { status: "POSTED" },
          select: { id: true },
        },
      },
    });

    if (!receipt) {
      throw new Error("El recibo no existe o fue eliminado.");
    }

    if (receipt.status === "CANCELLED") {
      throw new Error("No puedes aplicar pagos a un recibo cancelado.");
    }

    if (receipt.payments.length > 0) {
      throw new PaymentConflictError("No se permiten abonos: este recibo ya tiene un pago registrado.");
    }

    const amountDifference = Math.round(Math.abs(input.amount - Number(receipt.amount)) * 100) / 100;
    if (amountDifference > CLOSE_TOLERANCE) {
      throw new Error(`El pago debe cubrir el recibo dentro de una diferencia máxima de $${CLOSE_TOLERANCE.toFixed(2)}.`);
    }

    if (input.sourceEvidenceKey) {
      const evidenceMatch = await tx.payment.findUnique({
        where: { organizationId_sourceEvidenceKey: { organizationId: input.organizationId, sourceEvidenceKey: input.sourceEvidenceKey } },
        select: { id: true },
      });
      if (evidenceMatch) {
        throw new PaymentConflictError("Este comprobante ya fue aplicado anteriormente.");
      }
    }

    const exactDuplicate = await tx.payment.findFirst({
      where: {
        organizationId: input.organizationId,
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
        organizationId: input.organizationId,
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
      organizationId: input.organizationId,
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

    const reconciliation = await reconcileReceiptById(input.organizationId, receipt.id, input.actorId, tx);
    return { payment, receipt, reconciliation };
  };

  if (client) {
    return applyPayment(db);
  }

  return db.$transaction(applyPayment);
}

export type RehabilitateReceiptPaymentInput = Omit<RecordPaymentInput, "receiptId"> & {
  receiptId: string;
};

export async function rehabilitateReceiptPayment(
  input: RehabilitateReceiptPaymentInput,
  client?: DbClient,
) {
  const db = client ?? getDb();
  const reference = normalizedReference(input.reference);

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("El monto del pago debe ser mayor a cero.");
  }

  const applyRehabilitation = async (tx: DbClient) => {
    const receipt = await tx.receipt.findFirst({
      where: { id: input.receiptId, organizationId: input.organizationId },
      include: {
        client: true,
        policy: true,
        payments: {
          where: { status: "POSTED" },
          select: { id: true },
        },
      },
    });

    if (!receipt) throw new Error("El recibo no existe o fue eliminado.");
    if (receipt.status !== "CANCELLED" || receipt.cancellationReason !== "NON_PAYMENT" || !receipt.cancellationBatchId) {
      throw new Error("Este recibo no está disponible para rehabilitación por falta de pago.");
    }
    if (receipt.payments.length > 0) {
      throw new PaymentConflictError("Este recibo ya tiene un pago de rehabilitación registrado.");
    }

    const amountDifference = Math.round(Math.abs(input.amount - Number(receipt.amount)) * 100) / 100;
    if (amountDifference > CLOSE_TOLERANCE) {
      throw new Error(`El pago debe cubrir el recibo dentro de una diferencia máxima de $${CLOSE_TOLERANCE.toFixed(2)}.`);
    }

    if (input.sourceEvidenceKey) {
      const evidenceMatch = await tx.payment.findUnique({
        where: { organizationId_sourceEvidenceKey: { organizationId: input.organizationId, sourceEvidenceKey: input.sourceEvidenceKey } },
        select: { id: true },
      });
      if (evidenceMatch) throw new PaymentConflictError("Este comprobante ya fue aplicado anteriormente.");
    }

    const batchReceipts = await tx.receipt.findMany({
      where: {
        organizationId: input.organizationId,
        policyId: receipt.policyId,
        status: "CANCELLED",
        cancellationReason: "NON_PAYMENT",
        cancellationBatchId: receipt.cancellationBatchId,
      },
      select: {
        id: true,
        receiptNumber: true,
        amount: true,
        dueDate: true,
        status: true,
      },
    });
    const cancellationBatchId = receipt.cancellationBatchId;

    const payment = await tx.payment.create({
      data: {
        organizationId: input.organizationId,
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

    const adjustment = Math.round((Number(receipt.amount) - input.amount) * 100) / 100;
    const paymentDate = input.paidDate;
    await tx.receipt.updateMany({
      where: { id: receipt.id, organizationId: input.organizationId },
      data: {
        status: "PAID",
        paidDate: paymentDate,
        paymentMethod: input.paymentMethod,
        reconciliationAdjustment: adjustment,
        reconciliationNote:
          adjustment !== 0 ? `Ajuste auditado de rehabilitación: ${adjustment.toFixed(2)} ${receipt.currency}.` : null,
        cancellationReason: null,
        cancellationBatchId: null,
        cancelledAt: null,
        updatedById: input.actorId,
      },
    });

    for (const batchReceipt of batchReceipts) {
      if (batchReceipt.id === receipt.id) continue;
      await tx.receipt.updateMany({
        where: { id: batchReceipt.id, organizationId: input.organizationId },
        data: {
          status: isBusinessDateOverdue(batchReceipt.dueDate) ? "OVERDUE" : "PENDING",
          cancellationReason: null,
          cancellationBatchId: null,
          cancelledAt: null,
          updatedById: input.actorId,
        },
      });
    }

    await tx.policy.updateMany({
      where: { id: receipt.policyId, organizationId: input.organizationId },
      data: {
        status: "ACTIVE",
        cancellationReason: null,
        cancellationBatchId: null,
        cancelledAt: null,
        updatedById: input.actorId,
      },
    });
    const updatedPolicy = await tx.policy.findFirstOrThrow({ where: { id: receipt.policyId, organizationId: input.organizationId } });

    await tx.receiptReconciliationIssue.updateMany({
      where: { organizationId: input.organizationId, receiptId: { in: batchReceipts.map((item) => item.id) }, status: "OPEN" },
      data: {
        status: "RESOLVED",
        reviewedAt: new Date(),
        reviewedById: input.actorId,
        resolutionNote: "Resuelto mediante rehabilitación por falta de pago.",
      },
    });

    await writeActivityLog({
      organizationId: input.organizationId,
      entityType: "Payment",
      entityId: payment.id,
      action: "PAYMENT_REHABILITATION_CREATE",
      newValue: {
        receiptId: receipt.id,
        receiptNumber: receipt.receiptNumber,
        policyId: receipt.policyId,
        policyNumber: receipt.policy.policyNumber,
        amount: input.amount,
        paymentMethod: input.paymentMethod,
        paidDate: dateKey(input.paidDate),
        reference,
        cancellationBatchId,
      },
      userId: input.actorId,
      db: tx,
    });

    await writeActivityLog({
      organizationId: input.organizationId,
      entityType: "Policy",
      entityId: updatedPolicy.id,
      action: "POLICY_REHABILITATED",
      oldValue: { status: receipt.policy.status, cancellationBatchId: receipt.cancellationBatchId },
      newValue: { status: updatedPolicy.status, reopenedReceiptIds: batchReceipts.map((item) => item.id) },
      userId: input.actorId,
      db: tx,
    });

    return { payment, receipt: updatedPolicy, reopenedReceiptCount: Math.max(batchReceipts.length - 1, 0) };
  };

  if (client) return applyRehabilitation(db);
  return db.$transaction(applyRehabilitation);
}
