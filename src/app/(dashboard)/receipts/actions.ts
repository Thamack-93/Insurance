"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { AuthError, getCurrentUserId, requireAdmin } from "@/lib/auth";
import { normalizeOptionalText, parseDateInput } from "@/lib/form-utils";
import { receiptSchema, type ReceiptFormValues } from "@/lib/validations";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";

const ALLOWED_PAYMENT_METHODS = ["TRANSFER", "CASH", "CARD", "CHECK", "OTHER"] as const;
type AllowedPaymentMethod = (typeof ALLOWED_PAYMENT_METHODS)[number];

function isAllowedPaymentMethod(value: string): value is AllowedPaymentMethod {
  return (ALLOWED_PAYMENT_METHODS as readonly string[]).includes(value);
}

async function normalizeReceiptInput(values: ReceiptFormValues) {
  const db = getDb();
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
    const payload = await normalizeReceiptInput(parsed.data);
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
    const previousReceipt = await db.receipt.findUnique({ where: { id } });

    if (!previousReceipt) {
      return errorResult("El recibo ya no existe.");
    }

    const userId = await getCurrentUserId();
    const payload = await normalizeReceiptInput(parsed.data);
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
      where: { id: { in: ids } },
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
        await db.payment.create({
          data: {
            receiptId: receipt.id,
            policyId: receipt.policyId,
            clientId: receipt.clientId,
            amount: receipt.amount,
            currency: receipt.currency,
            paidDate: now,
            paymentMethod,
            createdById: userId,
            updatedById: userId,
          },
        });

        await db.receipt.update({
          where: { id: receipt.id },
          data: { status: "PAID", paidDate: now, paymentMethod, updatedById: userId },
        });

        await writeActivityLog({
          entityType: "Receipt",
          entityId: receipt.id,
          action: "RECEIPT_BULK_PAID",
          newValue: {
            receiptNumber: receipt.receiptNumber,
            paymentMethod,
            paidDate: now.toISOString(),
          },
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
