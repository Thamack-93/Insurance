import "server-only";

import { tool } from "ai";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { today } from "@/lib/dates";
import { businessAddDays } from "@/lib/business-dates";
import { getTodayData } from "@/lib/dashboard-queries";
import { loadEligibleRenewalPolicies } from "@/lib/renewals";
import { getWorkItems, OPEN_WORK_ITEM_STATUSES } from "@/lib/work-queue";
import { detectRisks } from "@/lib/risk-engine";
import { buildAssistantActionProposalFromPlan } from "@/lib/assistant-actions";
import { getClaimChecklistSummary } from "@/lib/claim-checklists";
import { searchUserPortfolio } from "@/lib/assistant-local";
import { requireOrganizationContext } from "@/lib/organization-context";
import { searchKnowledgeBase } from "@/lib/knowledge-base";
import {
  claimOperationalWhere,
  clientOperationalWhere,
  endorsementOperationalWhere,
  policyOperationalWhere,
  receiptOperationalWhere,
  workItemOperationalWhere,
} from "@/lib/portfolio-access";
import type {
  AssistantActionProposal,
  AssistantAiToolTraceEntry,
  AssistantMutationPlan,
  AssistantUser,
  AssistantKnowledgeCitation,
} from "@/lib/assistant-types";

const mutationFieldSchema = z.object({ field: z.string().min(1).max(64), label: z.string().min(1).max(80), value: z.string().max(500) });
const mutationRelationSchema = z.object({ field: z.string().min(1).max(64), label: z.string().min(1).max(80), query: z.string().min(1).max(250) });
const mutationMissingFieldSchema = z.object({ field: z.string().min(1).max(64), label: z.string().min(1).max(80), question: z.string().min(1).max(250) });
const mutationPlanSchema = z.object({
  entityType: z.enum(["client", "policy", "receipt", "payment", "workItem", "endorsement", "claim", "claimChecklistItem"]),
  operation: z.enum(["create", "update"]),
  targetQuery: z.string().min(1).max(250).nullable(),
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(800),
  reply: z.string().min(1).max(800),
  fields: z.array(mutationFieldSchema).max(20),
  relations: z.array(mutationRelationSchema).max(10),
  missingFields: z.array(mutationMissingFieldSchema).max(10),
});
const toolRecordSchema = z.record(z.string(), z.unknown());
const searchOutputSchema = z.array(z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  subtitle: z.string().nullish(),
  parentLabel: z.string().nullish(),
  href: z.string().nullish(),
}));
const nullableRecordOutputSchema = toolRecordSchema.nullable();
const recordListOutputSchema = z.array(toolRecordSchema);
const draftOutputSchema = z.union([
  z.object({ prepared: z.literal(true), proposal: toolRecordSchema }),
  z.object({ prepared: z.literal(false), reason: z.string() }),
]);
const knowledgeOutputSchema = z.object({
  results: z.array(z.object({
    sourceId: z.string(),
    sourceType: z.enum(["INTERNAL", "GENERAL"]),
    title: z.string(),
    version: z.string(),
    sourceUrl: z.string().nullable(),
    authority: z.string().nullable(),
    reviewedAt: z.string().nullable(),
    page: z.number().nullable(),
    section: z.string().nullable(),
    match: z.number(),
    excerpt: z.string(),
    insurerName: z.string().nullable().optional(),
    product: z.string().nullable().optional(),
  })),
  requiresInternalEvidence: z.boolean(),
  abstained: z.boolean(),
});

async function requireNoraToolScope(expectedUserId: string) {
  const context = await requireOrganizationContext();
  if (context.userId !== expectedUserId) throw new AuthError("La sesión de Nora cambió. Vuelve a intentarlo.", 403);
  return {
    id: context.userId,
    role: context.membershipRole === "AGENT" ? "AGENT" as const : "ADMIN" as const,
    portfolioOwnerId: context.membershipRole === "AGENT" ? context.userId : undefined,
    organizationId: context.organizationId,
  };
}

