"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { formatCurrency } from "@/lib/money";
import { writeActivityLog } from "@/lib/activity-log";
import { today } from "@/lib/dates";

export async function createPayment(data: {
  receiptId: string;
  amount: number;
  paidDate: string;
  paymentMethod: string;
  reference?: string;
  notes?: string;
}) {
  const db = getDb();
  
  try {
    // Get receipt details
    const receipt = await db.receipt.findUnique({
      where: { id: data.receiptId },
      include: {
        client: true,
        policy: true,
        insurer: true,
      },
    });

    if (!receipt) {
      throw new Error("Recibo no encontrado");
    }

    if (receipt.status === "PAID") {
      throw new Error("Este recibo ya está pagado");
    }

    // Create payment record
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
      },
    });

    // Update receipt status to PAID
    await db.receipt.update({
      where: { id: data.receiptId },
      data: {
        status: "PAID",
        paidDate: new Date(data.paidDate),
        paymentMethod: data.paymentMethod,
      },
    });

    // Log activity
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

    // Create task for policy renewal if applicable
    if (receipt.policy.endDate) {
      const renewalDate = new Date(receipt.policy.endDate);
      const todayDate = new Date(today());
      const daysUntilRenewal = Math.ceil((renewalDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));

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

    revalidatePath("/payments");
    revalidatePath("/receipts");
    revalidatePath("/dashboard");

    return payment;
  } catch (error) {
    console.error("Error creating payment:", error);
    throw error;
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

    return receipts.map(receipt => ({
      ...receipt,
      amount: Number(receipt.amount),
    }));
  } catch (error) {
    console.error("Error fetching pending receipts:", error);
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

    return payments.map(payment => ({
      ...payment,
      amount: Number(payment.amount),
    }));
  } catch (error) {
    console.error("Error fetching payment history:", error);
    return [];
  }
}

export async function getPaymentStats() {
  const db = getDb();
  
  try {
    // Total payments this month
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

    // Pending receipts count
    const pendingCount = await db.receipt.count({
      where: { status: "PENDING" },
    });

    // Overdue receipts count
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
    console.error("Error fetching payment stats:", error);
    return {
      totalPaymentsThisMonth: 0,
      paymentsCountThisMonth: 0,
      pendingReceiptsCount: 0,
      overdueReceiptsCount: 0,
    };
  }
}
