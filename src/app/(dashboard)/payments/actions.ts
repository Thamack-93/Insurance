"use server";

import { getDb } from "@/lib/db";
import { AuthError, getCurrentUserId } from "@/lib/auth";
import { logError } from "@/lib/logger";
import { parseDateInput } from "@/lib/form-utils";
import { writeActivityLog } from "@/lib/activity-log";
import { PaymentConflictError, recordPayment, rehabilitateReceiptPayment } from "@/lib/payment-service";
import { getReceiptOriginLabel } from "@/lib/receipt-context";
import {
  assertReceiptPortfolioAccess,
  paymentPortfolioWhere,
  receiptPortfolioWhere,
} from "@/lib/portfolio-access";
import {
  errorResult,
  revalidatePaths,
  successResult,
  type MutationResult,
} from "@/lib/mutation-utils";
import { reconcileReceiptById } from "@/lib/payment-service";

export type CreatePaymentInput = {
  receiptId: string;
  amount: number;
  paidDate: string;
  paymentMethod: string;
  reference?: string;
  notes?: string;
};

export async function createPayment(data: CreatePaymentInput): Promise<MutationResult> {
  const db = getDb();

  if (!data.receiptId) {
    return errorResult("Selecciona un recibo para registrar el pago.");
  }

  if (!data.amount || data.amount <= 0) {
    return errorResult("El monto del pago debe ser mayor a cero.");
  }

  if (!data.paidDate) {
    return errorResult("Indica la fecha del pago.");
  }

  if (!data.paymentMethod) {
    return errorResult("Selecciona un método de pago.");
  }

  try {
    const userId = await getCurrentUserId();
    await assertReceiptPortfolioAccess(data.receiptId, userId);
    const receipt = await db.receipt.findUnique({
      where: { id: data.receiptId },
      include: {
        client: true,
        policy: true,
        insurer: true,
        endorsement: true,
      },
    });

    if (!receipt) {
      return errorResult("El recibo no existe o fue eliminado.");
    }

    const { payment } = await recordPayment({
      receiptId: data.receiptId,
      amount: data.amount,
      paidDate: parseDateInput(data.paidDate),
      paymentMethod: data.paymentMethod,
      reference: data.reference,
      notes: data.notes,
      actorId: userId,
    });

    revalidatePaths([
      "/payments",
      "/receipts",
      `/receipts/${receipt.id}`,
      "/dashboard",
      "/today",
    ]);

    return successResult(payment.id, `/receipts/${receipt.id}`, "Pago registrado exitosamente.");
  } catch (error) {
    logError("payments.createPayment", error, { receiptId: data.receiptId });
    const message = error instanceof Error && (
      error instanceof AuthError ||
      error instanceof PaymentConflictError ||
      [
        "El recibo no existe o fue eliminado.",
        "No puedes aplicar pagos a un recibo cancelado.",
      ].includes(error.message) ||
      error.message.startsWith("El pago debe cubrir el recibo")
    )
      ? error.message
      : "No se pudo registrar el pago. Intenta de nuevo.";
    return errorResult(message);
  }
}

export async function rehabilitatePayment(data: CreatePaymentInput): Promise<MutationResult> {
  if (!data.receiptId) return errorResult("Selecciona un recibo para rehabilitar.");
  if (!data.amount || data.amount <= 0) return errorResult("El monto del pago debe ser mayor a cero.");
  if (!data.paidDate) return errorResult("Indica la fecha del pago.");
  if (!data.paymentMethod) return errorResult("Selecciona un método de pago.");

  try {
    const userId = await getCurrentUserId();
    await assertReceiptPortfolioAccess(data.receiptId, userId);
    const result = await rehabilitateReceiptPayment({
      receiptId: data.receiptId,
      amount: data.amount,
      paidDate: parseDateInput(data.paidDate),
      paymentMethod: data.paymentMethod,
      reference: data.reference,
      notes: data.notes,
      actorId: userId,
    });

    revalidatePaths([
      "/payments",
      "/receipts",
      `/receipts/${data.receiptId}`,
      `/policies/${result.payment.policyId}`,
      "/dashboard",
      "/today",
      "/portfolio",
      "/renewals",
      "/risks",
      "/data-quality",
    ]);

    return successResult(
      result.payment.id,
      `/receipts/${data.receiptId}`,
      `Pago registrado y póliza rehabilitada. ${result.reopenedReceiptCount} recibo(s) reabierto(s).`,
    );
  } catch (error) {
    logError("payments.rehabilitatePayment", error, { receiptId: data.receiptId });
    const message = error instanceof Error && (error instanceof AuthError || error instanceof PaymentConflictError)
      ? error.message
      : error instanceof Error && (error.message.includes("rehabilitación") || error.message.startsWith("El pago debe cubrir el recibo"))
        ? error.message
        : "No se pudo rehabilitar la póliza. Intenta de nuevo.";
    return errorResult(message);
  }
}

