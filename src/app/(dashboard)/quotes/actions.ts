"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import type { QuoteFormValues } from "@/lib/validations";
import type { MutationResult } from "@/lib/mutation-utils";

export async function createQuote(values: QuoteFormValues): Promise<MutationResult> {
  try {
    const db = getDb();

    const quote = await db.quote.create({
      data: {
        clientId: values.clientId,
        insurerId: values.insurerId || null,
        policyType: values.policyType,
        status: values.status,
        requestedDate: new Date(values.requestedDate),
        sentDate: values.sentDate ? new Date(values.sentDate) : null,
        validUntil: values.validUntil ? new Date(values.validUntil) : null,
        quotedAmount: values.quotedAmount ? values.quotedAmount : null,
        notes: values.notes || null,
      },
    });

    await writeActivityLog({
      action: "CREATE_QUOTE",
      entityType: "Quote",
      entityId: quote.id,
      newValue: { id: quote.id.slice(0, 8) },
    });

    return {
      ok: true,
      id: quote.id,
      redirectTo: `/quotes/${quote.id}`,
      message: "Cotización creada exitosamente.",
    };
  } catch (error) {
    console.error("Error creating quote:", error);
    return { ok: false, error: "No se pudo crear la cotización. Intenta de nuevo." };
  }
}

export async function updateQuote(id: string, values: QuoteFormValues): Promise<MutationResult> {
  try {
    const db = getDb();

    const existingQuote = await db.quote.findUnique({
      where: { id },
    });

    if (!existingQuote) {
      return { ok: false, error: "Cotización no encontrada." };
    }

    const quote = await db.quote.update({
      where: { id },
      data: {
        clientId: values.clientId,
        insurerId: values.insurerId || null,
        policyType: values.policyType,
        status: values.status,
        requestedDate: new Date(values.requestedDate),
        sentDate: values.sentDate ? new Date(values.sentDate) : null,
        validUntil: values.validUntil ? new Date(values.validUntil) : null,
        quotedAmount: values.quotedAmount ? values.quotedAmount : null,
        notes: values.notes || null,
      },
    });

    await writeActivityLog({
      action: "UPDATE_QUOTE",
      entityType: "Quote",
      entityId: quote.id,
      oldValue: { id: existingQuote.id.slice(0, 8) },
      newValue: { id: quote.id.slice(0, 8) },
    });

    return {
      ok: true,
      id: quote.id,
      redirectTo: `/quotes/${quote.id}`,
      message: "Cotización actualizada exitosamente.",
    };
  } catch (error) {
    console.error("Error updating quote:", error);
    return { ok: false, error: "No se pudo actualizar la cotización. Intenta de nuevo." };
  }
}
