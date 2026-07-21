import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";
import { writeActivityLog } from "@/lib/activity-log";
import { normalize } from "@/lib/search-utils";
import { globalSearch, type GlobalSearchResult } from "@/lib/search";
import { formatDateInput } from "@/lib/form-utils";
import { getCurrentUser } from "@/lib/auth";
import { createClientDefaults } from "@/lib/form-defaults";
import { createPolicyDefaults } from "@/lib/form-defaults";
import { createReceiptDefaults } from "@/lib/form-defaults";
import { createWorkItemDefaults } from "@/lib/form-defaults";
import { clientSchema, policySchema, receiptSchema, workItemSchema } from "@/lib/validations";
import { errorResult, type MutationResult } from "@/lib/mutation-utils";
import { createClient, updateClient } from "@/app/(dashboard)/clients/actions";
import { createPolicy, updatePolicy } from "@/app/(dashboard)/policies/actions";
import { createReceipt, updateReceipt } from "@/app/(dashboard)/receipts/actions";
import { createPayment } from "@/app/(dashboard)/payments/actions";
import { createWorkItem, updateWorkItem } from "@/app/(dashboard)/tasks/actions";
import { findWorkItemByRouteId } from "@/lib/work-item-resolvers";
import type {
  AssistantActionProposal,
  AssistantMutationEntityType,
  AssistantMutationField,
  AssistantMutationOperation,
  AssistantMutationPlan,
  AssistantMutationRelation,
  AssistantUser,
} from "@/lib/assistant-types";

type DbClient = PrismaClient | Prisma.TransactionClient;

type AssistantActionDraftPayload = {
  title: string;
  summary: string;
  reply: string;
  entityType: AssistantMutationEntityType;
  operation: AssistantMutationOperation;
  targetId: string | null;
  targetLabel: string | null;
  targetUpdatedAt: string | null;
  formValues: Record<string, unknown>;
  changes: AssistantActionProposal["changes"];
};

const ACTION_DRAFT_TTL_MS = 30 * 60 * 1000;

const ENTITY_TYPES: AssistantMutationEntityType[] = ["client", "policy", "receipt", "payment", "workItem"];

const RELATION_SEARCH_TYPE: Record<string, GlobalSearchResult["type"]> = {
  clientId: "client",
  insurerId: "insurer",
  policyId: "policy",
  receiptId: "receipt",
  referidorId: "client",
  renewedFromPolicyId: "policy",
};

const FIELD_LABELS: Record<AssistantMutationEntityType, Record<string, string>> = {
  client: {
    fullName: "Nombre",
    type: "Tipo",
    email: "Correo",
    phone: "Teléfono",
    secondaryPhone: "Teléfono secundario",
    rfc: "RFC",
    address: "Dirección",
    preferredContactMethod: "Contacto preferido",
    referidorId: "Referidor",
    notes: "Notas",
    status: "Estado",
  },
  policy: {
    policyNumber: "Número de póliza",
    clientId: "Cliente",
    insurerId: "Aseguradora",
    policyType: "Tipo de póliza",
    status: "Estado",
    startDate: "Inicio",
    endDate: "Fin",
    premiumAmount: "Prima",
    currency: "Moneda",
    paymentFrequency: "Frecuencia de pago",
    paymentPlan: "Plan de pago",
    insuredObject: "Objeto asegurado",
    beneficiaryInfo: "Beneficiarios",
    notes: "Notas",
    renewedFromPolicyId: "Renovada desde",
  },
  receipt: {
    receiptNumber: "Número de recibo",
    policyId: "Póliza",
    endorsementId: "Endoso",
    periodStartDate: "Inicio de periodo",
    periodEndDate: "Fin de periodo",
    dueDate: "Vencimiento",
    amount: "Monto",
    currency: "Moneda",
    status: "Estado",
    paidDate: "Fecha de pago",
    paymentMethod: "Método de pago",
    notes: "Notas",
  },
  payment: {
    receiptId: "Recibo",
    amount: "Monto",
    paidDate: "Fecha de pago",
    paymentMethod: "Método de pago",
    reference: "Referencia",
    notes: "Notas",
  },
  workItem: {
    clientId: "Cliente",
    policyId: "Póliza",
    insurerId: "Aseguradora",
    receiptId: "Recibo",
    title: "Título",
    description: "Descripción",
    taskType: "Tipo",
    status: "Estado",
    priority: "Prioridad",
    startDate: "Inicio",
    dueDate: "Vencimiento",
    notes: "Notas",
  },
};

function normalizeEntityType(value: string): AssistantMutationEntityType | null {
  if ((ENTITY_TYPES as string[]).includes(value)) {
    return value as AssistantMutationEntityType;
  }
  return null;
}

function normalizeOperation(value: string): AssistantMutationOperation | null {
  return value === "create" || value === "update" ? value : null;
}

function toText(value: unknown) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  return `${value}`.trim();
}

function toNullableText(value: unknown) {
  const text = toText(value);
  return text.length > 0 ? text : null;
}

function parsePayload(payloadJson: string): AssistantActionDraftPayload | null {
  try {
    const parsed = JSON.parse(payloadJson) as AssistantActionDraftPayload;
    return parsed;
  } catch {
    return null;
  }
}

function stringifyPayload(payload: AssistantActionDraftPayload) {
  return JSON.stringify(payload);
}

function relationSearchType(field: string): GlobalSearchResult["type"] | null {
  return RELATION_SEARCH_TYPE[field] ?? null;
}

