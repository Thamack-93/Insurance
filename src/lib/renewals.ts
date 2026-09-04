import "server-only";

import { connection } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { today, daysUntil, formatDate } from "@/lib/dates";
import { businessAddDays } from "@/lib/business-dates";
import { writeActivityLog } from "@/lib/activity-log";
import { logError } from "@/lib/logger";
import { upsertWorkItemFromSource } from "@/lib/work-items";
import { ACTIVE_RENEWAL_POLICY_WHERE } from "@/lib/renewal-decisions";
import { LATEST_RENEWAL_RECEIPT_INCLUDE, getLatestReceiptStatus } from "@/lib/renewal-receipt";
import { shouldIncludeInRenewals } from "@/lib/renewals.logic";
import { requireOrganizationContext, withTenantTransaction, type TenantDb } from "@/lib/organization-context";

export interface RenewalOpportunity {
  organizationId: string;
  policyId: string;
  clientId: string;
  insurerId: string;
  endDate: Date;
  daysUntilRenewal: number;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  policyNumber: string;
  clientName: string;
  clientEmail?: string;
  insurerName: string;
  policyType: string;
  premiumAmount: number;
  currency: string;
}

type RenewalPolicyRecord = {
  organizationId: string;
  id: string;
  clientId: string;
  insurerId: string;
  status: string;
  endDate: Date;
  policyNumber: string;
  policyType: string;
  premiumAmount: unknown;
  currency: string;
  client: { fullName: string; email: string | null };
  insurer: { name: string };
  receipts: Array<{ status: string | null }>;
};

function mapPolicyToRenewalOpportunity(policy: RenewalPolicyRecord): RenewalOpportunity {
  const endDate = policy.endDate;
  const daysUntilRenewal = daysUntil(endDate);
  let priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT" = "LOW";

  if (daysUntilRenewal <= 0) {
    priority = "URGENT";
  } else if (daysUntilRenewal <= 15) {
    priority = "HIGH";
  } else if (daysUntilRenewal <= 30) {
    priority = "MEDIUM";
  }

  return {
    organizationId: policy.organizationId,
    policyId: policy.id,
    clientId: policy.clientId,
    insurerId: policy.insurerId,
    endDate,
    daysUntilRenewal,
    priority,
    policyNumber: policy.policyNumber,
    clientName: policy.client.fullName,
    clientEmail: policy.client.email || undefined,
    insurerName: policy.insurer.name,
    policyType: policy.policyType,
    premiumAmount: Number(policy.premiumAmount),
    currency: policy.currency,
  };
}

function buildRenewalWhere(portfolioOwnerId?: string, organizationId?: string, additionalWhere: Prisma.PolicyWhereInput = {}): Prisma.PolicyWhereInput {
  return {
    ...(organizationId ? { organizationId, client: { organizationId, ...(portfolioOwnerId ? { portfolioOwnerId } : {}) } } : {}),
    ...(portfolioOwnerId && !organizationId ? { client: { portfolioOwnerId } } : {}),
    ...ACTIVE_RENEWAL_POLICY_WHERE,
    ...additionalWhere,
  };
}

export async function loadEligibleRenewalPolicies(
  additionalWhere: Prisma.PolicyWhereInput,
  portfolioOwnerId?: string,
  organizationId?: string,
  client?: TenantDb,
): Promise<RenewalPolicyRecord[]> {
  await connection();
  const context = await requireOrganizationContext();
  if (organizationId && organizationId !== context.organizationId) {
    throw new Error("ORGANIZATION_CONTEXT_MISMATCH");
  }
  const effectiveOrganizationId = context.organizationId;

  if (!client) {
    return withTenantTransaction(context, (tx) => loadEligibleRenewalPolicies(additionalWhere, portfolioOwnerId, effectiveOrganizationId, tx));
  }

  const policies = await client.policy.findMany({
    where: buildRenewalWhere(portfolioOwnerId, effectiveOrganizationId, additionalWhere),
    include: {
      client: {
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
        },
      },
      insurer: {
        select: {
          id: true,
          name: true,
          contactEmail: true,
          contactPhone: true,
        },
      },
      ...LATEST_RENEWAL_RECEIPT_INCLUDE,
    },
    orderBy: [{ endDate: "asc" }, { policyNumber: "asc" }, { id: "asc" }],
  });

  return policies.filter((policy) =>
    shouldIncludeInRenewals(policy.status, policy.endDate, getLatestReceiptStatus(policy.receipts)),
  ) as RenewalPolicyRecord[];
}

export async function getUpcomingRenewals(daysAhead: number = 90, portfolioOwnerId?: string, organizationId?: string, client?: TenantDb) {
  try {
    const todayDate = today();
    const futureDate = businessAddDays(todayDate, daysAhead);
    const policies = await loadEligibleRenewalPolicies(
      {
        endDate: {
          gte: todayDate,
          lte: futureDate,
        },
      },
      portfolioOwnerId,
      organizationId,
      client,
    );

    return policies.map(mapPolicyToRenewalOpportunity);
  } catch (error) {
    logError("renewals.getUpcomingRenewals", error, { daysAhead });
    return [];
  }
}

export async function getOverdueRenewals(portfolioOwnerId?: string, organizationId?: string, client?: TenantDb) {
  try {
    const todayDate = today();
    const policies = await loadEligibleRenewalPolicies(
      {
        endDate: {
          lt: todayDate,
        },
      },
      portfolioOwnerId,
      organizationId,
      client,
    );
    return policies.map(mapPolicyToRenewalOpportunity);
  } catch (error) {
    logError("renewals.getOverdueRenewals", error);
    return [];
  }
}

