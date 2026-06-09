"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { AuthError, getCurrentUserId, requireAdmin } from "@/lib/auth";
import { normalizeOptionalText, parseDateInput } from "@/lib/form-utils";
import { receiptSchema, type ReceiptFormValues } from "@/lib/validations";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";
import { recordPayment } from "@/lib/payment-service";
import {
  assertPolicyPortfolioAccess,
  assertReceiptPortfolioAccess,
  receiptPortfolioWhere,
} from "@/lib/portfolio-access";

const ALLOWED_PAYMENT_METHODS = ["TRANSFER", "CASH", "CARD", "CHECK", "OTHER"] as const;
type AllowedPaymentMethod = (typeof ALLOWED_PAYMENT_METHODS)[number];

function isAllowedPaymentMethod(value: string): value is AllowedPaymentMethod {
  return (ALLOWED_PAYMENT_METHODS as readonly string[]).includes(value);
}

async function normalizeReceiptInput(values: ReceiptFormValues, userId: string) {
  const db = getDb();
  await assertPolicyPortfolioAccess(values.policyId, userId);
  const policy = await db.policy.findUnique({
    where: { id: values.policyId },
    select: { id: true, clientId: true, insurerId: true, currency: true },
  });

  if (!policy) {
    throw new Error("La poliza seleccionada ya no existe.");
  }

  return {
    receiptNumber: values.receiptNumber.trim(),
    policyId: policy.id,
    clientId: policy.clientId,
    insurerId: policy.insurerId,
    periodStartDate: parseDateInput(values.periodStartDate),
    periodEndDate: parseDateInput(values.periodEndDate),
    dueDate: parseDateInput(values.dueDate),
    amount: values.amount,
    currency: values.currency || policy.currency,
    status: values.status,
    paidDate: values.paidDate ? parseDateInput(values.paidDate) : null,
    paymentMethod: normalizeOptionalText(values.paymentMethod),
    notes: normalizeOptionalText(values.notes),
  };
}

export async function createReceipt(values: ReceiptFormValues): Promise<MutationResult> {
  const parsed = receiptSchema.safeParse(values);

  if (!parsed.success) {
    return errorResult(parsed.error.issues[0]?.message ?? "No se pudo validar el recibo.");
  }

  try {
    const db = getDb();
    const userId = await getCurrentUserId();
    const payload = await normalizeReceiptInput(parsed.data, userId);
    const receipt = await db.receipt.create({ data: { ...payload, createdById: userId, updatedById: userId } });

    await writeActivityLog({
      entityType: "Receipt",
      entityId: receipt.id,
      action: "RECEIPT_CREATE",
      newValue: receipt,
    });

    revalidatePaths([
      "/receipts",
      "/due-payments",
      `/policies/${receipt.policyId}`,
      `/clients/${receipt.clientId}`,
      "/dashboard",
      "/today",
      "/portfolio",
      "/risks",
    ]);

    return successResult(receipt.id, "/receipts", "Recibo creado.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo crear el recibo.");
  }
}

export async function updateReceipt(id: string, values: ReceiptFormValues): Promise<MutationResult> {
  const parsed = receiptSchema.safeParse(values);

  if (!parsed.success) {
    return errorResult(parsed.error.issues[0]?.message ?? "No se pudo validar el recibo.");
  }

  try {
    const db = getDb();
    const userId = await getCurrentUserId();
    await assertReceiptPortfolioAccess(id, userId);
    const previousReceipt = await db.receipt.findUnique({ where: { id } });

    if (!previousReceipt) {
      return errorResult("El recibo ya no existe.");
    }

    const payload = await normalizeReceiptInput(parsed.data, userId);
    const receipt = await db.receipt.update({
      where: { id },
      data: { ...payload, updatedById: userId },
    });

    await writeActivityLog({
      entityType: "Receipt",
      entityId: receipt.id,
      action: "RECEIPT_UPDATE",
      oldValue: previousReceipt,
      newValue: receipt,
    });

    revalidatePaths([
      "/receipts",
      "/due-payments",
      `/policies/${receipt.policyId}`,
      `/clients/${receipt.clientId}`,
      "/dashboard",
      "/today",
      "/portfolio",
      "/risks",
    ]);

    return successResult(receipt.id, "/receipts", "Recibo actualizado.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo actualizar el recibo.");
  }
}