function getSearchScope(user: AssistantUser) {
  return user.role === "ADMIN" ? undefined : user.id;
}

function candidateLabel(result: GlobalSearchResult) {
  return [result.title, result.subtitle, result.parentLabel].filter(Boolean).join(" · ");
}

function exactMatch(results: GlobalSearchResult[], query: string, expectedType: GlobalSearchResult["type"]) {
  const normalizedQuery = normalize(query);
  return results.find(
    (result) =>
      result.type === expectedType &&
      (normalize(result.title) === normalizedQuery ||
        normalize(candidateLabel(result)).includes(normalizedQuery) ||
        normalize(result.match?.snippet ?? "").includes(normalizedQuery)),
  );
}

function buildChangeList(
  entityType: AssistantMutationEntityType,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  beforeDisplay: Record<string, string> = {},
  afterDisplay: Record<string, string> = {},
): AssistantActionProposal["changes"] {
  const changes: AssistantActionProposal["changes"] = [];
  const labels = FIELD_LABELS[entityType];

  for (const [field, value] of Object.entries(after)) {
    const beforeValue = before ? before[field] : null;
    const beforeText = before ? beforeDisplay[field] ?? toNullableText(beforeValue) : null;
    const afterText = afterDisplay[field] ?? toNullableText(value);
    if (beforeText === afterText) continue;
    changes.push({
      label: labels[field] ?? field,
      before: beforeText,
      after: afterText ?? "",
    });
  }

  return changes;
}

function buildActionTitle(entityType: AssistantMutationEntityType, operation: AssistantMutationOperation) {
  const labels: Record<AssistantMutationEntityType, string> = {
    client: "cliente",
    policy: "póliza",
    receipt: "recibo",
    payment: "pago",
    workItem: "pendiente",
  };
  return `${operation === "create" ? "Crear" : "Actualizar"} ${labels[entityType]}`;
}

function buildActionSummary(entityType: AssistantMutationEntityType, operation: AssistantMutationOperation, targetLabel: string | null) {
  const labels: Record<AssistantMutationEntityType, string> = {
    client: "cliente",
    policy: "póliza",
    receipt: "recibo",
    payment: "pago",
    workItem: "pendiente",
  };
  const label = targetLabel ? ` sobre ${targetLabel}` : "";
  return `${operation === "create" ? "Alta" : "Edición"} de ${labels[entityType]}${label}`;
}

function applyPlanFields(target: Record<string, unknown>, fields: AssistantMutationField[]) {
  for (const entry of fields) {
    target[entry.field] = entry.value;
  }
  return target;
}

async function resolveRelation(
  user: AssistantUser,
  relation: AssistantMutationRelation,
): Promise<{ field: string; id: string; label: string } | { field: string; error: string } | null> {
  const searchType = relationSearchType(relation.field);
  if (!searchType) {
    return { field: relation.field, error: `La relación ${relation.field} no está soportada todavía.` };
  }

  const results = (await globalSearch(relation.query, getSearchScope(user))).filter((result) => result.type === searchType);
  if (results.length === 0) {
    return { field: relation.field, error: `No encontré un ${relation.label.toLowerCase()} para "${relation.query}".` };
  }

  const exact = exactMatch(results, relation.query, searchType);
  const chosen = exact ?? (results.length === 1 ? results[0] : null);
  if (!chosen) {
    return { field: relation.field, error: `El ${relation.label.toLowerCase()} sigue siendo ambiguo.` };
  }

  return { field: relation.field, id: chosen.id, label: candidateLabel(chosen) };
}

function toClientFormValues(client: {
  fullName: string;
  type: string;
  email: string | null;
  phone: string | null;
  secondaryPhone: string | null;
  rfc: string | null;
  address: string | null;
  preferredContactMethod: string | null;
  referidorId: string | null;
  notes: string | null;
  status: string;
}) {
  return {
    fullName: client.fullName,
    type: client.type,
    email: client.email ?? "",
    phone: client.phone ?? "",
    secondaryPhone: client.secondaryPhone ?? "",
    rfc: client.rfc ?? "",
    address: client.address ?? "",
    preferredContactMethod: client.preferredContactMethod ?? "",
    referidorId: client.referidorId ?? "",
    notes: client.notes ?? "",
    status: client.status,
  };
}

function toPolicyFormValues(policy: {
  policyNumber: string;
  clientId: string;
  insurerId: string;
  policyType: string;
  status: string;
  startDate: Date;
  endDate: Date;
  premiumAmount: Prisma.Decimal | number;
  currency: string;
  paymentFrequency: string;
  paymentPlan: string | null;
  insuredObject: string | null;
  beneficiaryInfo: string | null;
  notes: string | null;
  renewedFromPolicyId: string | null;
}) {
  return {
    policyNumber: policy.policyNumber,
    clientId: policy.clientId,
    insurerId: policy.insurerId,
    policyType: policy.policyType,
    status: policy.status,
    startDate: formatDateInput(policy.startDate),
    endDate: formatDateInput(policy.endDate),
    premiumAmount: Number(policy.premiumAmount),
    currency: policy.currency,
    paymentFrequency: policy.paymentFrequency,
    paymentPlan: policy.paymentPlan ?? "",
    insuredObject: policy.insuredObject ?? "",
    beneficiaryInfo: policy.beneficiaryInfo ?? "",
    notes: policy.notes ?? "",
    renewedFromPolicyId: policy.renewedFromPolicyId ?? "",
  };
}

