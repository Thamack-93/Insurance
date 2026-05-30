import { getDb } from "@/lib/db";
import { mapAlertStatusToWorkItemStatus, mapTaskStatusToWorkItemStatus, upsertWorkItemFromSource } from "@/lib/work-items";
import { logError } from "@/lib/logger";

async function main() {
  const db = getDb();

  let taskCreated = 0;
  let taskUpdated = 0;
  let alertCreated = 0;
  let alertUpdated = 0;

  const tasks = await db.task.findMany({
    select: {
      id: true,
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
    const existing = await db.workItem.findUnique({
      where: {
        sourceType_sourceId: {
          sourceType: "Task",
          sourceId: task.id,
        },
      },
      select: { id: true },
    });

    await upsertWorkItemFromSource({
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
    const existing = await db.workItem.findUnique({
      where: {
        sourceType_sourceId: {
          sourceType: "Alert",
          sourceId: alert.id,
        },
      },
      select: { id: true },
    });

    await upsertWorkItemFromSource({
      sourceType: "Alert",
      sourceId: alert.id,
      workItemType: "ALERT",
      status: mapAlertStatusToWorkItemStatus(alert.status),
      severity: alert.severity,
      title: alert.title,
      description: alert.description,
      entityType: alert.entityType,
      entityId: alert.entityId,
      readAt: alert.readAt,
    });

    if (existing) alertUpdated++;
    else alertCreated++;
  }

  console.log(
    JSON.stringify(
      {
        tasks: {
          total: tasks.length,
          created: taskCreated,
          updated: taskUpdated,
        },
        alerts: {
          total: alerts.length,
          created: alertCreated,
          updated: alertUpdated,
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
