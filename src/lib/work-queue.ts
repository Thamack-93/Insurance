import type { Prisma, PrismaClient } from "@/generated/prisma/client";
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

type WorkQueueDb = PrismaClient | Prisma.TransactionClient;

const policyQueueSelect = {
  id: true,
  policyNumber: true,
  policyType: true,
  status: true,
  startDate: true,
  endDate: true,
  client: {
    select: {
      id: true,
      fullName: true,
    },
  },
  insurer: {
    select: {
      id: true,
      name: true,
    },
  },
} as const satisfies Prisma.PolicySelect;

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
    select: policyQueueSelect,
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

export function getRenewalPolicyId(item: Pick<WorkQueueItem, "sourceType" | "sourceId" | "entityType" | "entityId" | "policyId">) {
  if (item.policyId || item.sourceType?.toLowerCase() !== "renewal") return null;
  if (item.entityType?.toLowerCase() === "policy" && item.entityId) return item.entityId;

  for (const reference of [item.entityId, item.sourceId]) {
    const match = reference?.match(/^policy:([^:]+):renewal-workItem$/i);
    if (match?.[1]) return match[1];
  }

  return null;
}

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

  const items = await db.workItem.findMany({
    where,
    select: workQueueSelect,
    orderBy: buildOrderBy(filters),
    skip: filters.skip,
    take: filters.limit,
  });

  return resolveLegacyRenewalRelations(items, filters, db);
}

/**
 * Renewal reminders can be found in two persisted shapes: historical rows
 * keep the policy id in entityId, while current rows use the canonical
 * policy:<id>:renewal-workItem source reference. Resolve either shape for
 * display and navigation without mutating the historical record.
 */
async function resolveLegacyRenewalRelations(
  items: WorkQueueItem[],
  filters: WorkQueueFilters,
  db: WorkQueueDb,
) {
  const renewalPolicyIdsByWorkItem = new Map(
    items
      .map((item) => [item.id, getRenewalPolicyId(item)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
  );
  const renewalPolicyIds = [...new Set(renewalPolicyIdsByWorkItem.values())];

  if (!renewalPolicyIds.length) return items;

  const policies = await db.policy.findMany({
    where: {
      id: { in: renewalPolicyIds },
      ...(filters.portfolioOwnerId ? { client: { portfolioOwnerId: filters.portfolioOwnerId } } : {}),
    },
    select: policyQueueSelect,
  });
  const policyById = new Map(policies.map((policy) => [policy.id, policy]));

  return items.map((item) => {
    const policy = item.policy ?? policyById.get(renewalPolicyIdsByWorkItem.get(item.id) ?? "");
    if (!policy) return item;

    return {
      ...item,
      client: item.client ?? policy.client ?? null,
      insurer: item.insurer ?? policy.insurer ?? null,
      policyId: item.policyId ?? policy.id,
      clientId: item.clientId ?? policy.client?.id ?? null,
      insurerId: item.insurerId ?? policy.insurer?.id ?? null,
      policy,
    };
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
