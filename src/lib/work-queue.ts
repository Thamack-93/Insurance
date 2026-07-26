import type { Prisma } from "@/generated/prisma/client";
import type { Priority, WorkItemStatus, WorkItemType } from "@/lib/domain-values";
import { getDb } from "@/lib/db";
import { businessEndOfDay, businessStartOfDay } from "@/lib/business-dates";

export const OPEN_WORK_ITEM_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_CLIENT",
  "WAITING_INSURER",
  "WAITING_DOCUMENT",
  "SENT",
] as const satisfies readonly WorkItemStatus[];

export const CLOSED_WORK_ITEM_STATUSES = [
  "RESOLVED",
  "CANCELLED",
  "ARCHIVED",
  "DISMISSED",
] as const satisfies readonly WorkItemStatus[];

export const workQueueSelect = {
  id: true,
  sourceType: true,
  sourceId: true,
  workItemType: true,
  taskType: true,
  status: true,
  priority: true,
  severity: true,
  folio: true,
  title: true,
  description: true,
  entityType: true,
  entityId: true,
  clientId: true,
  policyId: true,
  insurerId: true,
  receiptId: true,
  startDate: true,
  dueDate: true,
  closedDate: true,
  readAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  updatedById: true,
  client: {
    select: {
      id: true,
      fullName: true,
    },
  },
  policy: {
    select: {
      id: true,
      policyNumber: true,
      policyType: true,
      status: true,
      startDate: true,
      endDate: true,
    },
  },
  insurer: {
    select: {
      id: true,
      name: true,
    },
  },
  receipt: {
    select: {
      id: true,
      receiptNumber: true,
    },
  },
} as const satisfies Prisma.WorkItemSelect;

export type WorkQueueItem = Prisma.WorkItemGetPayload<{ select: typeof workQueueSelect }>;

export type WorkQueueFilters = {
  query?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  skip?: number;
  statuses?: readonly WorkItemStatus[];
  workItemTypes?: readonly WorkItemType[];
  sourceTypes?: readonly string[];
  priorities?: readonly Priority[];
  clientId?: string;
  policyId?: string;
  insurerId?: string;
  receiptId?: string;
  entityType?: string;
  portfolioOwnerId?: string;
};

export async function getWorkItems(filters: WorkQueueFilters = {}) {
  const db = getDb();
  const where = buildWhere(filters);

  return db.workItem.findMany({
    where,
    select: workQueueSelect,
    orderBy: buildOrderBy(filters),
    skip: filters.skip,
    take: filters.limit,
  });
}

export async function countWorkItems(filters: WorkQueueFilters = {}) {
  const db = getDb();
  const where = buildWhere(filters);
  return db.workItem.count({ where });
}

function buildWhere(filters: WorkQueueFilters): Prisma.WorkItemWhereInput {
  const where: Prisma.WorkItemWhereInput = {};

  if (filters.query) {
    const query = filters.query.trim();
    if (query) {
      where.OR = [
        { folio: { contains: query } },
        { title: { contains: query } },
        { description: { contains: query } },
        { entityType: { contains: query } },
        { client: { fullName: { contains: query } } },
        { policy: { policyNumber: { contains: query } } },
        { insurer: { name: { contains: query } } },
        { receipt: { receiptNumber: { contains: query } } },
      ];
    }
  }

  if (filters.statuses?.length) {
    where.status = { in: [...filters.statuses] };
  }

  if (filters.workItemTypes?.length) {
    where.workItemType = { in: [...filters.workItemTypes] };
  }

  if (filters.sourceTypes?.length) {
    where.sourceType = { in: [...filters.sourceTypes] };
  }

  if (filters.priorities?.length) {
    where.priority = { in: [...filters.priorities] };
  }

  if (filters.clientId) {
    where.clientId = filters.clientId;
  }

  if (filters.policyId) {
    where.policyId = filters.policyId;
  }

  if (filters.insurerId) {
    where.insurerId = filters.insurerId;
  }

  if (filters.receiptId) {
    where.receiptId = filters.receiptId;
  }

  if (filters.entityType) {
    where.entityType = filters.entityType;
  }

  if (filters.portfolioOwnerId) {
    const portfolioWhere: Prisma.WorkItemWhereInput = {
      OR: [
        { client: { portfolioOwnerId: filters.portfolioOwnerId } },
        { clientId: null, assignedToId: filters.portfolioOwnerId },
      ],
    };
    where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), portfolioWhere];
  }

  if (filters.from || filters.to) {
    where.dueDate = {
      ...(filters.from ? { gte: businessStartOfDay(filters.from) } : {}),
      ...(filters.to ? { lte: businessEndOfDay(filters.to) } : {}),
    };
  }

  return where;
}

function buildOrderBy(filters: WorkQueueFilters): Prisma.WorkItemOrderByWithRelationInput[] {
  if (filters.query) {
    return [{ priority: "desc" }, { dueDate: "asc" }, { createdAt: "desc" }];
  }

  return [{ priority: "desc" }, { dueDate: "asc" }, { createdAt: "desc" }];
}
