#!/usr/bin/env tsx

import { addDays, format } from "date-fns";
import { getDb } from "../src/lib/db";

async function main() {
  const db = getDb();

  console.log("Configurando pendientes de renovación...\n");

  const policies = await db.policy.findMany({
    where: {
      status: "ACTIVE",
      endDate: {
        gt: new Date(),
      },
    },
  });

  let workItemsCreated = 0;

  for (const policy of policies) {
    if (!policy.endDate) continue;

    const endDate = new Date(policy.endDate);
    const today = new Date();

    const daysUntilExpiry = Math.floor((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntilExpiry > 90 || daysUntilExpiry < 0) {
      continue;
    }

    const reminderDays = [60, 30, 15, 7, 1];

    for (const daysBefore of reminderDays) {
      const dueDate = addDays(endDate, -daysBefore);
      if (dueDate < today) {
        continue;
      }

      const sourceId = `${policy.id}:${dueDate.toISOString()}`;
      const existing = await db.workItem.findUnique({
        where: {
          sourceType_sourceId: {
            sourceType: "Task",
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
          sourceType: "Task",
          sourceId,
          workItemType: "TASK",
          taskType: "RENEWAL",
          status: "OPEN",
          priority: "MEDIUM",
          title: `Renovación: ${policy.policyNumber}`,
          description: `La póliza ${policy.policyNumber} de ${client?.fullName || "Cliente"} vence el ${format(endDate, "dd/MM/yyyy")}.`,
          entityType: "POLICY",
          entityId: policy.id,
          dueDate,
          startDate: new Date(),
        },
      });

      workItemsCreated++;
    }
  }

  console.log(`✅ Pendientes creados: ${workItemsCreated}`);
  console.log(`📊 Pólizas procesadas: ${policies.length}`);
}

main().catch(console.error);