function toReceiptFormValues(receipt: {
  receiptNumber: string;
  policyId: string;
  endorsementId: string | null;
  periodStartDate: Date;
  periodEndDate: Date;
  dueDate: Date;
  amount: Prisma.Decimal | number;
  currency: string;
  status: string;
  paidDate: Date | null;
  paymentMethod: string | null;
  notes: string | null;
}) {
  return {
    receiptNumber: receipt.receiptNumber,
    policyId: receipt.policyId,
    endorsementId: receipt.endorsementId ?? "",
    periodStartDate: formatDateInput(receipt.periodStartDate),
    periodEndDate: formatDateInput(receipt.periodEndDate),
    dueDate: formatDateInput(receipt.dueDate),
    amount: Number(receipt.amount),
    currency: receipt.currency,
    status: receipt.status,
    paidDate: receipt.paidDate ? formatDateInput(receipt.paidDate) : "",
    paymentMethod: receipt.paymentMethod ?? "",
    notes: receipt.notes ?? "",
  };
}

function toWorkItemFormValues(workItem: {
  clientId: string | null;
  policyId: string | null;
  insurerId: string | null;
  receiptId: string | null;
  title: string;
  description: string | null;
  taskType: string;
  status: string;
  priority: string;
  startDate: Date;
  dueDate: Date | null;
  notes: string | null;
}) {
  return {
    clientId: workItem.clientId ?? "",
    policyId: workItem.policyId ?? "",
    insurerId: workItem.insurerId ?? "",
    receiptId: workItem.receiptId ?? "",
    title: workItem.title,
    description: workItem.description ?? "",
    taskType: workItem.taskType,
    status: workItem.status,
    priority: workItem.priority,
    startDate: formatDateInput(workItem.startDate),
    dueDate: workItem.dueDate ? formatDateInput(workItem.dueDate) : "",
    notes: workItem.notes ?? "",
  };
}

function buildProposalSnapshot(input: {
  draftId: string;
  payload: AssistantActionDraftPayload;
  expiresAt: Date;
}): AssistantActionProposal {
  return {
    draftId: input.draftId,
    entityType: input.payload.entityType,
    operation: input.payload.operation,
    title: input.payload.title,
    summary: input.payload.summary,
    targetLabel: input.payload.targetLabel,
    changes: input.payload.changes,
    confirmLabel: input.payload.operation === "create" ? "Crear" : "Confirmar",
    expiresAt: input.expiresAt.toISOString(),
  };
}

async function createDraftRecord(
  userId: string,
  payload: AssistantActionDraftPayload,
  client: DbClient = getDb(),
) {
  return client.assistantActionDraft.create({
    data: {
      userId,
      title: payload.title,
      summary: payload.summary,
      reply: payload.reply,
      entityType: payload.entityType,
      operation: payload.operation,
      targetLabel: payload.targetLabel,
      payloadJson: stringifyPayload(payload),
      expiresAt: new Date(Date.now() + ACTION_DRAFT_TTL_MS),
    },
  });
}

async function getDraftOrThrow(draftId: string, userId: string, client: DbClient = getDb()) {
  const draft = await client.assistantActionDraft.findFirst({
    where: { id: draftId, userId },
  });
  if (!draft) {
    throw new Error("La propuesta ya no existe o no te pertenece.");
  }
  return draft;
}

async function buildClientDraft(plan: AssistantMutationPlan, user: AssistantUser) {
  const db = getDb();
  const values = createClientDefaults();
  const fieldMap = new Map(plan.fields.map((field) => [field.field, field.value]));

  if (plan.operation === "update") {
    if (!plan.targetQuery) return null;
    const candidates = (await globalSearch(plan.targetQuery, getSearchScope(user))).filter((result) => result.type === "client");
    const chosen = exactMatch(candidates, plan.targetQuery, "client") ?? (candidates.length === 1 ? candidates[0] : null);
    if (!chosen) return null;

    const current = await db.client.findUnique({
      where: { id: chosen.id },
      select: {
        id: true,
        fullName: true,
        type: true,
        email: true,
        phone: true,
        secondaryPhone: true,
        rfc: true,
        address: true,
        preferredContactMethod: true,
        referidorId: true,
        referidor: { select: { fullName: true } },
        notes: true,
        status: true,
        updatedAt: true,
      },
    });
    if (!current) return null;

    const next: Record<string, unknown> = {
      ...toClientFormValues(current),
      ...Object.fromEntries(fieldMap.entries()),
    };
    const beforeDisplay: Record<string, string> = {};
    const afterDisplay: Record<string, string> = {};
    if (current.referidor?.fullName) {
      beforeDisplay.referidorId = current.referidor.fullName;
      afterDisplay.referidorId = current.referidor.fullName;
    }
    if (plan.relations.length > 0) {
      for (const relation of plan.relations) {
        const resolved = await resolveRelation(user, relation);
        if (!resolved || "error" in resolved) return null;
        next[resolved.field] = resolved.id;
        afterDisplay[resolved.field] = resolved.label;
      }
    }
    const parsed = clientSchema.safeParse(next);
    if (!parsed.success) return null;

    const payload: AssistantActionDraftPayload = {
      title: plan.title || buildActionTitle("client", "update"),
      summary: plan.summary || buildActionSummary("client", "update", current.fullName),
      reply: plan.reply,
      entityType: "client",
      operation: "update",
      targetId: current.id,
      targetLabel: current.fullName,
      targetUpdatedAt: current.updatedAt.toISOString(),
      formValues: parsed.data,
      changes: buildChangeList("client", toClientFormValues(current), parsed.data, beforeDisplay, afterDisplay),
    };
    if (!payload.changes.length) return null;
    const draft = await createDraftRecord(user.id, payload, db);
    await writeActivityLog({
      entityType: "AssistantActionDraft",
      entityId: draft.id,
      action: "ASSISTANT_ACTION_DRAFT_CREATED",
      newValue: { entityType: payload.entityType, operation: payload.operation, targetLabel: payload.targetLabel },
      userId: user.id,
      db,
    });
    return buildProposalSnapshot({ draftId: draft.id, payload, expiresAt: draft.expiresAt });
  }

  const next = applyPlanFields(values, plan.fields);
  const afterDisplay: Record<string, string> = {};
  if (plan.relations.length > 0) {
    for (const relation of plan.relations) {
      const resolved = await resolveRelation(user, relation);
      if (!resolved || "error" in resolved) return null;
      next[resolved.field] = resolved.id;
      afterDisplay[resolved.field] = resolved.label;
    }
  }
  const parsed = clientSchema.safeParse(next);
  if (!parsed.success) return null;

  const payload: AssistantActionDraftPayload = {
    title: plan.title || buildActionTitle("client", "create"),
    summary: plan.summary || buildActionSummary("client", "create", null),
    reply: plan.reply,
    entityType: "client",
    operation: "create",
    targetId: null,
    targetLabel: null,
    targetUpdatedAt: null,
    formValues: parsed.data,
    changes: buildChangeList("client", null, parsed.data, {}, afterDisplay),
  };
  const draft = await createDraftRecord(user.id, payload, db);
  await writeActivityLog({
    entityType: "AssistantActionDraft",
    entityId: draft.id,
    action: "ASSISTANT_ACTION_DRAFT_CREATED",
    newValue: { entityType: payload.entityType, operation: payload.operation, targetLabel: payload.targetLabel },
    userId: user.id,
    db,
  });
  return buildProposalSnapshot({ draftId: draft.id, payload, expiresAt: draft.expiresAt });
}

