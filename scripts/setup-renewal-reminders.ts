#!/usr/bin/env tsx

import {
  businessAddDays,
  businessStartOfDay,
  formatBusinessDate,
  formatBusinessDateInput,
} from "../src/lib/business-dates.ts";
import { getDb } from "../src/lib/db";

async function main() {
  const db = getDb();
  const now = businessStartOfDay(new Date());

  console.log("Configurando pendientes de renovación...\n");

  const policies = await db.policy.findMany({
    where: {
      status: "ACTIVE",
      endDate: {
        gt: now,
      },
    },
  });

  let workItemsCreated = 0;

  for (const policy of policies) {
    if (!policy.endDate) continue;
    if (!policy.organizationId) throw new Error("POLICYDESK_RENEWAL_ORGANIZATION_REQUIRED");

    const endDate = businessStartOfDay(policy.endDate);
    const today = now;

    const daysUntilExpiry = Math.floor((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntilExpiry > 90 || daysUntilExpiry < 0) {
      continue;
    }

    const reminderDays = [60, 30, 15, 7, 1];

    for (const daysBefore of reminderDays) {
      const dueDate = businessAddDays(endDate, -daysBefore);
      if (dueDate < today) {
        continue;
      }

      const sourceId = `${policy.id}:${formatBusinessDateInput(dueDate)}`;
      const existing = await db.workItem.findUnique({
        where: {
          organizationId_sourceType_sourceId: {
            organizationId: policy.organizationId,
            sourceType: "Renewal",
            sourceId,
          },
        },
      });

      if (existing) {
        continue;
      }

      const client = await db.client.findUnique({
        where: { id: policy.clientId },
      });

      await db.workItem.create({
        data: {
          organizationId: policy.organizationId,
          sourceType: "Renewal",
          sourceId,
          workItemType: "TASK",
          taskType: "RENEWAL",
          status: "OPEN",
          priority: "MEDIUM",
          title: `Renovación: ${policy.policyNumber}`,
          description: `La póliza ${policy.policyNumber} de ${client?.fullName || "Cliente"} vence el ${formatBusinessDate(endDate, "dd/MM/yyyy")}.`,
          entityType: "POLICY",
          entityId: policy.id,
          clientId: policy.clientId,
          policyId: policy.id,
          insurerId: policy.insurerId,
          dueDate,
          startDate: now,
        },
      });

      workItemsCreated++;
    }
  }

  console.log(`✅ Pendientes creados: ${workItemsCreated}`);
  console.log(`📊 Pólizas procesadas: ${policies.length}`);
}

main().catch(console.error);
