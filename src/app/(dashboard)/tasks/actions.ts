"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { normalizeOptionalText, optionalRelationId, parseDateInput } from "@/lib/form-utils";
import { taskSchema, type TaskFormValues } from "@/lib/validations";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";

async function normalizeTaskRelations(values: TaskFormValues) {
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

async function normalizeTaskInput(values: TaskFormValues, existingFolio?: string) {
  const relations = await normalizeTaskRelations(values);

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

export async function createTask(values: TaskFormValues): Promise<MutationResult> {
  const parsed = taskSchema.safeParse(values);

  if (!parsed.success) {
    return errorResult(parsed.error.issues[0]?.message ?? "No se pudo validar el pendiente.");
  }

  try {
    const db = getDb();
    const payload = await normalizeTaskInput(parsed.data);
    const task = await db.task.create({ data: payload });

    await writeActivityLog({
      entityType: "Task",
      entityId: task.id,
      action: "TASK_CREATE",
      newValue: task,
    });

    revalidatePaths([
      "/tasks",
      "/today",
      "/dashboard",
      "/renewals",
      "/due-payments",
      task.clientId ? `/clients/${task.clientId}` : "/clients",
      task.policyId ? `/policies/${task.policyId}` : "/policies",
      "/risks",
    ]);

    return successResult(task.id, "/tasks", "Pendiente creado.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo crear el pendiente.");
  }
}

export async function updateTask(id: string, values: TaskFormValues): Promise<MutationResult> {
  const parsed = taskSchema.safeParse(values);

  if (!parsed.success) {
    return errorResult(parsed.error.issues[0]?.message ?? "No se pudo validar el pendiente.");
  }

  try {
    const db = getDb();
    const previousTask = await db.task.findUnique({ where: { id } });

    if (!previousTask) {
      return errorResult("El pendiente ya no existe.");
    }

    const payload = await normalizeTaskInput(parsed.data, previousTask.folio);
    const task = await db.task.update({
      where: { id },
      data: payload,
    });

    await writeActivityLog({
      entityType: "Task",
      entityId: task.id,
      action: "TASK_UPDATE",
      oldValue: previousTask,
      newValue: task,
    });

    revalidatePaths([
      "/tasks",
      "/today",
      "/dashboard",
      "/renewals",
      "/due-payments",
      task.clientId ? `/clients/${task.clientId}` : "/clients",
      task.policyId ? `/policies/${task.policyId}` : "/policies",
      "/risks",
    ]);

    return successResult(task.id, "/tasks", "Pendiente actualizado.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo actualizar el pendiente.");
  }
}

const ALLOWED_STATUSES = new Set([
  "OPEN",
  "IN_PROGRESS",
  "WAITING_CLIENT",
  "WAITING_INSURER",
  "WAITING_DOCUMENT",
  "SENT",
  "RESOLVED",
  "CANCELLED",
  "ARCHIVED",
]);

const ALLOWED_PRIORITIES = new Set(["LOW", "MEDIUM", "HIGH", "URGENT"]);

export async function bulkUpdateTaskStatus(ids: string[], status: string): Promise<MutationResult> {
  if (!ids.length) return errorResult("No hay pendientes seleccionados.");
  if (!ALLOWED_STATUSES.has(status)) {
    return errorResult("Estado no válido.");
  }
  const db = getDb();
  try {
    await db.task.updateMany({
      where: { id: { in: ids } },
      data: {
        status: status as any,
        closedDate: status === "RESOLVED" ? new Date() : null,
      },
    });
    revalidatePaths(["/tasks", "/today", "/dashboard"]);
    return successResult("bulk", "", `${ids.length} pendiente${ids.length !== 1 ? "s" : ""} actualizado${ids.length !== 1 ? "s" : ""}.`);
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo actualizar el estado.");
  }
}

export async function bulkUpdateTaskPriority(ids: string[], priority: string): Promise<MutationResult> {
  if (!ids.length) return errorResult("No hay pendientes seleccionados.");
  if (!ALLOWED_PRIORITIES.has(priority)) {
    return errorResult("Prioridad no válida.");
  }
  const db = getDb();
  try {
    await db.task.updateMany({
      where: { id: { in: ids } },
      data: { priority: priority as any },
    });
    revalidatePaths(["/tasks", "/today", "/dashboard"]);
    return successResult("bulk", "", `${ids.length} pendiente${ids.length !== 1 ? "s" : ""} con nueva prioridad.`);
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo actualizar la prioridad.");
  }
}