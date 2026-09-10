"use server";

import { writeActivityLog } from "@/lib/activity-log";
import { logError } from "@/lib/logger";
import { assertOrganizationContextInTransaction, requireOrganizationContext, withTenantTransaction } from "@/lib/organization-context";
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
    const context = await requireOrganizationContext();
    const quote = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const client = await tx.client.findFirst({ where: { id: values.clientId, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { portfolioOwnerId: context.userId } : {}) }, select: { id: true } });
      const insurer = values.insurerId ? await tx.insurer.findFirst({ where: { id: values.insurerId, organizationId: context.organizationId }, select: { id: true } }) : true;
      if (!client || !insurer) throw new Error("TENANT_RELATION_MISMATCH");
      const created = await tx.quote.create({ data: { organizationId: context.organizationId, ...normalizeQuoteInput(values), createdById: context.userId, updatedById: context.userId } });
      await writeActivityLog({ organizationId: context.organizationId, action: "CREATE_QUOTE", entityType: "Quote", entityId: created.id, newValue: { id: created.id.slice(0, 8) }, userId: context.userId, db: tx });
      return created;
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
    const context = await requireOrganizationContext();
    const quote = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const existing = await tx.quote.findFirst({ where: { id, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { client: { portfolioOwnerId: context.userId } } : {}) } });
      const client = await tx.client.findFirst({ where: { id: values.clientId, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { portfolioOwnerId: context.userId } : {}) }, select: { id: true } });
      const insurer = values.insurerId ? await tx.insurer.findFirst({ where: { id: values.insurerId, organizationId: context.organizationId }, select: { id: true } }) : true;
      if (!existing) throw new Error("QUOTE_NOT_FOUND");
      if (!client || !insurer) throw new Error("TENANT_RELATION_MISMATCH");
      const updated = await tx.quote.update({ where: { id }, data: { ...normalizeQuoteInput(values), updatedById: context.userId } });
      await writeActivityLog({ organizationId: context.organizationId, action: "UPDATE_QUOTE", entityType: "Quote", entityId: updated.id, oldValue: { id: existing.id.slice(0, 8) }, newValue: { id: updated.id.slice(0, 8) }, userId: context.userId, db: tx });
      return updated;
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
    const context = await requireOrganizationContext();
    const existingQuote = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const existing = await tx.quote.findFirst({ where: { id, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { client: { portfolioOwnerId: context.userId } } : {}) } });
      if (!existing) throw new Error("QUOTE_NOT_FOUND");
      if (existing.status === "ACCEPTED") throw new Error("QUOTE_ACCEPTED");
      await tx.quote.delete({ where: { id } });
      await writeActivityLog({ organizationId: context.organizationId, action: "DELETE_QUOTE", entityType: "Quote", entityId: id, oldValue: { id: existing.id.slice(0, 8), clientId: existing.clientId }, userId: context.userId, db: tx });
      return existing;
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
    const context = await requireOrganizationContext();
    const outcome = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const permitted = await tx.quote.findMany({
        where: { id: { in: ids }, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { client: { portfolioOwnerId: context.userId } } : {}) },
        select: { id: true, status: true, clientId: true },
      });

    const outOfScope = ids.length - permitted.length;
    const accepted = permitted.filter((quote) => quote.status === "ACCEPTED");
    const target = permitted.filter((quote) => quote.status !== "ACCEPTED" && quote.status !== status);

      if (target.length === 0) return { changed: 0, permitted, target, accepted, outOfScope };

    const targetIds = target.map((quote) => quote.id);
      const result = await tx.quote.updateMany({
      where: { id: { in: targetIds }, organizationId: context.organizationId },
      data: { status: status as BulkQuoteStatus },
    });
      await writeActivityLog({ organizationId: context.organizationId, action: "BULK_UPDATE_STATUS", entityType: "Quote", entityId: targetIds.join(","), newValue: { status, count: result.count }, userId: context.userId, db: tx });
      return { changed: result.count, permitted, target, accepted, outOfScope };
    });
    const { changed, permitted, target, accepted, outOfScope } = outcome;
    if (changed === 0) return errorResult(outOfScope > 0 ? "Ninguna de las cotizaciones seleccionadas está en tu cartera." : accepted.length > 0 ? "Las cotizaciones aceptadas no se pueden cambiar en lote." : "Las cotizaciones seleccionadas ya tienen ese estado.");

    revalidatePaths([
      "/quotes",
      "/dashboard",
      "/today",
      ...[...new Set(target.map((quote) => `/clients/${quote.clientId}`))],
    ]);

    const label = statusLabel(status, "quote");
    const parts = [
      `${changed} cotización${changed !== 1 ? "es" : ""} ${changed !== 1 ? "quedaron" : "quedó"} como “${label}”.`,
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