async function buildPolicyDraft(plan: AssistantMutationPlan, user: AssistantUser) {
  const db = getDb();
  const values = createPolicyDefaults();
  const fieldMap = new Map(plan.fields.map((field) => [field.field, field.value]));

  if (plan.operation === "update") {
    if (!plan.targetQuery) return null;
    const candidates = (await globalSearch(plan.targetQuery, getSearchScope(user))).filter((result) => result.type === "policy");
    const chosen = exactMatch(candidates, plan.targetQuery, "policy") ?? (candidates.length === 1 ? candidates[0] : null);
    if (!chosen) return null;

    const current = await db.policy.findUnique({
      where: { id: chosen.id },
      select: {
        id: true,
        policyNumber: true,
        clientId: true,
        client: { select: { fullName: true } },
        insurerId: true,
        insurer: { select: { name: true } },
        policyType: true,
        status: true,
        startDate: true,
        endDate: true,
        premiumAmount: true,
        currency: true,
        paymentFrequency: true,
        paymentPlan: true,
        insuredObject: true,
        beneficiaryInfo: true,
        notes: true,
        renewedFromPolicyId: true,
        renewedFrom: { select: { policyNumber: true } },
        updatedAt: true,
      },
    });
    if (!current) return null;

    const next: Record<string, unknown> = {
      ...toPolicyFormValues(current),
      ...Object.fromEntries(fieldMap.entries()),
    };
    const beforeDisplay: Record<string, string> = {
      clientId: current.client?.fullName ?? current.clientId,
      insurerId: current.insurer?.name ?? current.insurerId,
    };
    const afterDisplay: Record<string, string> = {
      ...beforeDisplay,
    };
    if (current.renewedFrom?.policyNumber) {
      beforeDisplay.renewedFromPolicyId = current.renewedFrom.policyNumber;
      afterDisplay.renewedFromPolicyId = current.renewedFrom.policyNumber;
    }
    if (plan.relations.length > 0) {
      for (const relation of plan.relations) {
        const resolved = await resolveRelation(user, relation);
        if (!resolved || "error" in resolved) return null;
        next[resolved.field] = resolved.id;
        afterDisplay[resolved.field] = resolved.label;
      }
    }
    const parsed = policySchema.safeParse(next);
    if (!parsed.success) return null;

    const payload: AssistantActionDraftPayload = {
      title: plan.title || buildActionTitle("policy", "update"),
      summary: plan.summary || buildActionSummary("policy", "update", current.policyNumber),
      reply: plan.reply,
      entityType: "policy",
      operation: "update",
      targetId: current.id,
      targetLabel: current.policyNumber,
      targetUpdatedAt: current.updatedAt.toISOString(),
      formValues: parsed.data,
      changes: buildChangeList("policy", toPolicyFormValues(current), parsed.data, beforeDisplay, afterDisplay),
    };
    if (!payload.changes.length) return null;
    const draft = await createDraftRecord(user.id, payload, db);
    await writeActivityLog({
      entityType: "AssistantActionDraft",
      entityId: draft.id,
      action: "ASSISTANT_ACTION_DRAFT_CREATED",
      newValue: { entityType: payload.entityType, operation: payload.operation, targetLabel: payload.targetLabel },
      userId: user.id,
      db,
    });
    return buildProposalSnapshot({ draftId: draft.id, payload, expiresAt: draft.expiresAt });
  }

  const next = applyPlanFields(values, plan.fields);
  const afterDisplay: Record<string, string> = {};
  if (plan.relations.length > 0) {
    for (const relation of plan.relations) {
      const resolved = await resolveRelation(user, relation);
      if (!resolved || "error" in resolved) return null;
      next[resolved.field] = resolved.id;
      afterDisplay[resolved.field] = resolved.label;
    }
  }
  const parsed = policySchema.safeParse(next);
  if (!parsed.success) return null;

  const payload: AssistantActionDraftPayload = {
    title: plan.title || buildActionTitle("policy", "create"),
    summary: plan.summary || buildActionSummary("policy", "create", null),
    reply: plan.reply,
    entityType: "policy",
    operation: "create",
    targetId: null,
    targetLabel: null,
    targetUpdatedAt: null,
    formValues: parsed.data,
    changes: buildChangeList("policy", null, parsed.data, {}, afterDisplay),
  };
  const draft = await createDraftRecord(user.id, payload, db);
  await writeActivityLog({
    entityType: "AssistantActionDraft",
    entityId: draft.id,
    action: "ASSISTANT_ACTION_DRAFT_CREATED",
    newValue: { entityType: payload.entityType, operation: payload.operation, targetLabel: payload.targetLabel },
    userId: user.id,
    db,
  });
  return buildProposalSnapshot({ draftId: draft.id, payload, expiresAt: draft.expiresAt });
}

