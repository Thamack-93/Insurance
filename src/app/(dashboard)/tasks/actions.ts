"use server";

import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { getCurrentUserId } from "@/lib/auth";
import { notify } from "@/lib/notifications";
import { normalizeOptionalText, optionalRelationId, parseDateInput } from "@/lib/form-utils";
import { mapTaskStatusToWorkItemStatus } from "@/lib/work-items";
import { findWorkItemByRouteId } from "@/lib/work-item-resolvers";
import { workItemSchema, type WorkItemFormValues } from "@/lib/validations";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";

async function normalizeWorkItemRelations(values: WorkItemFormValues) {
  const db = getDb();
  const receiptId = optionalRelationId(values.receiptId);
  const policyId = optionalRelationId(values.policyId);
  const clientId = optionalRelationId(values.clientId);
  const insurerId = optionalRelationId(values.insurerId);

  if (receiptId) {
    const receipt = await db.receipt.findUnique({
      where: { id: receiptId },
      select: { id: true, policyId: true, clientId: true, insurerId: true },
    });

    if (!receipt) {
      throw new Error("El recibo seleccionado ya no existe.");
    }

    return {
      receiptId: receipt.id,
      policyId: receipt.policyId,
      clientId: receipt.clientId,
      insurerId: receipt.insurerId,
    };
  }

  if (policyId) {
    const policy = await db.policy.findUnique({
      where: { id: policyId },
      select: { id: true, clientId: true, insurerId: true },
    });

    if (!policy) {
      throw new Error("La poliza seleccionada ya no existe.");
    }

    return {
      receiptId: null,
      policyId: policy.id,
      clientId: policy.clientId,
      insurerId: policy.insurerId,
    };
  }

  return {
    receiptId: null,
    policyId: null,
    clientId,
    insurerId,
  };
}

async function normalizeWorkItemInput(values: WorkItemFormValues, existingFolio?: string) {
  const relations = await normalizeWorkItemRelations(values);

  return {
    folio: existingFolio ?? `PD-${new Date().getUTCFullYear()}-${String(Date.now()).slice(-6)}`,
    ...relations,
    title: values.title.trim(),
    description: normalizeOptionalText(values.description),
    taskType: values.taskType,
    status: values.status,
    priority: values.priority,
    startDate: parseDateInput(values.startDate),
    dueDate: values.dueDate ? parseDateInput(values.dueDate) : null,
    closedDate: values.status === "RESOLVED" ? new Date() : null,
    notes: normalizeOptionalText(values.notes),
  };
}

export async function createWorkItem(values: WorkItemFormValues): Promise<MutationResult> {
  const parsed = workItemSchema.safeParse(values);

  if (!parsed.success) {
    return errorResult(parsed.error.issues[0]?.message ?? "No se pudo validar el pendiente.");
  }

  try {
    const db = getDb();
    const userId = await getCurrentUserId();
    const payload = await normalizeWorkItemInput(parsed.data);
    const workItemId = randomUUID();
    const workItem = await db.$transaction(async (tx) => {
      const createdWorkItem = await tx.workItem.create({
        data: {
          id: workItemId,
          sourceType: "Task",
          sourceId: workItemId,
          workItemType: "TASK",
          taskType: payload.taskType,
          status: mapTaskStatusToWorkItemStatus(payload.status),
          priority: payload.priority,
          folio: payload.folio,
          title: payload.title,
          description: payload.description,
          entityType: "WorkItem",
          entityId: workItemId,
          clientId: payload.clientId,
          policyId: payload.policyId,
          insurerId: payload.insurerId,
          receiptId: payload.receiptId,
          startDate: payload.startDate,
          dueDate: payload.dueDate,
          closedDate: payload.closedDate,
          notes: payload.notes,
          createdById: userId,
          updatedById: userId,
        },
      });
      const workItemRouteId = createdWorkItem.sourceId ?? createdWorkItem.id;
      await writeActivityLog({
        entityType: "WorkItem",
        entityId: workItemRouteId,
        action: "TASK_CREATE",
        newValue: createdWorkItem,
        db: tx,
      });

      return createdWorkItem;
    });

    const workItemRouteId = workItem.sourceId ?? workItem.id;

    if (workItem.priority === "HIGH" || workItem.priority === "URGENT") {
      await notify({
        type: "TASK_HIGH_PRIORITY",
        severity: workItem.priority === "URGENT" ? "CRITICAL" : "WARNING",
        title: `Pendiente ${workItem.priority === "URGENT" ? "urgente" : "alta prioridad"}: ${workItem.title}`,
        body: workItem.description ?? null,
        entityType: "WorkItem",
        entityId: workItemRouteId,
      });
    }

    revalidatePaths([
      "/tasks",
      "/today",
      "/dashboard",
      "/renewals",
      "/due-payments",
      workItem.clientId ? `/clients/${workItem.clientId}` : "/clients",
      workItem.policyId ? `/policies/${workItem.policyId}` : "/policies",
      "/risks",
      "/notifications",
    ]);

    return successResult(workItemRouteId, "/tasks", "Pendiente creado.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo crear el pendiente.");
  }
}

