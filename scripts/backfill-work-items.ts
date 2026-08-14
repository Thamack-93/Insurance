import {
  mapNotificationStatusToWorkItemStatus,
  mapTaskStatusToWorkItemStatus,
  upsertWorkItemFromSource,
} from "@/lib/work-items";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";
import { assertProductionMutationAllowed } from "./_shared.ts";

async function main() {
  assertProductionMutationAllowed({
    actionLabel: "El backfill de WorkItems",
    overrideEnv: "ALLOW_WORK_ITEM_BACKFILL_PRODUCTION",
  });
  const db = getDb();

  let taskCreated = 0;
  let taskUpdated = 0;
  let notificationCreated = 0;
  let notificationUpdated = 0;

  const tasks = await db.task.findMany({
    select: {
      id: true,
      organizationId: true,
      folio: true,
      clientId: true,
      policyId: true,
      insurerId: true,
      receiptId: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      startDate: true,
      dueDate: true,
      closedDate: true,
      notes: true,
      taskType: true,
      createdById: true,
      updatedById: true,
    },
  });

  for (const task of tasks) {
    if (!task.organizationId) throw new Error("POLICYDESK_WORK_ITEM_SOURCE_ORGANIZATION_REQUIRED");
    const existing = await db.workItem.findUnique({
      where: {
        organizationId_sourceType_sourceId: {
          organizationId: task.organizationId,
          sourceType: "Task",
          sourceId: task.id,
        },
      },
      select: { id: true },
    });

    await upsertWorkItemFromSource({
      organizationId: task.organizationId!,
      sourceType: "Task",
      sourceId: task.id,
      workItemType: "TASK",
      status: mapTaskStatusToWorkItemStatus(task.status),
      priority: task.priority,
      folio: task.folio,
      title: task.title,
      description: task.description,
      entityType: "Task",
      entityId: task.id,
      clientId: task.clientId,
      policyId: task.policyId,
      insurerId: task.insurerId,
      receiptId: task.receiptId,
      startDate: task.startDate,
      dueDate: task.dueDate,
      closedDate: task.closedDate,
      notes: task.notes,
      taskType: task.taskType,
      createdById: task.createdById,
      updatedById: task.updatedById,
    });

    if (existing) taskUpdated++;
    else taskCreated++;
  }

  const alerts = await db.alert.findMany({
    select: {
      id: true,
      organizationId: true,
      severity: true,
      title: true,
      description: true,
      entityType: true,
      entityId: true,
      status: true,
      readAt: true,
    },
  });

  for (const alert of alerts) {
    if (!alert.organizationId) throw new Error("POLICYDESK_WORK_ITEM_SOURCE_ORGANIZATION_REQUIRED");
    const existing = await db.workItem.findUnique({
      where: {
        organizationId_sourceType_sourceId: {
          organizationId: alert.organizationId,
          sourceType: "Notification",
          sourceId: alert.id,
        },
      },
      select: { id: true },
    });

    await upsertWorkItemFromSource({
      organizationId: alert.organizationId!,
      sourceType: "Notification",
      sourceId: alert.id,
      workItemType: "NOTIFICATION",
      status: mapNotificationStatusToWorkItemStatus(alert.status),
      severity: alert.severity,
      title: alert.title,
      description: alert.description,
      entityType: alert.entityType,
      entityId: alert.entityId,
      readAt: alert.readAt,
    });

    if (existing) notificationUpdated++;
    else notificationCreated++;
  }

  console.log(
    JSON.stringify(
      {
        tasks: {
          total: tasks.length,
          created: taskCreated,
          updated: taskUpdated,
        },
        notifications: {
          total: alerts.length,
          created: notificationCreated,
          updated: notificationUpdated,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  logError("scripts.backfill-work-items", error);
  process.exitCode = 1;
});