export async function deletePayment(id: string): Promise<MutationResult> {
  try {
    const db = getDb();
    const userId = await getCurrentUserId();

    const payment = await db.payment.findFirst({
      where: { id, ...paymentPortfolioWhere(userId) },
      include: {
        receipt: {
          select: {
            id: true,
            receiptNumber: true,
            policyId: true,
            clientId: true,
            status: true,
          },
        },
        policy: {
          select: {
            id: true,
            policyNumber: true,
          },
        },
        client: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
    });

    if (!payment) {
      return errorResult("El pago no existe o no tienes acceso.");
    }
    if (payment.status !== "POSTED") {
      return successResult(payment.id, `/receipts/${payment.receiptId}`, "El pago ya estaba revertido.");
    }

    await db.$transaction(async (tx) => {
      const reversedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "REVERSED",
          reversedAt: new Date(),
          reversedById: userId,
          reversalReason: "REVERSAL_FROM_RECEIPT_DETAIL",
          updatedById: userId,
        },
      });

      await writeActivityLog({
        entityType: "Payment",
        entityId: reversedPayment.id,
        action: "PAYMENT_REVERSE",
        oldValue: {
          receiptId: payment.receiptId,
          receiptNumber: payment.receipt.receiptNumber,
          policyId: payment.policyId,
          policyNumber: payment.policy.policyNumber,
          clientId: payment.clientId,
          clientName: payment.client.fullName,
          amount: Number(reversedPayment.amount),
          paymentMethod: reversedPayment.paymentMethod,
          paidDate: reversedPayment.paidDate.toISOString(),
          reference: reversedPayment.reference,
          notes: reversedPayment.notes,
          sourceEvidenceKey: reversedPayment.sourceEvidenceKey,
          status: reversedPayment.status,
        },
        newValue: {
          status: reversedPayment.status,
          reversedAt: reversedPayment.reversedAt,
          reversedById: reversedPayment.reversedById,
          reversalReason: reversedPayment.reversalReason,
        },
        userId,
        db: tx,
      });

      await reconcileReceiptById(payment.receiptId, userId, tx);
    });

    revalidatePaths([
      "/payments",
      "/receipts",
      `/receipts/${payment.receiptId}`,
      `/policies/${payment.policyId}`,
      `/clients/${payment.clientId}`,
      "/due-payments",
      "/dashboard",
      "/today",
      "/portfolio",
      "/renewals",
      "/risks",
      "/data-quality",
    ]);

    return successResult(payment.id, `/receipts/${payment.receiptId}`, "Pago revertido y recibo conciliado de nuevo.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    logError("payments.deletePayment", error, { paymentId: id });
    return errorResult(error instanceof Error ? error.message : "No se pudo eliminar el pago.");
  }
}

export async function getPendingReceipts() {
  const db = getDb();

  try {
    const userId = await getCurrentUserId();
    const receipts = await db.receipt.findMany({
      where: {
        ...receiptPortfolioWhere(userId),
        status: { in: ["PENDING", "OVERDUE"] },
      },
      include: {
        client: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        policy: {
          select: {
            id: true,
            policyNumber: true,
            policyType: true,
          },
        },
        insurer: {
          select: {
            id: true,
            name: true,
          },
        },
        endorsement: {
          select: {
            id: true,
            endorsementNumber: true,
            reference: true,
          },
        },
      },
      orderBy: { dueDate: "asc" },
    });

    return receipts
      .filter((receipt) => receipt.client && receipt.policy && receipt.insurer)
      .map((receipt) => ({
        ...receipt,
        amount: Number(receipt.amount),
        originLabel: getReceiptOriginLabel(receipt),
      }));
  } catch (error) {
    logError("payments.getPendingReceipts", error);
    return [];
  }
}

export async function getPaymentHistory(limit?: number) {
  const db = getDb();

  try {
    const userId = await getCurrentUserId();
    const payments = await db.payment.findMany({
      where: { ...paymentPortfolioWhere(userId), status: "POSTED" },
      take: limit || 50,
      include: {
        receipt: {
          select: {
            id: true,
            receiptNumber: true,
            dueDate: true,
            endorsement: {
              select: { id: true, endorsementNumber: true },
            },
          },
        },
        client: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        policy: {
          select: {
            id: true,
            policyNumber: true,
            policyType: true,
          },
        },
      },
      orderBy: { paidDate: "desc" },
    });

    return payments
      .filter((payment) => payment.receipt && payment.client && payment.policy)
      .map((payment) => ({
        ...payment,
        amount: Number(payment.amount),
      }));
  } catch (error) {
    logError("payments.getPaymentHistory", error);
    return [];
  }
}

export async function getPaymentStats() {
  const db = getDb();

  try {
    const userId = await getCurrentUserId();
    const currentMonth = new Date();
    currentMonth.setDate(1);

    const totalPaymentsThisMonth = await db.payment.aggregate({
      where: {
        ...paymentPortfolioWhere(userId),
        paidDate: {
          gte: currentMonth,
        },
      },
      _sum: {
        amount: true,
      },
      _count: {
        id: true,
      },
    });

    const pendingCount = await db.receipt.count({
      where: { ...receiptPortfolioWhere(userId), status: "PENDING" },
    });

    const overdueCount = await db.receipt.count({
      where: {
        ...receiptPortfolioWhere(userId),
        status: { in: ["PENDING", "OVERDUE"] },
        dueDate: {
          lt: new Date(),
        },
      },
    });

    return {
      totalPaymentsThisMonth: Number(totalPaymentsThisMonth._sum.amount || 0),
      paymentsCountThisMonth: totalPaymentsThisMonth._count.id,
      pendingReceiptsCount: pendingCount,
      overdueReceiptsCount: overdueCount,
    };
  } catch (error) {
    logError("payments.getPaymentStats", error);
    return {
      totalPaymentsThisMonth: 0,
      paymentsCountThisMonth: 0,
      pendingReceiptsCount: 0,
      overdueReceiptsCount: 0,
    };
  }
}