export async function cancelReceiptAndPolicy(id: string): Promise<MutationResult> {
  try {
    const db = getDb();
    const userId = await getCurrentUserId();
    await assertReceiptPortfolioAccess(id, userId);

    const existingReceipt = await db.receipt.findUnique({
      where: { id },
      include: {
        policy: {
          select: {
            id: true,
            policyNumber: true,
            status: true,
            clientId: true,
          },
        },
        payments: {
          select: { id: true },
        },
      },
    });

    if (!existingReceipt) {
      return errorResult("El recibo ya no existe.");
    }

    if (existingReceipt.status === "CANCELLED") {
      return successResult(existingReceipt.id, `/receipts/${existingReceipt.id}`, "El recibo ya estaba cancelado.");
    }

    if (existingReceipt.payments.length > 0) {
      return errorResult("No se puede cancelar: elimina primero los pagos registrados desde el detalle del recibo.");
    }

    const openPolicyReceipts = await db.receipt.findMany({
      where: {
        policyId: existingReceipt.policyId,
        status: { notIn: ["PAID", "CANCELLED"] },
      },
      select: {
        id: true,
        receiptNumber: true,
        status: true,
        payments: {
          select: { id: true },
        },
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    });

    const blockedReceipts = openPolicyReceipts.filter((receipt) => receipt.payments.length > 0);
    if (blockedReceipts.length > 0) {
      const numbers = blockedReceipts.map((receipt) => receipt.receiptNumber).join(", ");
      return errorResult(
        `No se puede cancelar la póliza: elimina primero los pagos registrados de ${blockedReceipts.length} recibo${blockedReceipts.length !== 1 ? "s" : ""} abierto${blockedReceipts.length !== 1 ? "s" : ""} (${numbers}).`,
      );
    }

    if (openPolicyReceipts.length === 0) {
      return errorResult("No hay recibos abiertos para cancelar en esta póliza.");
    }

    const now = new Date();
    const cancelledReceipts: Array<{ id: string; receiptNumber: string }> = [];
    let updatedPolicy: { id: string; policyNumber: string; status: string; clientId: string } | null = null;

    await db.$transaction(async (tx) => {
      updatedPolicy = await tx.policy.update({
        where: { id: existingReceipt.policy.id },
        data: {
          status: "CANCELLED",
          updatedById: userId,
        },
        select: { id: true, policyNumber: true, status: true, clientId: true },
      });

      for (const receipt of openPolicyReceipts) {
        const updatedReceipt = await tx.receipt.update({
          where: { id: receipt.id },
          data: {
            status: "CANCELLED",
            paidDate: null,
            paymentMethod: null,
            updatedById: userId,
          },
          select: {
            id: true,
            receiptNumber: true,
            status: true,
            policyId: true,
            clientId: true,
          },
        });

        cancelledReceipts.push({ id: updatedReceipt.id, receiptNumber: updatedReceipt.receiptNumber });

        await writeActivityLog({
          entityType: "Receipt",
          entityId: updatedReceipt.id,
          action: "RECEIPT_CANCEL_NON_PAYMENT",
          oldValue: receipt,
          newValue: updatedReceipt,
          userId,
          db: tx,
        });
      }

      await tx.receiptReconciliationIssue.updateMany({
        where: {
          receiptId: { in: cancelledReceipts.map((receipt) => receipt.id) },
          status: "OPEN",
        },
        data: {
          status: "RESOLVED",
          reviewedAt: now,
          reviewedById: userId,
          resolutionNote: "Cancelado por falta de pago desde Receipts & Payments.",
        },
      });

      await writeActivityLog({
        entityType: "Policy",
        entityId: existingReceipt.policy.id,
        action: "POLICY_CANCEL_NON_PAYMENT",
        oldValue: existingReceipt.policy,
        newValue: updatedPolicy,
        userId,
        db: tx,
      });
    });

    revalidatePaths([
      "/receipts",
      "/due-payments",
      `/receipts/${existingReceipt.id}`,
      ...cancelledReceipts.map((receipt) => `/receipts/${receipt.id}`),
      `/policies/${existingReceipt.policy.id}`,
      `/clients/${existingReceipt.policy.clientId}`,
      "/dashboard",
      "/today",
      "/portfolio",
      "/renewals",
      "/risks",
      "/data-quality",
    ]);

    return successResult(
      existingReceipt.id,
      `/receipts/${existingReceipt.id}`,
      cancelledReceipts.length > 1
        ? `Póliza cancelada por falta de pago y ${cancelledReceipts.length} recibos abiertos cerrados.`
        : "Recibo cancelado por falta de pago y póliza cerrada.",
    );
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    return errorResult(error instanceof Error ? error.message : "No se pudo cancelar el recibo.");
  }
}

export async function cancelReceipt(id: string): Promise<MutationResult> {
  try {
    const db = getDb();
    const userId = await getCurrentUserId();
    await assertReceiptPortfolioAccess(id, userId);

    const existingReceipt = await db.receipt.findUnique({
      where: { id },
      include: {
        policy: {
          select: {
            id: true,
            policyNumber: true,
            clientId: true,
          },
        },
        payments: {
          select: { id: true },
        },
      },
    });

    if (!existingReceipt) {
      return errorResult("El recibo ya no existe.");
    }

    if (existingReceipt.status === "CANCELLED") {
      return successResult(existingReceipt.id, `/receipts/${existingReceipt.id}`, "El recibo ya estaba cancelado.");
    }

    if (existingReceipt.payments.length > 0) {
      return errorResult("No se puede cancelar: elimina primero los pagos registrados desde el detalle del recibo.");
    }

    const updatedReceipt = await db.receipt.update({
      where: { id },
      data: {
        status: "CANCELLED",
        paidDate: null,
        paymentMethod: null,
        updatedById: userId,
      },
    });

    await writeActivityLog({
      entityType: "Receipt",
      entityId: updatedReceipt.id,
      action: "RECEIPT_CANCEL",
      oldValue: existingReceipt,
      newValue: updatedReceipt,
    });

    revalidatePaths([
      "/receipts",
      "/due-payments",
      `/receipts/${updatedReceipt.id}`,
      `/policies/${existingReceipt.policy.id}`,
      `/clients/${existingReceipt.policy.clientId}`,
      "/dashboard",
      "/today",
      "/portfolio",
      "/renewals",
      "/risks",
      "/data-quality",
    ]);

    return successResult(updatedReceipt.id, `/receipts/${updatedReceipt.id}`, "Recibo cancelado.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    return errorResult(error instanceof Error ? error.message : "No se pudo cancelar el recibo.");
  }
}

export async function bulkMarkReceiptsPaid(
  ids: string[],
  paymentMethod: string = "TRANSFER"
): Promise<MutationResult> {
  if (!ids.length) return errorResult("No hay recibos seleccionados.");
  if (!isAllowedPaymentMethod(paymentMethod)) {
    return errorResult("Método de pago no válido.");
  }

  const db = getDb();
  const userId = await getCurrentUserId();
  const now = new Date();

  try {
    const receipts = await db.receipt.findMany({
      where: { id: { in: ids }, ...receiptPortfolioWhere(userId) },
      select: {
        id: true,
        receiptNumber: true,
        policyId: true,
        clientId: true,
        currency: true,
        amount: true,
        status: true,
      },
    });

    const eligible = receipts.filter((r) => r.status !== "PAID" && r.status !== "CANCELLED");

    if (eligible.length === 0) {
      return errorResult("No hay recibos pendientes en la selección.");
    }

    let okCount = 0;
    const failures: string[] = [];

    for (const receipt of eligible) {
      try {
        await recordPayment({
          receiptId: receipt.id,
          amount: Number(receipt.amount),
          paidDate: now,
          paymentMethod,
          sourceEvidenceKey: `bulk:${receipt.id}:${now.toISOString()}`,
          actorId: userId,
        });

        okCount += 1;
      } catch (innerError) {
        failures.push(receipt.receiptNumber);
        console.error(`bulkMarkReceiptsPaid failed for ${receipt.id}`, innerError);
      }
    }

    revalidatePaths([
      "/receipts",
      "/due-payments",
      "/dashboard",
      "/today",
      "/portfolio",
    ]);

    if (okCount === 0) {
      return errorResult("No se pudo marcar ningún recibo como pagado.");
    }

    const skipped = ids.length - eligible.length;
    const parts = [`${okCount} recibo${okCount !== 1 ? "s" : ""} marcado${okCount !== 1 ? "s" : ""} como pagado${okCount !== 1 ? "s" : ""}.`];
    if (skipped > 0) parts.push(`${skipped} ya estaba${skipped !== 1 ? "n" : ""} pagado${skipped !== 1 ? "s" : ""} o cancelado${skipped !== 1 ? "s" : ""}.`);
    if (failures.length) parts.push(`${failures.length} fallaron: ${failures.join(", ")}.`);

    return successResult("bulk", "", parts.join(" "));
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudieron marcar los recibos.");
  }
}
export async function deleteReceipt(id: string): Promise<MutationResult> {
  try {
    await requireAdmin();
    const db = getDb();

    const existingReceipt = await db.receipt.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            payments: true,
            commissions: true,
          },
        },
      },
    });

    if (!existingReceipt) {
      return errorResult("El recibo ya no existe.");
    }

    const counts = existingReceipt._count;
    const blockers: string[] = [];
    if (counts.payments > 0) blockers.push(`${counts.payments} pago${counts.payments !== 1 ? "s" : ""}`);
    if (counts.commissions > 0) blockers.push(`${counts.commissions} comisión${counts.commissions !== 1 ? "es" : ""}`);

    if (blockers.length > 0) {
      return errorResult(
        `No se puede eliminar: el recibo tiene ${blockers.join(", ")} asociado${blockers.length > 1 ? "s" : ""}. Cancela o elimina primero esos registros.`,
      );
    }

    await db.receipt.delete({ where: { id } });

    await writeActivityLog({
      entityType: "Receipt",
      entityId: id,
      action: "RECEIPT_DELETE",
      oldValue: {
        receiptNumber: existingReceipt.receiptNumber,
        policyId: existingReceipt.policyId,
        clientId: existingReceipt.clientId,
      },
    });

    revalidatePaths([
      "/receipts",
      "/due-payments",
      `/policies/${existingReceipt.policyId}`,
      `/clients/${existingReceipt.clientId}`,
      "/dashboard",
      "/today",
      "/portfolio",
      "/risks",
    ]);

    return successResult(id, "/receipts", "Recibo eliminado.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    return errorResult(error instanceof Error ? error.message : "No se pudo eliminar el recibo.");
  }
}
