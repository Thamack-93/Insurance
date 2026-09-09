import "server-only";
import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { claimOperationalWhere } from "@/lib/portfolio-access";
import type { PolicyType } from "@/lib/domain-values";
import { writeActivityLog } from "@/lib/activity-log";
import { requireOrganizationContext, withOrganizationTransaction, type OrganizationContext } from "@/lib/organization-context";
import { CLAIM_CHECKLIST_STATUSES, type ClaimChecklistStatusValue } from "@/lib/claim-checklist-values";

export { CLAIM_CHECKLIST_STATUSES, CLAIM_CHECKLIST_STATUS_LABELS, isClaimChecklistPending } from "@/lib/claim-checklist-values";
export type { ClaimChecklistStatusValue } from "@/lib/claim-checklist-values";

type DbClient = PrismaClient | Prisma.TransactionClient;

async function withChecklistTenant<T>(organizationId: string, client: DbClient | undefined, callback: (db: DbClient) => Promise<T>) {
  if (client) return callback(client);
  const { requireOrganizationContext, withTenantTransaction } = await import("@/lib/organization-context");
  const context: OrganizationContext = await requireOrganizationContext();
  if (context.organizationId !== organizationId) throw new Error("ORGANIZATION_CONTEXT_MISMATCH");
  return withTenantTransaction(context, callback);
}

export function createCustomClaimRequirementCode() {
  return `CUSTOM:${randomUUID()}`;
}

export function checklistTimestamps(status: ClaimChecklistStatusValue, now: Date) {
  return {
    requestedAt: status === "REQUESTED" ? now : null,
    receivedAt: status === "RECEIVED" ? now : null,
    waivedAt: status === "WAIVED" ? now : null,
  };
}

type ChecklistTemplateItem = {
  code: string;
  label: string;
};

const COMMON_ITEMS: ChecklistTemplateItem[] = [
  { code: "claim_notice", label: "Aviso de siniestro" },
  { code: "identity_evidence", label: "Identificación y acreditación del reclamante" },
  { code: "policy_evidence", label: "Datos de póliza y cobertura" },
  { code: "incident_evidence", label: "Evidencia del evento" },
  { code: "payment_evidence", label: "Datos bancarios o comprobantes aplicables" },
  { code: "insurer_additional", label: "Requisitos adicionales de la aseguradora" },
];

const TEMPLATE_BY_LINE: Partial<Record<PolicyType, ChecklistTemplateItem[]>> = {
  AUTO: [
    { code: "claim_notice", label: "Aviso de accidente o robo" },
    { code: "identity_evidence", label: "Identificación del asegurado o conductor" },
    { code: "policy_evidence", label: "Póliza y tarjeta de circulación" },
    { code: "incident_evidence", label: "Declaración y evidencia del evento" },
    { code: "adjuster_evidence", label: "Reporte o valuación del ajustador" },
    { code: "insurer_additional", label: "Requisitos adicionales de la aseguradora" },
  ],
  GMM: [
    { code: "claim_notice", label: "Aviso de reclamación" },
    { code: "identity_evidence", label: "Identificación y acreditación del asegurado" },
    { code: "policy_evidence", label: "Datos de póliza y cobertura" },
    { code: "medical_report_metadata", label: "Informe médico recibido" },
    { code: "medical_studies_metadata", label: "Estudios o resultados recibidos" },
    { code: "expense_evidence_metadata", label: "Comprobantes de gasto recibidos" },
    { code: "payment_evidence", label: "Datos bancarios para reembolso" },
    { code: "insurer_additional", label: "Requisitos adicionales de la aseguradora" },
  ],
  VIDA: [
    { code: "claim_notice", label: "Aviso de reclamación" },
    { code: "claimant_identity", label: "Identificación del reclamante" },
    { code: "policy_evidence", label: "Datos de póliza y beneficiarios" },
    { code: "event_certificate_metadata", label: "Constancia oficial del evento recibida" },
    { code: "relationship_evidence", label: "Acreditación de parentesco o beneficiario" },
    { code: "payment_evidence", label: "Datos bancarios para pago" },
    { code: "insurer_additional", label: "Requisitos adicionales de la aseguradora" },
  ],
};

export function getClaimChecklistTemplate(policyType: string): ChecklistTemplateItem[] {
  return TEMPLATE_BY_LINE[policyType as PolicyType] ?? COMMON_ITEMS;
}

export function isMedicalChecklistCode(code: string) {
  return code.includes("medical") || code.includes("expense_evidence");
}

