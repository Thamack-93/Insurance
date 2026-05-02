"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { logError } from "@/lib/logger";
import type { QuoteFormValues } from "@/lib/validations";
import {
  errorResult,
  revalidatePaths,
  successResult,
  type MutationResult,
} from "@/lib/mutation-utils";

function normalizeQuoteInput(values: QuoteFormValues) {
  return {
    clientId: values.clientId,
    insurerId: values.insurerId || null,
    policyType: values.policyType,
    status: values.status,
    requestedDate: new Date(values.requestedDate),
    sentDate: values.sentDate ? new Date(values.sentDate) : null,
    validUntil: values.validUntil ? new Date(values.validUntil) : null,
    quotedAmount: values.quotedAmount ?? null,
    notes: values.notes?.trim() || null,
  };
}

export async function createQuote(values: QuoteFormValues): Promise<MutationResult> {
  try {
    const db = getDb();

    const quote = await db.quote.create({
      data: normalizeQuoteInput(values),
    });

    await writeActivityLog({
      action: "CREATE_QUOTE",
      entityType: "Quote",
      entityId: quote.id,
      newValue: { id: quote.id.slice(0, 8) },
    });

    revalidatePaths([
      "/quotes",
      `/quotes/${quote.id}`,
      `/clients/${quote.clientId}`,
      "/dashboard",
      "/today",
    ]);

    return successResult(quote.id, `/quotes/${quote.id}`, "Cotización creada exitosamente.");
  } catch (error) {
    logError("quotes.createQuote", error);
    return errorResult("No se pudo crear la cotización. Intenta de nuevo.");
  }
}

export async function updateQuote(id: string, values: QuoteFormValues): Promise<MutationResult> {
  try {
    const db = getDb();

    const existingQuote = await db.quote.findUnique({
      where: { id },
    });

    if (!existingQuote) {
      return errorResult("Cotización no encontrada.");
    }

    const quote = await db.quote.update({
      where: { id },
      data: normalizeQuoteInput(values),
    });

    await writeActivityLog({
      action: "UPDATE_QUOTE",
      entityType: "Quote",
      entityId: quote.id,
      oldValue: { id: existingQuote.id.slice(0, 8) },
      newValue: { id: quote.id.slice(0, 8) },
    });

    revalidatePaths([
      "/quotes",
      `/quotes/${quote.id}`,
      `/clients/${quote.clientId}`,
      "/dashboard",
      "/today",
    ]);

    return successResult(quote.id, `/quotes/${quote.id}`, "Cotización actualizada exitosamente.");
  } catch (error) {
    logError("quotes.updateQuote", error, { id });
    return errorResult("No se pudo actualizar la cotización. Intenta de nuevo.");
  }
}