async function buildReceiptDraft(plan: AssistantMutationPlan, user: AssistantUser) {
  const db = getDb();
  const values = createReceiptDefaults();
  const fieldMap = new Map(plan.fields.map((field) => [field.field, field.value]));

  if (plan.operation === "update") {
    if (!plan.targetQuery) return null;
    const candidates = (await globalSearch(plan.targetQuery, getSearchScope(user))).filter((result) => result.type === "receipt");
    const chosen = exactMatch(candidates, plan.targetQuery, "receipt") ?? (candidates.length === 1 ? candidates[0] : null);
    if (!chosen) return null;

    const current = await db.receipt.findUnique({
      where: { id: chosen.id },
      select: {
        id: true,
        receiptNumber: true,
        policyId: true,
        policy: { select: { policyNumber: true } },
        endorsementId: true,
        endorsement: { select: { endorsementNumber: true } },
        periodStartDate: true,
        periodEndDate: true,
        dueDate: true,
        amount: true,
        currency: true,
        status: true,
        paidDate: true,
        paymentMethod: true,
        notes: true,
        updatedAt: true,
      },
    });
    if (!current) return null;

    const next: Record<string, unknown> = {
      ...toReceiptFormValues(current),
      ...Object.fromEntries(fieldMap.entries()),
    };
    const beforeDisplay: Record<string, string> = {
      policyId: current.policy?.policyNumber ?? current.policyId,
    };
    const afterDisplay: Record<string, string> = {
      ...beforeDisplay,
    };
    if (current.endorsement?.endorsementNumber) {
      beforeDisplay.endorsementId = current.endorsement.endorsementNumber;
      afterDisplay.endorsementId = current.endorsement.endorsementNumber;
    }
    if (plan.relations.length > 0) {
      for (const relation of plan.relations) {
        const resolved = await resolveRelation(user, relation);
        if (!resolved || "error" in resolved) return null;
        next[resolved.field] = resolved.id;
        afterDisplay[resolved.field] = resolved.label;
      }
    }
    const parsed = receiptSchema.safeParse(next);
    if (!parsed.success) return null;

    const payload: AssistantActionDraftPayload = {
      title: plan.title || buildActionTitle("receipt", "update"),
      summary: plan.summary || buildActionSummary("receipt", "update", current.receiptNumber),
      reply: plan.reply,
      entityType: "receipt",
      operation: "update",
      targetId: current.id,
      targetLabel: current.receiptNumber,
      targetUpdatedAt: current.updatedAt.toISOString(),
      formValues: parsed.data,
      changes: buildChangeList("receipt", toReceiptFormValues(current), parsed.data, beforeDisplay, afterDisplay),
    };
    if (!payload.changes.length) return null;
    const draft = await createDraftRecord(user.id, payload, db);
    await writeActivityLog({
      entityType: "AssistantActionDraft",
      entityId: draft.id,
      action: "ASSISTANT_ACTION_DRAFT_CREATED",
      newValue: { entityType: payload.entityType, operation: payload.operation, targetLabel: payload.targetLabel },
      userId: user.id,
      db,
    });
    return buildProposalSnapshot({ draftId: draft.id, payload, expiresAt: draft.expiresAt });
  }

  const next = applyPlanFields(values, plan.fields);
  const afterDisplay: Record<string, string> = {};
  if (plan.relations.length > 0) {
    for (const relation of plan.relations) {
      const resolved = await resolveRelation(user, relation);
      if (!resolved || "error" in resolved) return null;
      next[resolved.field] = resolved.id;
      afterDisplay[resolved.field] = resolved.label;
    }
  }
  const parsed = receiptSchema.safeParse(next);
  if (!parsed.success) return null;

  const payload: AssistantActionDraftPayload = {
    title: plan.title || buildActionTitle("receipt", "create"),
    summary: plan.summary || buildActionSummary("receipt", "create", null),
    reply: plan.reply,
    entityType: "receipt",
    operation: "create",
    targetId: null,
    targetLabel: null,
    targetUpdatedAt: null,
    formValues: parsed.data,
    changes: buildChangeList("receipt", null, parsed.data, {}, afterDisplay),
  };
  const draft = await createDraftRecord(user.id, payload, db);
  await writeActivityLog({
    entityType: "AssistantActionDraft",
    entityId: draft.id,
    action: "ASSISTANT_ACTION_DRAFT_CREATED",
    newValue: { entityType: payload.entityType, operation: payload.operation, targetLabel: payload.targetLabel },
    userId: user.id,
    db,
  });
  return buildProposalSnapshot({ draftId: draft.id, payload, expiresAt: draft.expiresAt });
}

