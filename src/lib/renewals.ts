"use server";

import { getDb } from "@/lib/db";
import { today, daysUntil } from "@/lib/dates";
import { addDays } from "date-fns";
import { writeActivityLog } from "@/lib/activity-log";
import { logError } from "@/lib/logger";

export interface RenewalReminder {
  policyId: string;
  clientId: string;
  insurerId: string;
  renewalDate: Date;
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

export async function getUpcomingRenewals(daysAhead: number = 90) {
  const db = getDb();
  
  try {
    const todayDate = new Date(today());
    const futureDate = addDays(todayDate, daysAhead);
    
    const policies = await db.policy.findMany({
      where: {
        status: "ACTIVE",
        renewalDate: {
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
        renewalDate: "asc",
      },
    });

    const renewals: RenewalReminder[] = policies
      .filter(policy => policy.renewalDate !== null)
      .map(policy => {
        const renewalDate = policy.renewalDate!;
        const daysUntilRenewal = daysUntil(renewalDate);
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
          renewalDate,
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

export async function createRenewalTasks() {
  const db = getDb();
  
  try {
    const upcomingRenewals = await getUpcomingRenewals(60);
    let tasksCreated = 0;

    for (const renewal of upcomingRenewals) {
      // Check if task already exists
      const existingTask = await db.task.findFirst({
        where: {
          policyId: renewal.policyId,
          taskType: "RENEWAL",
          status: {
            in: ["OPEN", "IN_PROGRESS"],
          },
        },
      });

      if (!existingTask && renewal.daysUntilRenewal <= 30) {
        await db.task.create({
          data: {
            folio: `TASK-RENEWAL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            title: `Renovación de póliza ${renewal.policyNumber}`,
            description: generateRenewalTaskDescription(renewal),
            clientId: renewal.clientId,
            policyId: renewal.policyId,
            insurerId: renewal.insurerId,
            priority: renewal.priority,
            status: "OPEN",
            dueDate: renewal.renewalDate,
            taskType: "RENEWAL",
          },
        });

        tasksCreated++;

        // Log activity
        await writeActivityLog({
          action: "CREATE_RENEWAL_TASK",
          entityType: "TASK",
          entityId: renewal.policyId,
          newValue: JSON.stringify({
            policyNumber: renewal.policyNumber,
            renewalDate: renewal.renewalDate,
            daysUntil: renewal.daysUntilRenewal,
            priority: renewal.priority,
          }),
        });
      }
    }

    return { tasksCreated };
  } catch (error) {
    logError("renewals.createRenewalTasks", error);
    return { tasksCreated: 0 };
  }
}

function generateRenewalTaskDescription(renewal: RenewalReminder): string {
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
• Vencimiento: ${renewal.renewalDate.toLocaleDateString('es-MX')}
• Días restantes: ${renewal.daysUntilRenewal}

Acciones requeridas:
1. Contactar al cliente para ofrecer renovación
2. Preparar cotización de renovación
3. Coordinar con aseguradora
4. Documentar seguimiento

${renewal.clientEmail ? `Email del cliente: ${renewal.clientEmail}` : ''}`;
}

export async function sendRenewalReminders() {
  const db = getDb();
  
  try {
    const upcomingRenewals = await getUpcomingRenewals(30);
    const remindersSent = [];

    for (const renewal of upcomingRenewals) {
      // Only send reminders for high priority renewals
      if (renewal.priority === "HIGH" || renewal.priority === "URGENT") {
        // Create a reminder record (in a real system, this would send emails/SMS)
        const reminder = await db.activityLog.create({
          data: {
            action: "SEND_RENEWAL_REMINDER",
            entityType: "POLICY",
            entityId: renewal.policyId,
            userId: "system-user-0000",
            newValue: JSON.stringify({
              policyNumber: renewal.policyNumber,
              clientName: renewal.clientName,
              clientEmail: renewal.clientEmail,
              renewalDate: renewal.renewalDate,
              daysUntil: renewal.daysUntilRenewal,
              priority: renewal.priority,
              reminderType: "AUTOMATIC",
            }),
          },
        });

        remindersSent.push({
          renewal,
          reminderId: reminder.id,
        });

        // Log the reminder action
        await writeActivityLog({
          action: "SEND_RENEWAL_REMINDER",
          entityType: "POLICY",
          entityId: renewal.policyId,
          newValue: JSON.stringify({
            reminderSent: true,
            priority: renewal.priority,
            daysUntil: renewal.daysUntilRenewal,
          }),
        });
      }
    }

    return { remindersSent: remindersSent.length };
  } catch (error) {
    logError("renewals.sendRenewalReminders", error);
    return { remindersSent: 0 };
  }
}

export async function getRenewalStats() {
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
          status: "ACTIVE",
          renewalDate: {
            lt: todayDate,
          },
        },
      }),
      db.policy.count({
        where: {
          status: "ACTIVE",
          renewalDate: {
            gte: todayDate,
            lte: next30Days,
          },
        },
      }),
      db.policy.count({
        where: {
          status: "ACTIVE",
          renewalDate: {
            gt: next30Days,
            lte: next60Days,
          },
        },
      }),
      db.policy.count({
        where: {
          status: "ACTIVE",
          renewalDate: {
            gt: next60Days,
            lte: next90Days,
          },
        },
      }),
      db.policy.count({
        where: {
          status: "ACTIVE",
        },
      }),
    ]);

    // Calculate premium amounts for renewals
    const renewalPolicies = await db.policy.findMany({
      where: {
        status: "ACTIVE",
        renewalDate: {
          gte: todayDate,
          lte: next90Days,
        },
      },
      select: {
        premiumAmount: true,
        currency: true,
        renewalDate: true,
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
