import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { claimOperationalWhere } from "@/lib/portfolio-access";
import type { PolicyType } from "@/lib/domain-values";
import type { OrganizationContext } from "@/lib/organization-context";

type DbClient = PrismaClient | Prisma.TransactionClient;

async function withChecklistTenant<T>(organizationId: string, client: DbClient | undefined, callback: (db: DbClient) => Promise<T>) {
  if (client) return callback(client);
  const { requireOrganizationContext, withTenantTransaction } = await import("@/lib/organization-context");
  const context: OrganizationContext = await requireOrganizationContext();
  if (context.organizationId !== organizationId) throw new Error("ORGANIZATION_CONTEXT_MISMATCH");
  return withTenantTransaction(context, callback);
}

export const CLAIM_CHECKLIST_STATUSES = ["MISSING", "REQUESTED", "RECEIVED", "WAIVED"] as const;
export type ClaimChecklistStatusValue = (typeof CLAIM_CHECKLIST_STATUSES)[number];

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
) {
  return withChecklistTenant(organizationId, client, async (db) => {
  const claim = await db.claim.findFirst({
    where: { AND: [{ id: input.claimId }, claimOperationalWhere(portfolioOwnerId, organizationId)] },
    select: { id: true, policy: { select: { policyType: true } } },
  });
  if (!claim) return null;
  const template = getClaimChecklistTemplate(claim.policy.policyType).find((item) => item.code === input.requirementCode);
  if (!template || !CLAIM_CHECKLIST_STATUSES.includes(input.status)) return null;

  const now = new Date();
  return db.claimChecklistItem.upsert({
    where: { claimId_requirementCode: { claimId: claim.id, requirementCode: template.code } },
    create: {
      organizationId,
      claimId: claim.id,
      requirementCode: template.code,
      label: template.label,
      status: input.status,
      requestedAt: input.status === "REQUESTED" ? now : null,
      receivedAt: input.status === "RECEIVED" ? now : null,
      waivedAt: input.status === "WAIVED" ? now : null,
    },
    update: {
      label: template.label,
      status: input.status,
      requestedAt: input.status === "REQUESTED" ? now : null,
      receivedAt: input.status === "RECEIVED" ? now : null,
      waivedAt: input.status === "WAIVED" ? now : null,
    },
  });
  });
}
