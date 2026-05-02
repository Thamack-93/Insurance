"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { normalizeOptionalText, parseDateInput } from "@/lib/form-utils";
import { receiptSchema, type ReceiptFormValues } from "@/lib/validations";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";

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
    const payload = await normalizeReceiptInput(parsed.data);
    const receipt = await db.receipt.create({ data: payload });

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

    const payload = await normalizeReceiptInput(parsed.data);
    const receipt = await db.receipt.update({
      where: { id },
      data: payload,
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