async function buildPaymentDraft(plan: AssistantMutationPlan, user: AssistantUser) {
  const db = getDb();
  const fieldMap = new Map(plan.fields.map((field) => [field.field, field.value]));
  let selectedReceiptLabel: string | null = null;
  const next: Record<string, unknown> = {
    receiptId: "",
    amount: "",
    paidDate: formatDateInput(new Date()),
    paymentMethod: "TRANSFER",
    reference: "",
    notes: "",
  };
  applyPlanFields(next, plan.fields);
  for (const relation of plan.relations) {
    const resolved = await resolveRelation(user, relation);
    if (!resolved || "error" in resolved) return null;
    next[resolved.field] = resolved.id;
    if (resolved.field === "receiptId") {
      selectedReceiptLabel = resolved.label;
    }
  }
  if (!next.receiptId) {
    const targetQuery = plan.targetQuery ?? fieldMap.get("receiptId")?.toString() ?? "";
    if (targetQuery) {
      const candidates = (await globalSearch(targetQuery, getSearchScope(user))).filter((result) => result.type === "receipt");
      const chosen = exactMatch(candidates, targetQuery, "receipt") ?? (candidates.length === 1 ? candidates[0] : null);
      if (!chosen) return null;
      next.receiptId = chosen.id;
      selectedReceiptLabel = candidateLabel(chosen);
    }
  }
  if (!next.receiptId || !next.amount || !next.paidDate || !next.paymentMethod) {
    return null;
  }

  const payload: AssistantActionDraftPayload = {
    title: plan.title || buildActionTitle("payment", "create"),
    summary: plan.summary || buildActionSummary("payment", "create", selectedReceiptLabel),
    reply: plan.reply,
    entityType: "payment",
    operation: "create",
    targetId: String(next.receiptId),
    targetLabel: selectedReceiptLabel,
    targetUpdatedAt: null,
    formValues: {
      receiptId: String(next.receiptId),
      amount: Number(next.amount),
      paidDate: String(next.paidDate),
      paymentMethod: String(next.paymentMethod),
      reference: String(next.reference ?? ""),
      notes: String(next.notes ?? ""),
    },
    changes: [
      { label: "Recibo", before: null, after: selectedReceiptLabel ?? String(next.receiptId) },
      { label: "Monto", before: null, after: String(next.amount) },
      { label: "Fecha de pago", before: null, after: String(next.paidDate) },
      { label: "Método de pago", before: null, after: String(next.paymentMethod) },
    ],
  };
  const draft = await createDraftRecord(user.id, payload, db);
  await writeActivityLog({
    entityType: "AssistantActionDraft",
    entityId: draft.id,
    action: "ASSISTANT_ACTION_DRAFT_CREATED",
    newValue: { entityType: payload.entityType, operation: payload.operation, targetLabel: payload.targetLabel },
    userId: user.id,
    db,
  });
  return buildProposalSnapshot({ draftId: draft.id, payload, expiresAt: draft.expiresAt });
}