export async function getClaimChecklistSummary(
  claimId: string,
  organizationId: string,
  portfolioOwnerId?: string,
  client?: DbClient,
) {
  return withChecklistTenant(organizationId, client, async (db) => {
  const claim = await db.claim.findFirst({
    where: { AND: [{ id: claimId }, claimOperationalWhere(portfolioOwnerId, organizationId)] },
    select: {
      id: true,
      folio: true,
      status: true,
      policy: { select: { policyType: true, policyNumber: true } },
      checklistItems: {
        select: {
          requirementCode: true,
          label: true,
          status: true,
          requestedAt: true,
          receivedAt: true,
          waivedAt: true,
          documentId: true,
        },
      },
    },
  });
  if (!claim) return null;

  const stored = new Map(claim.checklistItems.map((item) => [item.requirementCode, item]));
  const items = getClaimChecklistTemplate(claim.policy.policyType).map((template) => {
    const item = stored.get(template.code);
    return {
      code: template.code,
      label: template.label,
      status: item?.status ?? "MISSING",
      requestedAt: item?.requestedAt?.toISOString() ?? null,
      receivedAt: item?.receivedAt?.toISOString() ?? null,
      waivedAt: item?.waivedAt?.toISOString() ?? null,
      documentLinked: Boolean(item?.documentId),
    };
  });

  return {
    claimId: claim.id,
    folio: claim.folio,
    claimStatus: claim.status,
    policyType: claim.policy.policyType,
    policyNumber: claim.policy.policyNumber,
    advisory: "Lista operativa orientativa; los requisitos finales dependen de la aseguradora y la cobertura.",
    items,
    counts: Object.fromEntries(CLAIM_CHECKLIST_STATUSES.map((status) => [status, items.filter((item) => item.status === status).length])),
  };
  });
}

export async function updateClaimChecklistStatus(
  input: {
    claimId: string;
    requirementCode: string;
    status: ClaimChecklistStatusValue;
  },
  organizationId: string,
  portfolioOwnerId?: string,
  client?: DbClient,
  actorUserId?: string,
): Promise<{ id: string; status: ClaimChecklistStatusValue; updatedAt: Date } | null> {
  if (!client && actorUserId) {
    const context = await requireOrganizationContext();
    if (context.organizationId !== organizationId) return null;
    return withOrganizationTransaction<{ id: string; status: ClaimChecklistStatusValue; updatedAt: Date } | null>(context, (tx) => updateClaimChecklistStatus(input, organizationId, portfolioOwnerId, tx, actorUserId));
  }
  return withChecklistTenant(organizationId, client, async (db) => {
  const claim = await db.claim.findFirst({
    where: { AND: [{ id: input.claimId }, claimOperationalWhere(portfolioOwnerId, organizationId)] },
    select: { id: true, status: true, policy: { select: { policyType: true } } },
  });
  if (!claim) return null;
  if (claim.status === "RESOLVED" || claim.status === "CANCELLED") return null;
  const template = getClaimChecklistTemplate(claim.policy.policyType).find((item) => item.code === input.requirementCode);
  if (!template || !CLAIM_CHECKLIST_STATUSES.includes(input.status)) return null;

  const checklistDelegate = db.claimChecklistItem as unknown as { findUnique?: (args: unknown) => Promise<{ id: string; status: ClaimChecklistStatusValue; updatedAt: Date } | null> };
  const current = checklistDelegate.findUnique
    ? await checklistDelegate.findUnique({
        where: { claimId_requirementCode: { claimId: claim.id, requirementCode: template.code } },
        select: { id: true, status: true, updatedAt: true },
      })
    : null;
  if (current?.status === input.status) return current;

  const now = new Date();
  const updated = await db.claimChecklistItem.upsert({
    where: { claimId_requirementCode: { claimId: claim.id, requirementCode: template.code } },
    create: {
      organizationId,
      claimId: claim.id,
      requirementCode: template.code,
      label: template.label,
      status: input.status,
      ...checklistTimestamps(input.status, now),
    },
    update: {
      label: template.label,
      status: input.status,
      ...checklistTimestamps(input.status, now),
    },
  });
  if (actorUserId) {
    await writeActivityLog({
      organizationId,
      action: "UPDATE_CLAIM_REQUIREMENT",
      entityType: "Claim",
      entityId: claim.id,
      oldValue: { requirementCode: template.code, oldStatus: current?.status ?? "MISSING" },
      newValue: { requirementCode: template.code, label: template.label, newStatus: input.status },
      userId: actorUserId,
      db,
    });
  }
  return updated;
  });
}
