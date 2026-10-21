import "server-only";

import { assertOrganizationContextInTransaction, requireOrganizationContext, withTenantTransaction } from "@/lib/organization-context";
import { quoteOperationalWhere } from "@/lib/portfolio-access";
import { writeActivityLog } from "@/lib/activity-log";

export type AutoQuoteTerms = { vehicle?: { make?: string; model?: string; year?: number; vin?: string }; coveragePeriod?: { start?: string; end?: string }; premium?: { amount?: number; currency?: string }; limits?: Record<string, string | number>; deductibles?: Record<string, string | number>; exclusions?: string[]; validUntil?: string };

export function normalizeAutoQuoteTerms(input: AutoQuoteTerms) {
  const terms = JSON.parse(JSON.stringify(input)) as AutoQuoteTerms;
  if (terms.premium?.currency) terms.premium.currency = terms.premium.currency.toUpperCase();
  return terms;
}

export function compareAutoQuoteConsistency(left: AutoQuoteTerms, right: AutoQuoteTerms) {
  const warnings: string[] = [];
  if (left.vehicle?.vin && right.vehicle?.vin && left.vehicle.vin !== right.vehicle.vin) warnings.push("Vehículos distintos.");
  if (left.coveragePeriod?.start && right.coveragePeriod?.start && left.coveragePeriod.start !== right.coveragePeriod.start) warnings.push("Periodos de cobertura distintos.");
  if (left.premium?.currency && right.premium?.currency && left.premium.currency.toUpperCase() !== right.premium.currency.toUpperCase()) warnings.push("Monedas distintas.");
  return warnings;
}

export function hasUniqueQuoteIds(quoteIds: string[]) {
  return new Set(quoteIds).size === quoteIds.length;
}

export async function createQuoteComparison(input: { clientId: string; policyType: string; quoteIds: string[]; terms?: Record<string, AutoQuoteTerms> }) {
  const context = await requireOrganizationContext();
  return withTenantTransaction(context, async (tx) => {
    await assertOrganizationContextInTransaction(tx, context);
    if (!hasUniqueQuoteIds(input.quoteIds)) throw new Error("QUOTE_COMPARISON_SCOPE");
    const client = await tx.client.findFirst({ where: { id: input.clientId, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { portfolioOwnerId: context.userId } : {}) }, select: { id: true } });
    const quotes = await tx.quote.findMany({ where: { id: { in: input.quoteIds }, clientId: input.clientId, ...quoteOperationalWhere(context.membershipRole === "AGENT" ? context.userId : undefined, context.organizationId) }, select: { id: true, policyType: true } });
    if (!client || quotes.length !== input.quoteIds.length || quotes.some((quote) => quote.policyType !== input.policyType)) throw new Error("QUOTE_COMPARISON_SCOPE");
    const comparison = await tx.quoteComparison.create({ data: { organizationId: context.organizationId, clientId: client.id, policyType: input.policyType, createdById: context.userId, items: { create: quotes.map((quote) => ({ organizationId: context.organizationId, quoteId: quote.id, termsJson: input.terms?.[quote.id] ? JSON.stringify(normalizeAutoQuoteTerms(input.terms[quote.id])) : null, reviewStatus: input.terms?.[quote.id] ? "REVIEW" : "MISSING_TERMS" })) } }, include: { items: true } });
    await writeActivityLog({ organizationId: context.organizationId, action: "CREATE_QUOTE_COMPARISON", entityType: "QuoteComparison", entityId: comparison.id, newValue: { quoteIds: input.quoteIds }, userId: context.userId, db: tx });
    return comparison;
  });
}

export async function selectComparisonQuote(input: { comparisonId: string; quoteId: string; expectedVersion: number; reason: string }) {
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 500) : "";
  if (!reason) throw new Error("QUOTE_COMPARISON_INVALID_REASON");
  const context = await requireOrganizationContext();
  return withTenantTransaction(context, async (tx) => {
    await assertOrganizationContextInTransaction(tx, context);
    const portfolioOwnerId = context.membershipRole === "AGENT" ? context.userId : undefined;
    const comparison = await tx.quoteComparison.findFirst({ where: { id: input.comparisonId, organizationId: context.organizationId, ...(portfolioOwnerId ? { client: { organizationId: context.organizationId, portfolioOwnerId } } : {}) }, include: { items: { select: { quoteId: true } } } });
    if (!comparison || comparison.version !== input.expectedVersion || !comparison.items.some((item) => item.quoteId === input.quoteId)) throw new Error("QUOTE_COMPARISON_CONFLICT");
    const quote = await tx.quote.findFirst({ where: { id: input.quoteId, clientId: comparison.clientId, policyType: comparison.policyType, ...quoteOperationalWhere(portfolioOwnerId, context.organizationId) }, select: { id: true } });
    if (!quote) throw new Error("QUOTE_COMPARISON_CONFLICT");
    const updated = await tx.quoteComparison.updateMany({ where: { id: comparison.id, organizationId: context.organizationId, version: input.expectedVersion }, data: { selectedQuoteId: input.quoteId, selectedAt: new Date(), selectionReason: reason, status: "SELECTED", version: { increment: 1 } } });
    if (updated.count !== 1) throw new Error("QUOTE_COMPARISON_CONFLICT");
    await writeActivityLog({ organizationId: context.organizationId, action: "SELECT_QUOTE_COMPARISON", entityType: "QuoteComparison", entityId: comparison.id, newValue: { quoteId: input.quoteId, reason }, userId: context.userId, db: tx });
    return { ok: true };
  });
}
