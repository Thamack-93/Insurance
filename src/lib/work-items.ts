import type {
  AlertSeverity,
  Priority,
  Prisma,
  PrismaClient,
  TaskType,
  WorkItemStatus,
  WorkItemType,
} from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";

export type WorkItemSourceType = "Task" | "Alert" | "Reminder";

export type WorkItemSyncInput = {
  sourceType: WorkItemSourceType;
  sourceId: string;
  workItemType: WorkItemType;
  taskType?: TaskType | null;
  status: WorkItemStatus;
  priority?: Priority | null;
  severity?: AlertSeverity | null;
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

function normalizeNullablePriority(value?: Priority | null) {
  return value ?? null;
}

function normalizeNullableSeverity(value?: AlertSeverity | null) {
  return value ?? null;
}

export async function upsertWorkItemFromSource(input: WorkItemSyncInput, client?: WorkItemDb) {
  const db = client ?? getDb();

  const createData: Prisma.WorkItemUncheckedCreateInput = {
    sourceType: input.sourceType,
    sourceId: input.sourceId,
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
        sourceType_sourceId: {
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

export async function deleteWorkItemBySource(sourceType: WorkItemSourceType, sourceId: string, client?: WorkItemDb) {
  const db = client ?? getDb();

  try {
    await db.workItem.delete({
      where: {
        sourceType_sourceId: {
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

export function mapAlertStatusToWorkItemStatus(status: string): WorkItemStatus {
  switch (status) {
    case "OPEN":
    case "DISMISSED":
    case "RESOLVED":
      return status as WorkItemStatus;
    default:
      return "OPEN";
  }
}
