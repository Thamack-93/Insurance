"use server";

import { getDb } from "@/lib/db";
import { today, daysUntil } from "@/lib/dates";
import { addDays } from "date-fns";
import { writeActivityLog } from "@/lib/activity-log";
import { logError } from "@/lib/logger";
import { upsertWorkItemFromSource } from "@/lib/work-items";

export interface RenewalOpportunity {
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

export async function getUpcomingRenewals(daysAhead: number = 90, portfolioOwnerId?: string) {
  const db = getDb();
  
  try {
    const todayDate = new Date(today());
    const futureDate = addDays(todayDate, daysAhead);
    
    const policies = await db.policy.findMany({
      where: {
        ...(portfolioOwnerId ? { client: { portfolioOwnerId } } : {}),
        status: "ACTIVE",
        endDate: {
          gte: todayDate,
          lte: futureDate,
        },
      },
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
      },
      orderBy: {
        endDate: "asc",
      },
    });

    const renewals: RenewalOpportunity[] = policies.map((policy) => {
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
    });

    return renewals;
  } catch (error) {
    logError("renewals.getUpcomingRenewals", error, { daysAhead });
    return [];
  }
}

export async function createRenewalWorkItems() {
  const db = getDb();
  
  try {
    const upcomingRenewals = await getUpcomingRenewals(60);
    let workItemsCreated = 0;

    for (const renewal of upcomingRenewals) {
      const workItemSourceId = `policy:${renewal.policyId}:renewal-workItem`;
      if (renewal.daysUntilRenewal <= 30) {
        const workItem = await upsertWorkItemFromSource({
          sourceType: "Task",
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
• Vencimiento: ${renewal.endDate.toLocaleDateString('es-MX')}
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
  const db = getDb();
  
  try {
    const todayDate = new Date(today());
    const next30Days = addDays(todayDate, 30);
    const next60Days = addDays(todayDate, 60);
    const next90Days = addDays(todayDate, 90);

    const [
      overdueCount,
      next30DaysCount,
      next60DaysCount,
      next90DaysCount,
      totalActive,
    ] = await Promise.all([
      db.policy.count({
        where: {
          ...(portfolioOwnerId ? { client: { portfolioOwnerId } } : {}),
          status: "ACTIVE",
          endDate: {
            lt: todayDate,
          },
        },
      }),
      db.policy.count({
        where: {
          ...(portfolioOwnerId ? { client: { portfolioOwnerId } } : {}),
          status: "ACTIVE",
          endDate: {
            gte: todayDate,
            lte: next30Days,
          },
        },
      }),
      db.policy.count({
        where: {
          ...(portfolioOwnerId ? { client: { portfolioOwnerId } } : {}),
          status: "ACTIVE",
          endDate: {
            gt: next30Days,
            lte: next60Days,
          },
        },
      }),
      db.policy.count({
        where: {
          ...(portfolioOwnerId ? { client: { portfolioOwnerId } } : {}),
          status: "ACTIVE",
          endDate: {
            gt: next60Days,
            lte: next90Days,
          },
        },
      }),
      db.policy.count({
        where: {
          ...(portfolioOwnerId ? { client: { portfolioOwnerId } } : {}),
          status: "ACTIVE",
        },
      }),
    ]);

    // Calculate premium amounts for renewals
    const renewalPolicies = await db.policy.findMany({
      where: {
        ...(portfolioOwnerId ? { client: { portfolioOwnerId } } : {}),
        status: "ACTIVE",
        endDate: {
          gte: todayDate,
          lte: next90Days,
        },
      },
      select: {
        premiumAmount: true,
        currency: true,
        endDate: true,
      },
    });

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