function iso(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

export function createNoraAgentTools(user: AssistantUser, options: { gmmMetadataOnly?: boolean } = {}) {
  const trace: AssistantAiToolTraceEntry[] = [];
  const knowledgeCitations = new Map<string, AssistantKnowledgeCitation>();
  let actionProposal: AssistantActionProposal | null = null;

  async function traced<T>(name: string, outputSchema: z.ZodType<T>, operation: () => Promise<unknown>): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = outputSchema.parse(await operation());
      trace.push({ tool: name, outcome: "success", durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      trace.push({ tool: name, outcome: "error", durationMs: Date.now() - startedAt });
      throw error;
    }
  }

  const tools = {
    searchPortfolio: tool({
      description: "Busca entidades accesibles por número, nombre, RFC, folio, serie o texto. No otorga acceso; solo devuelve resultados autorizados.",
      inputSchema: z.object({ query: z.string().trim().min(2).max(250) }),
      execute: ({ query }) => traced("searchPortfolio", searchOutputSchema, async () => {
        const scope = await requireNoraToolScope(user.id);
        const freshUser: AssistantUser = { id: scope.id, role: scope.role, organizationId: scope.organizationId };
        const results = await searchUserPortfolio(freshUser, query);
        return results.map((result) => options.gmmMetadataOnly
          ? { id: result.id, type: result.type, title: result.title }
          : { id: result.id, type: result.type, title: result.title, subtitle: result.subtitle, parentLabel: result.parentLabel, href: result.href });
      }),
    }),
    searchKnowledgeBase: tool({
      description: "Busca evidencia breve en la base de conocimiento autorizada. Para preguntas contractuales solo acepta fuentes internas activas y devuelve citas; nunca devuelve archivos completos.",
      inputSchema: z.object({
        question: z.string().trim().min(2).max(500),
        sourceType: z.enum(["INTERNAL", "GENERAL", "BOTH"]).default("BOTH"),
        insurerName: z.string().trim().max(160).nullish(),
        product: z.string().trim().max(120).nullish(),
        limit: z.number().int().min(1).max(5).default(5),
      }),
      execute: ({ question, sourceType, insurerName, product, limit }) => traced("searchKnowledgeBase", knowledgeOutputSchema, async () => {
        const scope = await requireNoraToolScope(user.id);
        if (options.gmmMetadataOnly) return { results: [], requiresInternalEvidence: false, abstained: true };
        const result = await searchKnowledgeBase({ organizationId: scope.organizationId, question, sourceType, insurerName, product, limit });
        for (const citation of result.results) {
          knowledgeCitations.set(`${citation.sourceType}:${citation.sourceId}:${citation.page ?? ""}:${citation.section ?? ""}`, {
            sourceId: citation.sourceId,
            sourceType: citation.sourceType,
            title: citation.title,
            version: citation.version,
            sourceUrl: citation.sourceUrl,
            authority: citation.authority,
            reviewedAt: citation.reviewedAt,
            page: citation.page,
            section: citation.section,
          });
        }
        return result;
      }),
    }),
    getEntitySummary: tool({
      description: "Obtiene un resumen autorizado de una entidad identificada. Para GMM omite narrativa y contenido médico.",
      inputSchema: z.object({ type: z.enum(["client", "policy", "receipt", "workItem", "claim", "endorsement"]), id: z.string().min(1).max(100) }),
      execute: ({ type, id }) => traced("getEntitySummary", nullableRecordOutputSchema, async () => {
        const scope = await requireNoraToolScope(user.id);
        if (options.gmmMetadataOnly && type !== "claim") return { restricted: true, reason: "El contexto GMM solo permite metadatos del siniestro y su checklist." };
        const db = getDb();
        switch (type) {
          case "client": return db.client.findFirst({ where: { AND: [{ id }, clientOperationalWhere(scope.portfolioOwnerId, scope.organizationId)] }, select: { id: true, fullName: true, type: true, status: true, email: true, phone: true } });
          case "policy": return db.policy.findFirst({ where: { AND: [{ id }, policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId)] }, select: { id: true, policyNumber: true, policyType: true, status: true, startDate: true, endDate: true, premiumAmount: true, currency: true, client: { select: { fullName: true } }, insurer: { select: { name: true } } } });
          case "receipt": return db.receipt.findFirst({ where: { AND: [{ id }, receiptOperationalWhere(scope.portfolioOwnerId, scope.organizationId)] }, select: { id: true, receiptNumber: true, status: true, dueDate: true, amount: true, currency: true, client: { select: { fullName: true } }, policy: { select: { policyNumber: true } } } });
          case "workItem": return db.workItem.findFirst({ where: { AND: [{ id }, workItemOperationalWhere(scope.portfolioOwnerId, scope.organizationId)] }, select: { id: true, title: true, status: true, priority: true, dueDate: true, client: { select: { fullName: true } }, policy: { select: { policyNumber: true } } } });
          case "endorsement": return db.policyEndorsement.findFirst({ where: { AND: [{ id }, endorsementOperationalWhere(scope.portfolioOwnerId, scope.organizationId)] }, select: { id: true, endorsementNumber: true, status: true, startDate: true, endDate: true, concept: true, policy: { select: { policyNumber: true } } } });
          case "claim": {
            const claim = await db.claim.findFirst({ where: { AND: [{ id }, claimOperationalWhere(scope.portfolioOwnerId, scope.organizationId)] }, select: { id: true, folio: true, status: true, claimType: true, incidentDate: true, reportedDate: true, amountClaimed: true, amountPaid: true, description: true, client: { select: { fullName: true } }, policy: { select: { policyNumber: true, policyType: true } }, insurer: { select: { name: true } } } });
            if (!claim) return null;
            if (claim.policy.policyType === "GMM") return { id: claim.id, folio: claim.folio, status: claim.status, policyType: "GMM", policyNumber: claim.policy.policyNumber, incidentDate: iso(claim.incidentDate), reportedDate: iso(claim.reportedDate), metadataOnly: true };
            if (options.gmmMetadataOnly) return { restricted: true, reason: "El siniestro no corresponde al contexto GMM autorizado." };
            return claim;
          }
        }
      }),
    }),
    getTodayBrief: tool({
      description: "Obtiene el resumen operativo de hoy dentro de la cartera autorizada.",
      inputSchema: z.object({}),
      execute: () => traced("getTodayBrief", toolRecordSchema, async () => {
        await requireNoraToolScope(user.id);
        const data = await getTodayData();
        return {
          counts: { overdueReceipts: data.overduePayments.length, dueToday: data.paymentsDueToday.length, due7: data.paymentsDue7.length, renewals30: data.urgentRenewals.length, overdueWorkItems: data.overdueWorkItems.length, commissions: data.commissionsToReview.length },
          overdueReceipts: data.overduePayments.slice(0, 8).map((item) => ({ id: item.id, receiptNumber: item.receiptNumber, dueDate: iso(item.dueDate), amount: Number(item.amount), currency: item.currency, client: item.client.fullName, policyNumber: item.policy.policyNumber })),
          renewals: data.urgentRenewals.slice(0, 8).map((item) => ({ id: item.id, policyNumber: item.policyNumber, endDate: iso(item.endDate), client: item.client.fullName })),
          workItems: data.overdueWorkItems.slice(0, 8).map((item) => ({ id: item.id, title: item.title, status: item.status, dueDate: iso(item.dueDate) })),
        };
      }),
    }),
    listRenewals: tool({
      description: "Lista renovaciones elegibles en una ventana de 1 a 90 días.",
      inputSchema: z.object({ days: z.number().int().min(1).max(90).default(30) }),
      execute: ({ days }) => traced("listRenewals", recordListOutputSchema, async () => {
        const scope = await requireNoraToolScope(user.id);
        const start = today();
        const policies = await loadEligibleRenewalPolicies({ endDate: { gte: start, lte: businessAddDays(start, days) } }, scope.portfolioOwnerId, scope.organizationId);
        return policies.slice(0, 25).map((item) => ({ id: item.id, policyNumber: item.policyNumber, endDate: iso(item.endDate), client: item.client.fullName, insurer: item.insurer.name, premiumAmount: Number(item.premiumAmount), currency: item.currency }));
      }),
    }),
    listReceipts: tool({
      description: "Lista recibos vencidos, de hoy o próximos dentro de la cartera autorizada.",
      inputSchema: z.object({ state: z.enum(["overdue", "today", "upcoming"]), days: z.number().int().min(1).max(60).default(7) }),
      execute: ({ state, days }) => traced("listReceipts", recordListOutputSchema, async () => {
        const scope = await requireNoraToolScope(user.id);
        const db = getDb();
        const start = today();
        const tomorrow = businessAddDays(start, 1);
        const dueDate = state === "overdue" ? { lt: start } : state === "today" ? { gte: start, lt: tomorrow } : { gte: tomorrow, lte: businessAddDays(start, days) };
        const rows = await db.receipt.findMany({ where: { ...receiptOperationalWhere(scope.portfolioOwnerId, scope.organizationId), dueDate, status: { notIn: ["PAID", "CANCELLED"] } }, select: { id: true, receiptNumber: true, dueDate: true, amount: true, currency: true, status: true, client: { select: { fullName: true } }, policy: { select: { policyNumber: true } } }, orderBy: [{ dueDate: "asc" }, { receiptSequence: { sort: "asc", nulls: "last" } }, { receiptNumber: "asc" }, { id: "asc" }], take: 25 });
        return rows.map((item) => ({ ...item, amount: Number(item.amount), dueDate: iso(item.dueDate) }));
      }),
    }),
    listOpenWorkItems: tool({
      description: "Lista pendientes operativos abiertos y autorizados.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(25).default(15) }),
      execute: ({ limit }) => traced("listOpenWorkItems", recordListOutputSchema, async () => {
        const scope = await requireNoraToolScope(user.id);
        const rows = await getWorkItems({ workItemTypes: ["TASK"], statuses: OPEN_WORK_ITEM_STATUSES, limit, portfolioOwnerId: scope.portfolioOwnerId, organizationId: scope.organizationId });
        return rows.map((item) => ({ id: item.id, title: item.title, status: item.status, priority: item.priority, dueDate: iso(item.dueDate), client: item.client?.fullName ?? null, policyNumber: item.policy?.policyNumber ?? null }));
      }),
    }),
    listClaims: tool({
      description: "Lista siniestros autorizados por estado. No devuelve notas ni contenido documental.",
      inputSchema: z.object({ status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_CLIENT", "WAITING_INSURER", "RESOLVED", "CANCELLED"]).optional(), limit: z.number().int().min(1).max(25).default(15) }),
      execute: ({ status, limit }) => traced("listClaims", recordListOutputSchema, async () => {
        const scope = await requireNoraToolScope(user.id);
        const db = getDb();
        const rows = await db.claim.findMany({ where: { ...claimOperationalWhere(scope.portfolioOwnerId, scope.organizationId), ...(status ? { status } : { status: { notIn: ["RESOLVED", "CANCELLED"] } }) }, select: { id: true, folio: true, claimType: true, status: true, incidentDate: true, reportedDate: true, client: { select: { fullName: true } }, policy: { select: { policyNumber: true, policyType: true } }, insurer: { select: { name: true } } }, orderBy: { reportedDate: "desc" }, take: limit });
        return rows.map((item) => item.policy.policyType === "GMM" ? { id: item.id, folio: item.folio, status: item.status, policyType: "GMM", policyNumber: item.policy.policyNumber, reportedDate: iso(item.reportedDate), metadataOnly: true } : { ...item, incidentDate: iso(item.incidentDate), reportedDate: iso(item.reportedDate) });
      }),
    }),
    getClaimChecklist: tool({
      description: "Obtiene únicamente metadatos del checklist de un siniestro. Para GMM nunca devuelve archivos ni contenido médico.",
      inputSchema: z.object({ claimId: z.string().min(1).max(100) }),
      execute: ({ claimId }) => traced("getClaimChecklist", nullableRecordOutputSchema, async () => {
        const scope = await requireNoraToolScope(user.id);
        const summary = await getClaimChecklistSummary(claimId, scope.organizationId, scope.portfolioOwnerId);
        if (!summary || summary.policyType !== "GMM") return summary;
        return {
          counts: summary.counts,
          items: summary.items.map((item) => ({
            code: item.code,
            status: item.status,
            requestedAt: item.requestedAt,
            receivedAt: item.receivedAt,
            waivedAt: item.waivedAt,
          })),
        };
      }),
    }),
    auditConsistency: tool({
      description: "Resume riesgos e inconsistencias operativas detectadas por reglas locales autorizadas.",
      inputSchema: z.object({}),
      execute: () => traced("auditConsistency", toolRecordSchema, async () => {
        const scope = await requireNoraToolScope(user.id);
        const findings = await detectRisks(scope.portfolioOwnerId, scope.organizationId);
        return { count: findings.length, findings: findings.slice(0, 25) };
      }),
    }),
    prepareActionDraft: tool({
      description: "Prepara un borrador confirmable. Nunca ejecuta el cambio. Si faltan datos, no la llames: pregunta primero al usuario.",
      inputSchema: mutationPlanSchema,
      execute: (plan) => traced("prepareActionDraft", draftOutputSchema, async () => {
        const scope = await requireNoraToolScope(user.id);
        const freshUser: AssistantUser = { id: scope.id, role: scope.role, organizationId: scope.organizationId };
        actionProposal = await buildAssistantActionProposalFromPlan(plan as AssistantMutationPlan, freshUser);
        return actionProposal ? { prepared: true, proposal: actionProposal } : { prepared: false, reason: "La propuesta es incompleta, ambigua o no pasó las validaciones locales." };
      }),
    }),
  };

  return {
    tools,
    snapshot: () => ({ trace: [...trace], actionProposal, knowledgeCitations: [...knowledgeCitations.values()] }),
  };
}

export type NoraSimpleReadCapability =
  | "getTodayBrief"
  | "listRenewals"
  | "listReceipts"
  | "searchPortfolio"
  | "listOpenWorkItems"
  | "listClaims";

export type NoraSimpleReadRequest = {
  capability: NoraSimpleReadCapability;
  message: string;
  normalizedMessage: string;
};

type DirectToolExecutor = {
  execute?: (input: unknown, options: unknown) => Promise<unknown>;
};

function getReceiptReadState(normalizedMessage: string): "overdue" | "today" | "upcoming" {
  if (normalizedMessage.includes("vencid") || normalizedMessage.includes("atrasad")) return "overdue";
  if (normalizedMessage.includes("hoy")) return "today";
  return "upcoming";
}

function getRenewalReadDays(message: string) {
  const match = message.match(/\b(?:en|proximas?\s+de|proximos?\s+)?(\d{1,2})\s+d[ií]as?\b/i);
  const days = match ? Number(match[1]) : 30;
  return Math.min(90, Math.max(1, Number.isFinite(days) ? days : 30));
}

export async function executeNoraSimpleRead(user: AssistantUser, request: NoraSimpleReadRequest, options: { gmmMetadataOnly?: boolean } = {}) {
  const runtime = createNoraAgentTools(user, options);
  const tool = runtime.tools[request.capability] as DirectToolExecutor;
  if (!tool.execute) throw new Error(`La capacidad local ${request.capability} no tiene ejecutor.`);

  const input = request.capability === "getTodayBrief" || request.capability === "listClaims"
    ? request.capability === "getTodayBrief" ? {} : { limit: 15 }
    : request.capability === "listRenewals"
      ? { days: getRenewalReadDays(request.message) }
      : request.capability === "listReceipts"
        ? { state: getReceiptReadState(request.normalizedMessage), days: 7 }
        : request.capability === "searchPortfolio"
          ? { query: request.message.trim().slice(0, 250) }
          : { limit: 15 };
  const value = await tool.execute(input, {});
  return { value, toolTrace: runtime.snapshot().trace };
}
