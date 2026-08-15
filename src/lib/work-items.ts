import type {
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";
import type { WorkItemStatus } from "@/lib/domain-values";

export type WorkItemSourceType = "Task" | "WorkItem" | "Renewal" | "Notification";

export type WorkItemSyncInput = {
  organizationId: string;
  sourceType: WorkItemSourceType;
  sourceId: string;
  /**
   * Vínculo tipado hacia la alerta que el pendiente refleja. El par
   * sourceType/sourceId sigue siendo la identidad histórica; esta columna es la
   * que la base de datos protege con integridad referencial.
   */
  sourceAlertId?: string | null;
  workItemType: string;
  taskType?: string | null;
  status: WorkItemStatus;
  priority?: string | null;
  severity?: string | null;
  folio?: string | null;
  title: string;
  description?: string | null;
  entityType: string;
  entityId: string;
  clientId?: string | null;
  policyId?: string | null;
  insurerId?: string | null;
  receiptId?: string | null;
  startDate?: Date | null;
  dueDate?: Date | null;
  closedDate?: Date | null;
  readAt?: Date | null;
  notes?: string | null;
  createdById?: string | null;
  updatedById?: string | null;
};

type WorkItemDb = PrismaClient | Prisma.TransactionClient;

function normalizeNullableDate(value?: Date | null) {
  return value ?? null;
}

function normalizeNullableText(value?: string | null) {
  return value ?? null;
}

function normalizeNullablePriority(value?: string | null) {
  return value ?? null;
}

function normalizeNullableSeverity(value?: string | null) {
  return value ?? null;
}

export async function upsertWorkItemFromSource(input: WorkItemSyncInput, client?: WorkItemDb) {
  const db = client ?? getDb();

  const createData: Prisma.WorkItemUncheckedCreateInput = {
    organizationId: input.organizationId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceAlertId: normalizeNullableText(input.sourceAlertId),
    workItemType: input.workItemType,
    taskType: input.taskType ?? null,
    status: input.status,
    priority: normalizeNullablePriority(input.priority) ?? "MEDIUM",
    severity: normalizeNullableSeverity(input.severity),
    folio: normalizeNullableText(input.folio),
    title: input.title,
    description: normalizeNullableText(input.description),
    entityType: input.entityType,
    entityId: input.entityId,
    clientId: normalizeNullableText(input.clientId),
    policyId: normalizeNullableText(input.policyId),
    insurerId: normalizeNullableText(input.insurerId),
    receiptId: normalizeNullableText(input.receiptId),
    startDate: normalizeNullableDate(input.startDate) ?? new Date(),
    dueDate: normalizeNullableDate(input.dueDate),
    closedDate: normalizeNullableDate(input.closedDate),
    readAt: normalizeNullableDate(input.readAt),
    notes: normalizeNullableText(input.notes),
    createdById: normalizeNullableText(input.createdById),
    updatedById: normalizeNullableText(input.updatedById),
  };

  const updateData: Prisma.WorkItemUncheckedUpdateInput = {
    organizationId: input.organizationId,
    ...(input.sourceAlertId === undefined
      ? {}
      : { sourceAlertId: normalizeNullableText(input.sourceAlertId) }),
    workItemType: input.workItemType,
    ...(input.taskType === undefined ? {} : { taskType: input.taskType ?? null }),
    status: input.status,
    priority: normalizeNullablePriority(input.priority) ?? "MEDIUM",
    severity: normalizeNullableSeverity(input.severity),
    title: input.title,
    entityType: input.entityType,
    entityId: input.entityId,
    ...(input.folio === undefined ? {} : { folio: normalizeNullableText(input.folio) }),
    ...(input.description === undefined ? {} : { description: normalizeNullableText(input.description) }),
    ...(input.clientId === undefined ? {} : { clientId: normalizeNullableText(input.clientId) }),
    ...(input.policyId === undefined ? {} : { policyId: normalizeNullableText(input.policyId) }),
    ...(input.insurerId === undefined ? {} : { insurerId: normalizeNullableText(input.insurerId) }),
    ...(input.receiptId === undefined ? {} : { receiptId: normalizeNullableText(input.receiptId) }),
    ...(input.startDate == null ? {} : { startDate: input.startDate }),
    ...(input.dueDate == null ? {} : { dueDate: input.dueDate }),
    ...(input.closedDate == null ? {} : { closedDate: input.closedDate }),
    ...(input.readAt == null ? {} : { readAt: input.readAt }),
    ...(input.notes === undefined ? {} : { notes: normalizeNullableText(input.notes) }),
    ...(input.updatedById === undefined ? {} : { updatedById: normalizeNullableText(input.updatedById) }),
  };

  try {
    return await db.workItem.upsert({
      where: {
        organizationId_sourceType_sourceId: {
          organizationId: input.organizationId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
        },
      },
      create: createData,
      update: updateData,
    });
  } catch (error) {
    logError("work-items.upsertWorkItemFromSource", error, {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      entityType: input.entityType,
    });
    return null;
  }
}

export async function deleteWorkItemBySource(organizationId: string, sourceType: WorkItemSourceType, sourceId: string, client?: WorkItemDb) {
  const db = client ?? getDb();

  try {
    await db.workItem.delete({
      where: {
        organizationId_sourceType_sourceId: {
          organizationId,
          sourceType,
          sourceId,
        },
      },
    });
  } catch (error) {
    logError("work-items.deleteWorkItemBySource", error, { sourceType, sourceId });
  }
}

export function mapTaskStatusToWorkItemStatus(status: string): WorkItemStatus {
  switch (status) {
    case "OPEN":
    case "IN_PROGRESS":
    case "WAITING_CLIENT":
    case "WAITING_INSURER":
    case "WAITING_DOCUMENT":
    case "SENT":
    case "RESOLVED":
    case "CANCELLED":
    case "ARCHIVED":
    case "DISMISSED":
      return status as WorkItemStatus;
    default:
      return "OPEN";
  }
}

export function mapNotificationStatusToWorkItemStatus(status: string): WorkItemStatus {
  switch (status) {
    case "OPEN":
    case "DISMISSED":
    case "RESOLVED":
      return status as WorkItemStatus;
    default:
      return "OPEN";
  }
}
