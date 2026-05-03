"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { getCurrentUserId } from "@/lib/auth";
import { notify } from "@/lib/notifications";
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
    const userId = await getCurrentUserId();
    const payload = await normalizeTaskInput(parsed.data);
    const task = await db.task.create({ data: { ...payload, createdById: userId, updatedById: userId } });

    await writeActivityLog({
      entityType: "Task",
      entityId: task.id,
      action: "TASK_CREATE",
      newValue: task,
    });

    if (task.priority === "HIGH" || task.priority === "URGENT") {
      await notify({
        type: "TASK_HIGH_PRIORITY",
        severity: task.priority === "URGENT" ? "CRITICAL" : "WARNING",
        title: `Pendiente ${task.priority === "URGENT" ? "urgente" : "alta prioridad"}: ${task.title}`,
        body: task.description ?? null,
        entityType: "Task",
        entityId: task.id,
      });
    }

    revalidatePaths([
      "/tasks",
      "/today",
      "/dashboard",
      "/renewals",
      "/due-payments",
      task.clientId ? `/clients/${task.clientId}` : "/clients",
      task.policyId ? `/policies/${task.policyId}` : "/policies",
      "/risks",
      "/notifications",
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

    const userId = await getCurrentUserId();
    const payload = await normalizeTaskInput(parsed.data, previousTask.folio);
    const task = await db.task.update({
      where: { id },
      data: { ...payload, updatedById: userId },
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

export async function bulkUpdateTaskStatus(ids: string[], status: string): Promise<MutationResult> {
  if (!ids.length) return errorResult("No hay pendientes seleccionados.");
  if (!isAllowedStatus(status)) {
    return errorResult("Estado no válido.");
  }
  const db = getDb();
  try {
    await db.task.updateMany({
      where: { id: { in: ids } },
      data: {
        status,
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
  if (!isAllowedPriority(priority)) {
    return errorResult("Prioridad no válida.");
  }
  const db = getDb();
  try {
    await db.task.updateMany({
      where: { id: { in: ids } },
      data: { priority },
    });
    revalidatePaths(["/tasks", "/today", "/dashboard"]);
    return successResult("bulk", "", `${ids.length} pendiente${ids.length !== 1 ? "s" : ""} con nueva prioridad.`);
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo actualizar la prioridad.");
  }
}

export async function bulkDeleteTasks(ids: string[]): Promise<MutationResult> {
  if (!ids.length) return errorResult("No hay pendientes seleccionados.");
  const db = getDb();
  try {
    const targets = await db.task.findMany({
      where: { id: { in: ids } },
      select: { id: true, folio: true, title: true, clientId: true, policyId: true },
    });

    if (targets.length === 0) {
      return errorResult("Los pendientes ya no existen.");
    }

    await db.task.deleteMany({ where: { id: { in: targets.map((t) => t.id) } } });

    await Promise.all(
      targets.map((task) =>
        writeActivityLog({
          entityType: "Task",
          entityId: task.id,
          action: "TASK_DELETE",
          oldValue: task,
        })
      )
    );

    revalidatePaths(["/tasks", "/today", "/dashboard", "/risks"]);
    return successResult(
      "bulk",
      "",
      `${targets.length} pendiente${targets.length !== 1 ? "s" : ""} eliminado${targets.length !== 1 ? "s" : ""}.`
    );
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudieron eliminar los pendientes.");
  }
}
export async function deleteTask(id: string): Promise<MutationResult> {
  try {
    const db = getDb();

    const existingTask = await db.task.findUnique({ where: { id } });

    if (!existingTask) {
      return errorResult("El pendiente ya no existe.");
    }

    await db.task.delete({ where: { id } });

    await writeActivityLog({
      entityType: "Task",
      entityId: id,
      action: "TASK_DELETE",
      oldValue: existingTask,
    });

    revalidatePaths([
      "/tasks",
      "/today",
      "/dashboard",
      "/risks",
      existingTask.clientId ? `/clients/${existingTask.clientId}` : "/clients",
      existingTask.policyId ? `/policies/${existingTask.policyId}` : "/policies",
    ]);

    return successResult(id, "/tasks", "Pendiente eliminado.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo eliminar el pendiente.");
  }
}
