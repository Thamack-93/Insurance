"use server";

import { getDb } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth";
import { today } from "@/lib/dates";
import { logError } from "@/lib/logger";
import {
  errorResult,
  revalidatePaths,
  successResult,
  type MutationResult,
} from "@/lib/mutation-utils";

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
    const receipt = await db.receipt.findUnique({
      where: { id: data.receiptId },
      include: {
        client: true,
        policy: true,
        insurer: true,
      },
    });

    if (!receipt) {
      return errorResult("El recibo no existe o fue eliminado.");
    }

    if (receipt.status === "PAID") {
      return errorResult("Este recibo ya está pagado.");
    }

    const userId = await getCurrentUserId();
    const payment = await db.$transaction(async (tx) => {
      const currentReceipt = await tx.receipt.findUnique({
        where: { id: data.receiptId },
        include: {
          client: true,
          policy: true,
          insurer: true,
        },
      });

      if (!currentReceipt) {
        throw new Error("El recibo no existe o fue eliminado.");
      }

      if (currentReceipt.status === "PAID") {
        throw new Error("Este recibo ya está pagado.");
      }

      const paidDate = new Date(data.paidDate);
      const updatedReceipt = await tx.receipt.updateMany({
        where: {
          id: data.receiptId,
          status: { not: "PAID" },
        },
        data: {
          status: "PAID",
          paidDate,
          paymentMethod: data.paymentMethod,
          updatedById: userId,
        },
      });

      if (!updatedReceipt.count) {
        throw new Error("Este recibo ya está pagado.");
      }

      const createdPayment = await tx.payment.create({
        data: {
          receiptId: data.receiptId,
          policyId: currentReceipt.policyId,
          clientId: currentReceipt.clientId,
          amount: data.amount,
          currency: currentReceipt.currency,
          paidDate,
          paymentMethod: data.paymentMethod,
          reference: data.reference,
          notes: data.notes,
          createdById: userId,
          updatedById: userId,
        },
      });

      await tx.activityLog.create({
        data: {
          entityType: "PAYMENT",
          entityId: createdPayment.id,
          action: "CREATE_PAYMENT",
          newValue: JSON.stringify({
            receiptId: currentReceipt.id,
            receiptNumber: currentReceipt.receiptNumber,
            clientId: currentReceipt.clientId,
            clientName: currentReceipt.client.fullName,
            policyId: currentReceipt.policyId,
            policyNumber: currentReceipt.policy.policyNumber,
            amount: data.amount,
            paymentMethod: data.paymentMethod,
            paidDate: data.paidDate,
          }),
          userId,
        },
      });

      if (currentReceipt.policy.endDate) {
        const dueDate = new Date(currentReceipt.policy.endDate);
        const todayDate = new Date(today());
        const daysUntilRenewal = Math.ceil(
          (dueDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24),
        );

        if (daysUntilRenewal <= 30 && daysUntilRenewal > 0) {
          await tx.workItem.upsert({
            where: {
              sourceType_sourceId: {
                sourceType: "Task",
                sourceId: `receipt:${currentReceipt.id}:renewal-task`,
              },
            },
            create: {
              sourceType: "Task",
              sourceId: `receipt:${currentReceipt.id}:renewal-task`,
              workItemType: "TASK",
              taskType: "RENEWAL",
              folio: `TASK-${Date.now()}`,
              title: `Renovación de póliza ${currentReceipt.policy.policyNumber}`,
              description: `Póliza vence en ${daysUntilRenewal} días. Contactar cliente para renovación.`,
              clientId: currentReceipt.clientId,
              policyId: currentReceipt.policyId,
              insurerId: currentReceipt.insurerId,
              priority: daysUntilRenewal <= 15 ? "HIGH" : "MEDIUM",
              status: "OPEN",
              dueDate,
              entityType: "WorkItem",
              entityId: `receipt:${currentReceipt.id}:renewal-task`,
            },
            update: {
              workItemType: "TASK",
              taskType: "RENEWAL",
              title: `Renovación de póliza ${currentReceipt.policy.policyNumber}`,
              description: `Póliza vence en ${daysUntilRenewal} días. Contactar cliente para renovación.`,
              clientId: currentReceipt.clientId,
              policyId: currentReceipt.policyId,
              insurerId: currentReceipt.insurerId,
              priority: daysUntilRenewal <= 15 ? "HIGH" : "MEDIUM",
              status: "OPEN",
              dueDate,
              entityType: "WorkItem",
              entityId: `receipt:${currentReceipt.id}:renewal-task`,
            },
          });
        }
      }

      return createdPayment;
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
    const message =
      error instanceof Error &&
      ["El recibo no existe o fue eliminado.", "Este recibo ya está pagado."].includes(error.message)
        ? error.message
        : "No se pudo registrar el pago. Intenta de nuevo.";
    return errorResult(message);
  }
}

export async function getPendingReceipts() {
  const db = getDb();

  try {
    const receipts = await db.receipt.findMany({
      where: { status: "PENDING" },
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
      },
      orderBy: { dueDate: "asc" },
    });

    return receipts
      .filter((receipt) => receipt.client && receipt.policy && receipt.insurer)
      .map((receipt) => ({
      ...receipt,
      amount: Number(receipt.amount),
      }));
  } catch (error) {
    logError("payments.getPendingReceipts", error);
    return [];
  }
}

export async function getPaymentHistory(limit?: number) {
  const db = getDb();

  try {
    const payments = await db.payment.findMany({
      take: limit || 50,
      include: {
        receipt: {
          select: {
            id: true,
            receiptNumber: true,
            dueDate: true,
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
    const currentMonth = new Date();
    currentMonth.setDate(1);

    const totalPaymentsThisMonth = await db.payment.aggregate({
      where: {
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
      where: { status: "PENDING" },
    });

    const overdueCount = await db.receipt.count({
      where: {
        status: "PENDING",
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