async function buildWorkItemDraft(plan: AssistantMutationPlan, user: AssistantUser) {
  const db = getDb();
  const values = createWorkItemDefaults();
  const fieldMap = new Map(plan.fields.map((field) => [field.field, field.value]));

  if (plan.operation === "update") {
    if (!plan.targetQuery) return null;
    const candidates = (await globalSearch(plan.targetQuery, getSearchScope(user))).filter((result) => result.type === "workItem");
    const chosen = exactMatch(candidates, plan.targetQuery, "workItem") ?? (candidates.length === 1 ? candidates[0] : null);
    if (!chosen) return null;

    const current = await findWorkItemByRouteId(chosen.id, db, user.role === "ADMIN" ? undefined : user.id);
    if (!current) return null;

    const next: Record<string, unknown> = {
      ...toWorkItemFormValues({
        clientId: current.clientId,
        policyId: current.policyId,
        insurerId: current.insurerId,
        receiptId: current.receiptId,
        title: current.title,
        description: current.description,
        taskType: current.taskType ?? "GENERAL",
        status: current.status,
        priority: current.priority,
        startDate: current.startDate,
        dueDate: current.dueDate,
        notes: current.notes,
      }),
      ...Object.fromEntries(fieldMap.entries()),
    };
    const beforeDisplay: Record<string, string> = {
      clientId: current.client?.fullName ?? current.clientId ?? "",
      policyId: current.policy?.policyNumber ?? current.policyId ?? "",
      insurerId: current.insurer?.name ?? current.insurerId ?? "",
      receiptId: current.receipt?.receiptNumber ?? current.receiptId ?? "",
    };
    const afterDisplay: Record<string, string> = {
      ...beforeDisplay,
    };
    if (plan.relations.length > 0) {
      for (const relation of plan.relations) {
        const resolved = await resolveRelation(user, relation);
        if (!resolved || "error" in resolved) return null;
        next[resolved.field] = resolved.id;
        afterDisplay[resolved.field] = resolved.label;
      }
    }
    const parsed = workItemSchema.safeParse(next);
    if (!parsed.success) return null;

    const payload: AssistantActionDraftPayload = {
      title: plan.title || buildActionTitle("workItem", "update"),
      summary: plan.summary || buildActionSummary("workItem", "update", current.title),
      reply: plan.reply,
      entityType: "workItem",
      operation: "update",
      targetId: current.sourceId ?? current.id,
      targetLabel: current.title,
      targetUpdatedAt: current.updatedAt.toISOString(),
      formValues: parsed.data,
      changes: buildChangeList("workItem", toWorkItemFormValues({
        clientId: current.clientId,
        policyId: current.policyId,
        insurerId: current.insurerId,
        receiptId: current.receiptId,
        title: current.title,
        description: current.description,
        taskType: current.taskType ?? "GENERAL",
        status: current.status,
        priority: current.priority,
        startDate: current.startDate,
        dueDate: current.dueDate,
        notes: current.notes,
      }), parsed.data, beforeDisplay, afterDisplay),
    };
    if (!payload.changes.length) return null;
    const draft = await createDraftRecord(user.id, payload, db);
    await writeActivityLog({
      entityType: "AssistantActionDraft",
      entityId: draft.id,
      action: "ASSISTANT_ACTION_DRAFT_CREATED",
      newValue: { entityType: payload.entityType, operation: payload.operation, targetLabel: payload.targetLabel },
      userId: user.id,
      db,
    });
    return buildProposalSnapshot({ draftId: draft.id, payload, expiresAt: draft.expiresAt });
  }

  const next = applyPlanFields(values, plan.fields);
  const afterDisplay: Record<string, string> = {};
  if (plan.relations.length > 0) {
    for (const relation of plan.relations) {
      const resolved = await resolveRelation(user, relation);
      if (!resolved || "error" in resolved) return null;
      next[resolved.field] = resolved.id;
      afterDisplay[resolved.field] = resolved.label;
    }
  }
  const parsed = workItemSchema.safeParse(next);
  if (!parsed.success) return null;

  const payload: AssistantActionDraftPayload = {
    title: plan.title || buildActionTitle("workItem", "create"),
    summary: plan.summary || buildActionSummary("workItem", "create", null),
    reply: plan.reply,
    entityType: "workItem",
    operation: "create",
    targetId: null,
    targetLabel: null,
    targetUpdatedAt: null,
    formValues: parsed.data,
    changes: buildChangeList("workItem", null, parsed.data, {}, afterDisplay),
  };
  const draft = await createDraftRecord(user.id, payload, db);
  await writeActivityLog({
    entityType: "AssistantActionDraft",
    entityId: draft.id,
    action: "ASSISTANT_ACTION_DRAFT_CREATED",
    newValue: { entityType: payload.entityType, operation: payload.operation, targetLabel: payload.targetLabel },
    userId: user.id,
    db,
  });
  return buildProposalSnapshot({ draftId: draft.id, payload, expiresAt: draft.expiresAt });
}

export async function buildAssistantActionProposalFromPlan(plan: AssistantMutationPlan, user: AssistantUser) {
  try {
    const normalizedEntityType = normalizeEntityType(plan.entityType);
    const normalizedOperation = normalizeOperation(plan.operation);
    if (!normalizedEntityType || !normalizedOperation) {
      return null;
    }
    if (plan.missingFields.length > 0) {
      return null;
    }

    const normalizedPlan: AssistantMutationPlan = {
      ...plan,
      entityType: normalizedEntityType,
      operation: normalizedOperation,
    };

    switch (normalizedPlan.entityType) {
      case "client":
        return buildClientDraft(normalizedPlan, user);
      case "policy":
        return buildPolicyDraft(normalizedPlan, user);
      case "receipt":
        return buildReceiptDraft(normalizedPlan, user);
      case "payment":
        return buildPaymentDraft(normalizedPlan, user);
      case "workItem":
        return buildWorkItemDraft(normalizedPlan, user);
    }
    return null;
  } catch (error) {
    logError("assistant.actions.buildDraft", error, { entityType: plan.entityType, operation: plan.operation });
    return null;
  }
}

async function executeDraftPayload(payload: AssistantActionDraftPayload): Promise<MutationResult> {
  switch (payload.entityType) {
    case "client":
      return payload.operation === "create"
        ? createClient(payload.formValues as Parameters<typeof createClient>[0])
        : updateClient(payload.targetId ?? "", payload.formValues as Parameters<typeof updateClient>[1]);
    case "policy":
      return payload.operation === "create"
        ? createPolicy(payload.formValues as Parameters<typeof createPolicy>[0])
        : updatePolicy(payload.targetId ?? "", payload.formValues as Parameters<typeof updatePolicy>[1]);
    case "receipt":
      return payload.operation === "create"
        ? createReceipt(payload.formValues as Parameters<typeof createReceipt>[0])
        : updateReceipt(payload.targetId ?? "", payload.formValues as Parameters<typeof updateReceipt>[1]);
    case "payment":
      return createPayment(payload.formValues as Parameters<typeof createPayment>[0]);
    case "workItem":
      return payload.operation === "create"
        ? createWorkItem(payload.formValues as Parameters<typeof createWorkItem>[0])
        : updateWorkItem(payload.targetId ?? "", payload.formValues as Parameters<typeof updateWorkItem>[1]);
  }
  return errorResult("La acción solicitada no está soportada.");
}

