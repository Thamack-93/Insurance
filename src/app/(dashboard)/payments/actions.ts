"use server";

import { AuthError } from "@/lib/auth";
import { logError } from "@/lib/logger";
import { parseDateInput } from "@/lib/form-utils";
import { writeActivityLog } from "@/lib/activity-log";
import { PaymentConflictError, recordPayment, rehabilitateReceiptPayment } from "@/lib/payment-service";
import { getReceiptOriginLabel } from "@/lib/receipt-context";
import {
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
import { assertOrganizationContextInTransaction, requireOrganizationContext, withTenantTransaction } from "@/lib/organization-context";

export type CreatePaymentInput = {
  receiptId: string;
  amount: number;
  paidDate: string;
  paymentMethod: string;
  reference?: string;
  notes?: string;
};

export async function createPayment(data: CreatePaymentInput): Promise<MutationResult> {
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
    const context = await requireOrganizationContext();
    const userId = context.userId;
    const { payment, receipt } = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const permitted = await tx.receipt.findFirst({ where: { id: data.receiptId, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { client: { portfolioOwnerId: userId } } : {}) }, select: { id: true } });
      if (!permitted) throw new Error("El recibo no existe o fue eliminado.");
      return recordPayment({ organizationId: context.organizationId, receiptId: data.receiptId, amount: data.amount, paidDate: parseDateInput(data.paidDate), paymentMethod: data.paymentMethod, reference: data.reference, notes: data.notes, actorId: userId }, tx);
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
    const context = await requireOrganizationContext();
    const userId = context.userId;
    const result = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const permitted = await tx.receipt.findFirst({ where: { id: data.receiptId, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { client: { portfolioOwnerId: userId } } : {}) }, select: { id: true } });
      if (!permitted) throw new Error("El recibo no existe o fue eliminado.");
      return rehabilitateReceiptPayment({ organizationId: context.organizationId, receiptId: data.receiptId, amount: data.amount, paidDate: parseDateInput(data.paidDate), paymentMethod: data.paymentMethod, reference: data.reference, notes: data.notes, actorId: userId }, tx);
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
    const context = await requireOrganizationContext();
    const userId = context.userId;

    const payment = await withTenantTransaction(context, (tx) => tx.payment.findFirst({
      where: { id, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? paymentPortfolioWhere(userId) : {}) },
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
    }));

    if (!payment) {
      return errorResult("El pago no existe o no tienes acceso.");
    }
    if (payment.status !== "POSTED") {
      return successResult(payment.id, `/receipts/${payment.receiptId}`, "El pago ya estaba revertido.");
    }

    await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const stillPermitted = await tx.payment.findFirst({ where: { id: payment.id, organizationId: context.organizationId, status: "POSTED", ...(context.membershipRole === "AGENT" ? paymentPortfolioWhere(userId) : {}) }, select: { id: true } });
      if (!stillPermitted) throw new Error("El pago no existe o no tienes acceso.");
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
        organizationId: context.organizationId,
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

      await reconcileReceiptById(context.organizationId, payment.receiptId, userId, tx);
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
  try {
    const context = await requireOrganizationContext();
    const userId = context.userId;
    const receipts = await withTenantTransaction(context, (db) => db.receipt.findMany({
      where: {
        organizationId: context.organizationId,
        ...(context.membershipRole === "AGENT" ? receiptPortfolioWhere(userId) : {}),
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
      orderBy: [{ dueDate: "asc" }, { receiptSequence: { sort: "asc", nulls: "last" } }, { receiptNumber: "asc" }, { id: "asc" }],
    }));

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
  try {
    const context = await requireOrganizationContext();
    const userId = context.userId;
    const payments = await withTenantTransaction(context, (db) => db.payment.findMany({
      where: { organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? paymentPortfolioWhere(userId) : {}), status: "POSTED" },
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
      orderBy: [{ paidDate: "desc" }, { id: "desc" }],
    }));

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
  try {
    const context = await requireOrganizationContext();
    const userId = context.userId;
    const currentMonth = new Date();
    currentMonth.setDate(1);

    const result = await withTenantTransaction(context, async (db) => {
      const totalPaymentsThisMonth = await db.payment.aggregate({
      where: {
        organizationId: context.organizationId,
        ...(context.membershipRole === "AGENT" ? paymentPortfolioWhere(userId) : {}),
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
      where: { organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? receiptPortfolioWhere(userId) : {}), status: "PENDING" },
      });

      const overdueCount = await db.receipt.count({
      where: {
        organizationId: context.organizationId,
        ...(context.membershipRole === "AGENT" ? receiptPortfolioWhere(userId) : {}),
        status: { in: ["PENDING", "OVERDUE"] },
        dueDate: {
          lt: new Date(),
        },
      },
      });

      return { totalPaymentsThisMonth, pendingCount, overdueCount };
    });
    const { totalPaymentsThisMonth, pendingCount, overdueCount } = result;

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