export async function updateWorkItem(id: string, values: WorkItemFormValues): Promise<MutationResult> {
  const parsed = workItemSchema.safeParse(values);

  if (!parsed.success) {
    return errorResult(parsed.error.issues[0]?.message ?? "No se pudo validar el pendiente.");
  }

  try {
    const db = getDb();
    const previousWorkItem = await findWorkItemByRouteId(id);

    if (!previousWorkItem) {
      return errorResult("El pendiente ya no existe.");
    }

    const userId = await getCurrentUserId();
    const payload = await normalizeWorkItemInput(parsed.data, previousWorkItem.folio ?? undefined);
    const workItem = await db.$transaction(async (tx) => {
      const updatedWorkItem = await tx.workItem.update({
        where: { id: previousWorkItem.id },
        data: {
          sourceType: previousWorkItem.sourceType ?? "Task",
          sourceId: previousWorkItem.sourceId ?? previousWorkItem.id,
          workItemType: "TASK",
          taskType: payload.taskType,
          status: mapTaskStatusToWorkItemStatus(payload.status),
          priority: payload.priority,
          title: payload.title,
          entityType: "WorkItem",
          entityId: previousWorkItem.id,
          folio: payload.folio,
          description: payload.description,
          clientId: payload.clientId,
          policyId: payload.policyId,
          insurerId: payload.insurerId,
          receiptId: payload.receiptId,
          startDate: payload.startDate,
          dueDate: payload.dueDate,
          closedDate: payload.closedDate,
          notes: payload.notes,
          updatedById: userId,
        },
      });
      const workItemRouteId = updatedWorkItem.sourceId ?? updatedWorkItem.id;
      await writeActivityLog({
        entityType: "WorkItem",
        entityId: workItemRouteId,
        action: "TASK_UPDATE",
        oldValue: previousWorkItem,
        newValue: updatedWorkItem,
        db: tx,
      });

      return updatedWorkItem;
    });

    revalidatePaths([
      "/tasks",
      "/today",
      "/dashboard",
      "/renewals",
      "/due-payments",
      workItem.clientId ? `/clients/${workItem.clientId}` : "/clients",
      workItem.policyId ? `/policies/${workItem.policyId}` : "/policies",
      "/risks",
    ]);

    return successResult(workItem.sourceId ?? workItem.id, "/tasks", "Pendiente actualizado.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo actualizar el pendiente.");
  }
}

const ALLOWED_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_CLIENT",
  "WAITING_INSURER",
  "WAITING_DOCUMENT",
  "SENT",
  "RESOLVED",
  "CANCELLED",
  "ARCHIVED",
] as const;
type AllowedStatus = (typeof ALLOWED_STATUSES)[number];

const ALLOWED_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
type AllowedPriority = (typeof ALLOWED_PRIORITIES)[number];

function isAllowedStatus(value: string): value is AllowedStatus {
  return (ALLOWED_STATUSES as readonly string[]).includes(value);
}

function isAllowedPriority(value: string): value is AllowedPriority {
  return (ALLOWED_PRIORITIES as readonly string[]).includes(value);
}