export async function confirmAssistantActionDraft(draftId: string, userId: string): Promise<MutationResult> {
  const db = getDb();
  const user = await getCurrentUser();
  if (!user || user.id !== userId) {
    return errorResult("No tienes permiso para confirmar esta propuesta.");
  }

  const draft = await getDraftOrThrow(draftId, userId, db);
  async function markDraftFailed(message: string) {
    await db.assistantActionDraft.update({
      where: { id: draft.id },
      data: { status: "FAILED" },
    });
    return errorResult(message);
  }

  if (draft.status !== "PENDING") {
    return errorResult("Esta propuesta ya no está pendiente.");
  }

  const now = new Date();
  if (draft.expiresAt.getTime() <= now.getTime()) {
    await db.assistantActionDraft.update({
      where: { id: draft.id },
      data: { status: "EXPIRED" },
    });
    return errorResult("La propuesta expiró. Pide a Nora que la regenere.");
  }

  const claimed = await db.assistantActionDraft.updateMany({
    where: {
      id: draft.id,
      userId,
      status: "PENDING",
      expiresAt: { gt: now },
    },
    data: { status: "CONFIRMING" },
  });
  if (claimed.count === 0) {
    return errorResult("La propuesta ya fue confirmada o caducó.");
  }

  const payload = parsePayload(draft.payloadJson);
  if (!payload) {
    await db.assistantActionDraft.update({
      where: { id: draft.id },
      data: { status: "FAILED" },
    });
    return errorResult("La propuesta está corrupta.");
  }

  if ((payload as { entityType?: string }).entityType === "task") {
    await db.assistantActionDraft.update({
      where: { id: draft.id },
      data: {
        status: "FAILED",
        resultJson: JSON.stringify({ ok: false, error: "Las propuestas antiguas de tareas deben recrearse como pendientes." }),
      },
    });
    return errorResult("La propuesta antigua de tarea ya no puede ejecutarse. Pide a Nora que la recree como pendiente.");
  }

  if (payload.operation === "update" && (!payload.targetId || !payload.targetUpdatedAt)) {
    await db.assistantActionDraft.update({
      where: { id: draft.id },
      data: { status: "FAILED" },
    });
    return errorResult("La propuesta de edición no tiene un objetivo válido.");
  }

  if (payload.operation === "update" && payload.targetId && payload.targetUpdatedAt) {
    if (payload.entityType === "workItem") {
      const current = await findWorkItemByRouteId(payload.targetId, db, user.role === "ADMIN" ? undefined : user.id);
      if (!current || current.updatedAt.toISOString() !== payload.targetUpdatedAt) {
        return markDraftFailed("La tarea cambió mientras revisabas la propuesta. Pide una nueva actualización.");
      }
    } else if (payload.entityType === "client" || payload.entityType === "policy" || payload.entityType === "receipt") {
      const entityDb = {
        client: db.client,
        policy: db.policy,
        receipt: db.receipt,
      } as const;
      if (payload.entityType === "client") {
        const current = await entityDb.client.findUnique({
          where: { id: payload.targetId },
          select: { updatedAt: true },
        });
        if (!current || current.updatedAt.toISOString() !== payload.targetUpdatedAt) {
          return markDraftFailed("El registro cambió mientras revisabas la propuesta. Pide una nueva actualización.");
        }
      } else if (payload.entityType === "policy") {
        const current = await entityDb.policy.findUnique({
          where: { id: payload.targetId },
          select: { updatedAt: true },
        });
        if (!current || current.updatedAt.toISOString() !== payload.targetUpdatedAt) {
          return markDraftFailed("El registro cambió mientras revisabas la propuesta. Pide una nueva actualización.");
        }
      } else {
        const current = await entityDb.receipt.findUnique({
          where: { id: payload.targetId },
          select: { updatedAt: true },
        });
        if (!current || current.updatedAt.toISOString() !== payload.targetUpdatedAt) {
          return markDraftFailed("El registro cambió mientras revisabas la propuesta. Pide una nueva actualización.");
        }
      }
    } else {
      return markDraftFailed("Los pagos solo se pueden crear desde Nora, no editar.");
    }
  }

  let result: MutationResult;
  try {
    result = await executeDraftPayload(payload);
  } catch (error) {
    logError("assistant.actions.executeDraft", error, { draftId: draft.id, entityType: payload.entityType, operation: payload.operation });
    result = errorResult(error instanceof Error ? error.message : "No se pudo ejecutar la propuesta.");
  }
  await db.assistantActionDraft.update({
    where: { id: draft.id },
    data: {
      status: result.ok ? "CONFIRMED" : "FAILED",
      confirmedAt: result.ok ? new Date() : null,
      payloadJson: draft.payloadJson,
      resultJson: JSON.stringify(result),
    },
  });

  await writeActivityLog({
    entityType: "AssistantActionDraft",
    entityId: draft.id,
    action: result.ok ? "ASSISTANT_ACTION_CONFIRMED" : "ASSISTANT_ACTION_FAILED",
    oldValue: { entityType: payload.entityType, operation: payload.operation, targetLabel: payload.targetLabel },
    newValue: result,
    userId,
    db,
  });

  return result;
}

export async function getAssistantActionDraftProposal(draftId: string, userId: string) {
  const db = getDb();
  const draft = await db.assistantActionDraft.findFirst({
    where: { id: draftId, userId },
  });
  if (!draft) return null;
  const payload = parsePayload(draft.payloadJson);
  if (!payload || (payload as { entityType?: string }).entityType === "task") return null;
  return buildProposalSnapshot({ draftId: draft.id, payload, expiresAt: draft.expiresAt });
}

export async function pruneExpiredAssistantActionDrafts(userId: string) {
  const db = getDb();
  const now = new Date();
  await db.assistantActionDraft.updateMany({
    where: {
      userId,
      status: "PENDING",
      expiresAt: { lte: now },
    },
    data: {
      status: "EXPIRED",
    },
  });
}
