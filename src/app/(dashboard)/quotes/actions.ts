"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { getCurrentUserId } from "@/lib/auth";
import { logError } from "@/lib/logger";
import {
  assertClientPortfolioAccess,
  assertQuotePortfolioAccess,
  quoteOperationalWhere,
  requirePortfolioReadScope,
} from "@/lib/portfolio-access";
import { statusLabel } from "@/lib/status";
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

    const userId = await getCurrentUserId();
    await assertClientPortfolioAccess(values.clientId, userId);
    const quote = await db.quote.create({
      data: { ...normalizeQuoteInput(values), createdById: userId, updatedById: userId },
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
    const userId = await getCurrentUserId();
    await assertQuotePortfolioAccess(id, userId);
    await assertClientPortfolioAccess(values.clientId, userId);

    const existingQuote = await db.quote.findUnique({
      where: { id },
    });

    if (!existingQuote) {
      return errorResult("Cotización no encontrada.");
    }

    const quote = await db.quote.update({
      where: { id },
      data: { ...normalizeQuoteInput(values), updatedById: userId },
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

export async function deleteQuote(id: string): Promise<MutationResult> {
  try {
    const db = getDb();
    const userId = await getCurrentUserId();
    await assertQuotePortfolioAccess(id, userId);

    const existingQuote = await db.quote.findUnique({
      where: { id },
    });

    if (!existingQuote) {
      return errorResult("La cotización ya no existe.");
    }

    if (existingQuote.status === "ACCEPTED") {
      return errorResult(
        "No se puede eliminar: la cotización está aceptada. Cámbiala de estado antes de eliminarla.",
      );
    }

    await db.quote.delete({ where: { id } });

    await writeActivityLog({
      action: "DELETE_QUOTE",
      entityType: "Quote",
      entityId: id,
      oldValue: { id: existingQuote.id.slice(0, 8), clientId: existingQuote.clientId },
    });

    revalidatePaths([
      "/quotes",
      `/clients/${existingQuote.clientId}`,
      "/dashboard",
      "/today",
    ]);

    return successResult(id, "/quotes", "Cotización eliminada.");
  } catch (error) {
    logError("quotes.deleteQuote", error, { id });
    return errorResult("No se pudo eliminar la cotización. Intenta de nuevo.");
  }
}

/** Statuses a bulk edit may assign; ACCEPTED stays manual because it emits a policy. */
const BULK_QUOTE_STATUSES = ["SENT", "REJECTED", "EXPIRED", "CANCELLED"] as const;
export type BulkQuoteStatus = (typeof BULK_QUOTE_STATUSES)[number];

/**
 * Applies a status to several quotes at once. Ids outside the caller's
 * portfolio are dropped rather than failing the whole batch, and accepted
 * quotes are left alone so a bulk edit can never undo a sold policy.
 */
export async function bulkUpdateQuoteStatus(
  ids: string[],
  status: string,
): Promise<MutationResult> {
  if (ids.length === 0) return errorResult("No hay cotizaciones seleccionadas.");
  if (!BULK_QUOTE_STATUSES.includes(status as BulkQuoteStatus)) {
    return errorResult("Ese estado no se puede aplicar en lote.");
  }

  try {
    const scope = await requirePortfolioReadScope();
    const db = getDb();

    const permitted = await db.quote.findMany({
      where: { id: { in: ids }, ...quoteOperationalWhere(scope.portfolioOwnerId) },
      select: { id: true, status: true, clientId: true },
    });

    const outOfScope = ids.length - permitted.length;
    const accepted = permitted.filter((quote) => quote.status === "ACCEPTED");
    const target = permitted.filter((quote) => quote.status !== "ACCEPTED" && quote.status !== status);

    if (target.length === 0) {
      return errorResult(
        outOfScope > 0
          ? "Ninguna de las cotizaciones seleccionadas está en tu cartera."
          : accepted.length > 0
            ? "Las cotizaciones aceptadas no se pueden cambiar en lote."
            : "Las cotizaciones seleccionadas ya tienen ese estado.",
      );
    }

    const targetIds = target.map((quote) => quote.id);
    const result = await db.quote.updateMany({
      where: { id: { in: targetIds } },
      data: { status: status as BulkQuoteStatus },
    });

    await writeActivityLog({
      action: "BULK_UPDATE_STATUS",
      entityType: "Quote",
      entityId: targetIds.join(","),
      newValue: { status, count: result.count },
    });

    revalidatePaths([
      "/quotes",
      "/dashboard",
      "/today",
      ...[...new Set(target.map((quote) => `/clients/${quote.clientId}`))],
    ]);

    const label = statusLabel(status, "quote");
    const parts = [
      `${result.count} cotización${result.count !== 1 ? "es" : ""} ${result.count !== 1 ? "quedaron" : "quedó"} como “${label}”.`,
    ];
    const unchanged = permitted.length - target.length - accepted.length;
    if (unchanged > 0) parts.push(`${unchanged} ya ${unchanged !== 1 ? "tenían" : "tenía"} ese estado.`);
    if (accepted.length > 0) {
      parts.push(`${accepted.length} aceptada${accepted.length !== 1 ? "s" : ""} se ${accepted.length !== 1 ? "omitieron" : "omitió"}.`);
    }
    if (outOfScope > 0) parts.push(`${outOfScope} no ${outOfScope !== 1 ? "están" : "está"} en tu cartera.`);

    return successResult("bulk", "", parts.join(" "));
  } catch (error) {
    logError("quotes.bulkUpdateQuoteStatus", error, { count: ids.length, status });
    return errorResult("No se pudo actualizar el estado de las cotizaciones seleccionadas.");
  }
}
