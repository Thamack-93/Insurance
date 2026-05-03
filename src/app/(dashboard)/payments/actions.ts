"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
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
    const payment = await db.payment.create({
      data: {
        receiptId: data.receiptId,
        policyId: receipt.policyId,
        clientId: receipt.clientId,
        amount: data.amount,
        currency: receipt.currency,
        paidDate: new Date(data.paidDate),
        paymentMethod: data.paymentMethod,
        reference: data.reference,
        notes: data.notes,
        createdById: userId,
        updatedById: userId,
      },
    });

    await db.receipt.update({
      where: { id: data.receiptId },
      data: {
        status: "PAID",
        paidDate: new Date(data.paidDate),
        paymentMethod: data.paymentMethod,
        updatedById: userId,
      },
    });

    await writeActivityLog({
      action: "CREATE_PAYMENT",
      entityType: "PAYMENT",
      entityId: payment.id,
      newValue: JSON.stringify({
        receiptId: receipt.id,
        receiptNumber: receipt.receiptNumber,
        clientId: receipt.clientId,
        clientName: receipt.client.fullName,
        policyId: receipt.policyId,
        policyNumber: receipt.policy.policyNumber,
        amount: data.amount,
        paymentMethod: data.paymentMethod,
        paidDate: data.paidDate,
      }),
    });

    if (receipt.policy.endDate) {
      const renewalDate = new Date(receipt.policy.endDate);
      const todayDate = new Date(today());
      const daysUntilRenewal = Math.ceil(
        (renewalDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (daysUntilRenewal <= 30 && daysUntilRenewal > 0) {
        await db.task.create({
          data: {
            folio: `TASK-${Date.now()}`,
            title: `Renovación de póliza ${receipt.policy.policyNumber}`,
            description: `Póliza vence en ${daysUntilRenewal} días. Contactar cliente para renovación.`,
            clientId: receipt.clientId,
            policyId: receipt.policyId,
            insurerId: receipt.insurerId,
            priority: daysUntilRenewal <= 15 ? "HIGH" : "MEDIUM",
            status: "OPEN",
            dueDate: renewalDate,
            taskType: "RENEWAL",
          },
        });
      }
    }

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
    return errorResult("No se pudo registrar el pago. Intenta de nuevo.");
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

    return receipts.map((receipt) => ({
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

    return payments.map((payment) => ({
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