export async function createRenewalWorkItems() {
  try {
    const context = await requireOrganizationContext();
    return await withTenantTransaction(context, async (db) => {
    const upcomingRenewals = (await loadEligibleRenewalPolicies(
      { endDate: { gte: today(), lte: businessAddDays(today(), 60) } },
      context.membershipRole === "AGENT" ? context.userId : undefined,
      context.organizationId,
      db,
    )).map(mapPolicyToRenewalOpportunity);
    let workItemsCreated = 0;

    for (const renewal of upcomingRenewals) {
      const workItemSourceId = `policy:${renewal.policyId}:renewal-workItem`;
      if (renewal.daysUntilRenewal <= 30) {
        const workItem = await upsertWorkItemFromSource({
          organizationId: renewal.organizationId,
          sourceType: "Renewal",
          sourceId: workItemSourceId,
          workItemType: "TASK",
          taskType: "RENEWAL",
          status: "OPEN",
          priority: renewal.priority,
          folio: `TASK-RENEWAL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          title: `Renovación de póliza ${renewal.policyNumber}`,
          description: generateRenewalWorkItemDescription(renewal),
          entityType: "WorkItem",
          entityId: workItemSourceId,
          clientId: renewal.clientId,
          policyId: renewal.policyId,
          insurerId: renewal.insurerId,
          dueDate: renewal.endDate,
          createdById: null,
          updatedById: null,
        }, db);

        if (workItem) {
          workItemsCreated++;

          await writeActivityLog({
            organizationId: renewal.organizationId,
            action: "CREATE_RENEWAL_WORK_ITEM",
            entityType: "WorkItem",
            entityId: workItemSourceId,
            newValue: JSON.stringify({
              policyNumber: renewal.policyNumber,
              endDate: renewal.endDate,
              daysUntil: renewal.daysUntilRenewal,
              priority: renewal.priority,
            }),
          });
        }
      }
    }

    return { workItemsCreated };
    });
  } catch (error) {
    logError("renewals.createRenewalWorkItems", error);
    return { workItemsCreated: 0 };
  }
}

function generateRenewalWorkItemDescription(renewal: RenewalOpportunity): string {
  const urgencyText = {
    URGENT: "URGENTE: La póliza vence hoy o está vencida",
    HIGH: "ALTA: La póliza vence en menos de 15 días",
    MEDIUM: "MEDIA: La póliza vence en menos de 30 días",
    LOW: "BAJA: La póliza vence en más de 30 días",
  };

  return `${urgencyText[renewal.priority]}

Detalles de la póliza:
• Número: ${renewal.policyNumber}
• Cliente: ${renewal.clientName}
• Aseguradora: ${renewal.insurerName}
• Tipo: ${renewal.policyType}
• Prima: ${renewal.premiumAmount} ${renewal.currency}
• Vencimiento: ${formatDate(renewal.endDate, "dd/MM/yyyy")}
• Días restantes: ${renewal.daysUntilRenewal}

Acciones requeridas:
1. Contactar al cliente para ofrecer renovación
2. Preparar cotización de renovación
3. Coordinar con aseguradora
4. Documentar seguimiento

${renewal.clientEmail ? `Email del cliente: ${renewal.clientEmail}` : ''}`;
}

export async function sendRenewalWorkItems() {
  try {
    const { workItemsCreated } = await createRenewalWorkItems();
    return { workItemsCreated };
  } catch (error) {
    logError("renewals.sendRenewalWorkItems", error);
    return { workItemsCreated: 0 };
  }
}

export async function getRenewalStats(portfolioOwnerId?: string) {
  try {
    const todayDate = today();
    const next30Days = businessAddDays(todayDate, 30);
    const next60Days = businessAddDays(todayDate, 60);
    const next90Days = businessAddDays(todayDate, 90);

    const renewalPolicies = await loadEligibleRenewalPolicies({}, portfolioOwnerId);

    const overdueCount = renewalPolicies.filter((policy) => policy.endDate < todayDate).length;
    const next30DaysCount = renewalPolicies.filter(
      (policy) => policy.endDate >= todayDate && policy.endDate <= next30Days,
    ).length;
    const next60DaysCount = renewalPolicies.filter(
      (policy) => policy.endDate > next30Days && policy.endDate <= next60Days,
    ).length;
    const next90DaysCount = renewalPolicies.filter(
      (policy) => policy.endDate > next60Days && policy.endDate <= next90Days,
    ).length;
    const totalActive = renewalPolicies.length;

    const totalRenewalPremium = renewalPolicies.reduce(
      (sum, policy) => sum + Number(policy.premiumAmount),
      0
    );

    return {
      overdueCount,
      next30DaysCount,
      next60DaysCount,
      next90DaysCount,
      totalActive,
      totalRenewalPremium,
      averagePremium: renewalPolicies.length > 0 ? totalRenewalPremium / renewalPolicies.length : 0,
    };
  } catch (error) {
    logError("renewals.getRenewalStats", error);
    return {
      overdueCount: 0,
      next30DaysCount: 0,
      next60DaysCount: 0,
      next90DaysCount: 0,
      totalActive: 0,
      totalRenewalPremium: 0,
      averagePremium: 0,
    };
  }
}