export async function bulkUpdateWorkItemStatus(ids: string[], status: string): Promise<MutationResult> {
  if (!ids.length) return errorResult("No hay pendientes seleccionados.");
  if (!isAllowedStatus(status)) {
    return errorResult("Estado no válido.");
  }
  const db = getDb();
  try {
    await db.$transaction(async (tx) => {
      await tx.workItem.updateMany({
        where: {
          OR: [
            { sourceType: "Task", sourceId: { in: ids } },
            { id: { in: ids } },
          ],
          workItemType: "TASK",
        },
        data: {
          status: mapTaskStatusToWorkItemStatus(status),
          closedDate: status === "RESOLVED" ? new Date() : null,
        },
      });
    });
    revalidatePaths(["/tasks", "/today", "/dashboard"]);
    return successResult("bulk", "", `${ids.length} pendiente${ids.length !== 1 ? "s" : ""} actualizado${ids.length !== 1 ? "s" : ""}.`);
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo actualizar el estado.");
  }
}

export async function bulkUpdateWorkItemPriority(ids: string[], priority: string): Promise<MutationResult> {
  if (!ids.length) return errorResult("No hay pendientes seleccionados.");
  if (!isAllowedPriority(priority)) {
    return errorResult("Prioridad no válida.");
  }
  const db = getDb();
  try {
    await db.$transaction(async (tx) => {
      await tx.workItem.updateMany({
        where: {
          OR: [
            { sourceType: "Task", sourceId: { in: ids } },
            { id: { in: ids } },
          ],
          workItemType: "TASK",
        },
        data: { priority },
      });
    });
    revalidatePaths(["/tasks", "/today", "/dashboard"]);
    return successResult("bulk", "", `${ids.length} pendiente${ids.length !== 1 ? "s" : ""} con nueva prioridad.`);
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo actualizar la prioridad.");
  }
}

export async function bulkDeleteWorkItems(ids: string[]): Promise<MutationResult> {
  if (!ids.length) return errorResult("No hay pendientes seleccionados.");
  const db = getDb();
  try {
    const workItems = await db.workItem.findMany({
      where: {
        OR: [
          { sourceType: "Task", sourceId: { in: ids } },
          { id: { in: ids } },
        ],
        workItemType: "TASK",
      },
      select: { id: true, sourceId: true, folio: true, title: true, clientId: true, policyId: true },
    });

    if (workItems.length === 0) {
      return errorResult("Los pendientes ya no existen.");
    }

    await db.$transaction(async (tx) => {
      await tx.workItem.deleteMany({ where: { id: { in: workItems.map((workItem) => workItem.id) } } });
      for (const workItem of workItems) {
        const workItemRouteId = workItem.sourceId ?? workItem.id;
        await writeActivityLog({
          entityType: "WorkItem",
          entityId: workItemRouteId,
          action: "TASK_DELETE",
          oldValue: workItem,
          db: tx,
        });
      }
    });

    revalidatePaths(["/tasks", "/today", "/dashboard", "/risks"]);
    return successResult(
      "bulk",
      "",
      `${workItems.length} pendiente${workItems.length !== 1 ? "s" : ""} eliminado${workItems.length !== 1 ? "s" : ""}.`
    );
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudieron eliminar los pendientes.");
  }
}
export async function deleteWorkItem(id: string): Promise<MutationResult> {
  try {
    const db = getDb();

    const existingWorkItem = await findWorkItemByRouteId(id);

    if (!existingWorkItem) {
      return errorResult("El pendiente ya no existe.");
    }

    await db.$transaction(async (tx) => {
      await tx.workItem.delete({ where: { id: existingWorkItem.id } });

      await writeActivityLog({
        entityType: "WorkItem",
        entityId: existingWorkItem.id,
        action: "TASK_DELETE",
        oldValue: existingWorkItem,
        db: tx,
      });
    });

    revalidatePaths([
      "/tasks",
      "/today",
      "/dashboard",
      "/risks",
      existingWorkItem.clientId ? `/clients/${existingWorkItem.clientId}` : "/clients",
      existingWorkItem.policyId ? `/policies/${existingWorkItem.policyId}` : "/policies",
    ]);

    return successResult(existingWorkItem.sourceId ?? existingWorkItem.id, "/tasks", "Pendiente eliminado.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo eliminar el pendiente.");
  }
}
