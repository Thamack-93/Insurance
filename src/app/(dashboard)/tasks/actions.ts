"use server";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { createNotification } from "@/lib/notifications";
import { normalizeOptionalText, optionalRelationId, parseDateInput } from "@/lib/form-utils";
import { mapTaskStatusToWorkItemStatus } from "@/lib/work-items";
import { findWorkItemByRouteId } from "@/lib/work-item-resolvers";
import { workItemSchema, type WorkItemFormValues } from "@/lib/validations";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";
import { requireOrganizationContext, assertOrganizationContextInTransaction, type OrganizationContext } from "@/lib/organization-context";
import {
  workItemPortfolioWhere,
} from "@/lib/portfolio-access";

async function normalizeWorkItemRelations(values: WorkItemFormValues, context: OrganizationContext) {
  const db = getDb();
  const receiptId = optionalRelationId(values.receiptId);
  const policyId = optionalRelationId(values.policyId);
  const clientId = optionalRelationId(values.clientId);
  const insurerId = optionalRelationId(values.insurerId);

  if (receiptId) {
    const receipt = await db.receipt.findFirst({
      where: { id: receiptId, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { client: { portfolioOwnerId: context.userId } } : {}) },
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
    const policy = await db.policy.findFirst({
      where: { id: policyId, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { client: { portfolioOwnerId: context.userId } } : {}) },
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

  if (clientId) {
    const client = await db.client.findFirst({
      where: { id: clientId, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { portfolioOwnerId: context.userId } : {}) },
      select: { id: true },
    });
    if (!client) throw new Error("El cliente seleccionado ya no existe.");
  }

  if (insurerId) {
    const insurer = await db.insurer.findFirst({ where: { id: insurerId, organizationId: context.organizationId }, select: { id: true } });
    if (!insurer) throw new Error("La aseguradora seleccionada ya no existe.");
  }

  return {
    receiptId: null,
    policyId: null,
    clientId,
    insurerId,
  };
}

async function normalizeWorkItemInput(values: WorkItemFormValues, context: OrganizationContext, existingFolio?: string) {
  const relations = await normalizeWorkItemRelations(values, context);

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

function buildWorkItemBulkWhere(context: OrganizationContext, ids: string[]): Prisma.WorkItemWhereInput {
  return {
    organizationId: context.organizationId,
    workItemType: "TASK",
    AND: [
      ...(context.membershipRole === "AGENT" ? [workItemPortfolioWhere(context.userId)] : []),
      {
        OR: [{ sourceType: "Task", sourceId: { in: ids } }, { id: { in: ids } }],
      },
    ],
  };
}

export async function createWorkItem(values: WorkItemFormValues): Promise<MutationResult> {
  const parsed = workItemSchema.safeParse(values);

  if (!parsed.success) {
    return errorResult(parsed.error.issues[0]?.message ?? "No se pudo validar el pendiente.");
  }

  try {
    const db = getDb();
    const context = await requireOrganizationContext();
    const userId = context.userId;
    const payload = await normalizeWorkItemInput(parsed.data, context);
    const workItemId = randomUUID();
    const workItem = await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const createdWorkItem = await tx.workItem.create({
        data: {
          organizationId: context.organizationId,
          id: workItemId,
          sourceType: "WorkItem",
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
          assignedToId: userId,
        },
      });
      const workItemRouteId = createdWorkItem.sourceId ?? createdWorkItem.id;
      await writeActivityLog({
        organizationId: context.organizationId,
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
      await createNotification({
        organizationId: context.organizationId,
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
    const context = await requireOrganizationContext();
    const userId = context.userId;
    const previousWorkItem = await findWorkItemByRouteId(id, context.organizationId, undefined, context.membershipRole === "AGENT" ? userId : undefined);

    if (!previousWorkItem) {
      return errorResult("El pendiente ya no existe o no pertenece a tu cartera.");
    }
    const payload = await normalizeWorkItemInput(parsed.data, context, previousWorkItem.folio ?? undefined);
    const workItem = await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      await tx.workItem.updateMany({
        where: { id: previousWorkItem.id, organizationId: context.organizationId },
        data: {
          sourceType: previousWorkItem.sourceType === "Task" ? "WorkItem" : previousWorkItem.sourceType ?? "WorkItem",
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
      const updatedWorkItem = await tx.workItem.findFirstOrThrow({ where: { id: previousWorkItem.id, organizationId: context.organizationId } });
      const workItemRouteId = updatedWorkItem.sourceId ?? updatedWorkItem.id;
      await writeActivityLog({
        entityType: "WorkItem",
        organizationId: context.organizationId,
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
    const context = await requireOrganizationContext();
    await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      await tx.workItem.updateMany({
        where: buildWorkItemBulkWhere(context, ids),
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
    const context = await requireOrganizationContext();
    await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      await tx.workItem.updateMany({
        where: buildWorkItemBulkWhere(context, ids),
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
    const context = await requireOrganizationContext();
    const workItems = await db.workItem.findMany({
      where: buildWorkItemBulkWhere(context, ids),
      select: { id: true, sourceId: true, folio: true, title: true, clientId: true, policyId: true },
    });

    if (workItems.length === 0) {
      return errorResult("Los pendientes ya no existen.");
    }

    await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      await tx.workItem.deleteMany({ where: { organizationId: context.organizationId, id: { in: workItems.map((workItem) => workItem.id) } } });
      for (const workItem of workItems) {
        const workItemRouteId = workItem.sourceId ?? workItem.id;
        await writeActivityLog({
          entityType: "WorkItem",
          organizationId: context.organizationId,
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
    const context = await requireOrganizationContext();
    const existingWorkItem = await findWorkItemByRouteId(id, context.organizationId, undefined, context.membershipRole === "AGENT" ? context.userId : undefined);

    if (!existingWorkItem) {
      return errorResult("El pendiente ya no existe.");
    }

    await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      await tx.workItem.deleteMany({ where: { id: existingWorkItem.id, organizationId: context.organizationId } });

      await writeActivityLog({
        entityType: "WorkItem",
        organizationId: context.organizationId,
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
