import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Priority, WorkItemStatus, WorkItemType } from "@/lib/domain-values";
import { getDb } from "@/lib/db";
import { businessEndOfDay, businessStartOfDay } from "@/lib/business-dates";
import { shouldKeepRenewalWorkItemPolicy } from "@/lib/renewals.logic";
import { compareDateAsc, compareNaturalText, comparePriorityDesc } from "@/lib/sorting";

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

type RenewalReferenceInput = Pick<
  WorkQueueItem,
  "sourceType" | "sourceId" | "taskType" | "title" | "description" | "entityType" | "entityId" | "policyId"
>;

function normalizeSearchText(value: string | null | undefined) {
  return value?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() ?? "";
}

function isRenewalWorkItem(item: RenewalReferenceInput) {
  const sourceType = normalizeSearchText(item.sourceType);
  const taskType = normalizeSearchText(item.taskType);
  const text = normalizeSearchText(`${item.title ?? ""} ${item.description ?? ""}`);

  return sourceType === "renewal" || taskType === "renewal" || /\brenovacion\b/.test(text);
}

export function getRenewalPolicyId(item: RenewalReferenceInput) {
  if (item.policyId || !isRenewalWorkItem(item)) return null;
  if (item.entityType?.toLowerCase() === "policy" && item.entityId) return item.entityId;

  for (const reference of [item.entityId, item.sourceId]) {
    const canonicalMatch = reference?.match(/^policy:([^:]+):renewal-workItem$/i);
    if (canonicalMatch?.[1]) return canonicalMatch[1];

    const historicalMatch = reference?.match(/^([^:]+):\d{4}-\d{2}-\d{2}$/);
    if (historicalMatch?.[1]) return historicalMatch[1];
  }

  return null;
}

function getRenewalPolicyNumbers(item: RenewalReferenceInput) {
  if (!isRenewalWorkItem(item)) return [];

  const text = `${item.title ?? ""}\n${item.description ?? ""}`;
  const numbers = new Set<string>();
  const patterns = [
    /renovaci[oó]n(?:\s+de\s+p[oó]liza)?(?:\s+sin\s+avance)?\s*:\s*([A-Z0-9][A-Z0-9/_-]*)/giu,
    /p[oó]liza\s*:?\s*([A-Z0-9][A-Z0-9/_-]*)/giu,
    /n[uú]mero(?:\s+de\s+p[oó]liza)?\s*:\s*([A-Z0-9][A-Z0-9/_-]*)/giu,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const policyNumber = match[1]?.trim();
      if (policyNumber) numbers.add(policyNumber);
    }
  }

  return [...numbers];
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
  organizationId?: string;
};

export async function getWorkItems(filters: WorkQueueFilters = {}) {
  const db = getDb();
  const where = buildWhere(filters);

  const items = await db.workItem.findMany({
    where,
    select: workQueueSelect,
    orderBy: buildOrderBy(filters),
  });

  const resolvedItems = await resolveLegacyRenewalRelations(items, filters, db);
  resolvedItems.sort(compareWorkQueueItems);
  const start = filters.skip ?? 0;
  return filters.limit === undefined
    ? resolvedItems.slice(start)
    : resolvedItems.slice(start, start + filters.limit);
}

/**
 * Renewal reminders can be found in several persisted shapes: historical rows
 * keep the policy id in entityId or in a policy:<id>:date source reference,
 * current rows use policy:<id>:renewal-workItem, and some task-backed rows
 * only keep the policy number in their title or description. Resolve all of
 * them for display and navigation without mutating the historical record.
 */
async function resolveLegacyRenewalRelations(
  items: WorkQueueItem[],
  filters: WorkQueueFilters,
  db: WorkQueueDb,
) {
  const renewalReferencesByWorkItem = new Map(
    items.map((item) => [
      item.id,
      {
        policyId: getRenewalPolicyId(item),
        policyNumbers: getRenewalPolicyNumbers(item),
      },
    ] as const),
  );
  const renewalPolicyIds = [
    ...new Set(
      [...renewalReferencesByWorkItem.values()]
        .map((reference) => reference.policyId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const renewalPolicyNumbers = [
    ...new Set([...renewalReferencesByWorkItem.values()].flatMap((reference) => reference.policyNumbers)),
  ];

  if (!renewalPolicyIds.length && !renewalPolicyNumbers.length) return items;

  const policyOr: Prisma.PolicyWhereInput[] = [];
  if (renewalPolicyIds.length) policyOr.push({ id: { in: renewalPolicyIds } });
  if (renewalPolicyNumbers.length) policyOr.push({ policyNumber: { in: renewalPolicyNumbers } });

  const policies = await db.policy.findMany({
    where: {
      OR: policyOr,
      ...(filters.portfolioOwnerId ? { client: { portfolioOwnerId: filters.portfolioOwnerId } } : {}),
      ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
    },
    select: {
      ...policyQueueSelect,
      renewalStage: true,
      renewals: { select: { id: true }, take: 1 },
      sourceRenewalSuggestions: {
        where: { status: { in: ["ACCEPTED", "DECLINED"] } },
        select: { id: true },
        take: 1,
      },
      receipts: {
        orderBy: [
          { periodEndDate: "desc" },
          { dueDate: "desc" },
          { createdAt: "desc" },
        ],
        take: 1,
        select: { status: true },
      },
    },
  });
  const policyById = new Map(policies.map((policy) => [policy.id, policy]));
  const policiesByNumber = new Map<string, typeof policies>();
  for (const policy of policies) {
    const key = policy.policyNumber.toUpperCase();
    const matches = policiesByNumber.get(key) ?? [];
    matches.push(policy);
    policiesByNumber.set(key, matches);
  }

  const resolvedItems = items.map((item) => {
    const reference = renewalReferencesByWorkItem.get(item.id);
    const numberCandidates = reference?.policyNumbers.flatMap(
      (number) => policiesByNumber.get(number.toUpperCase()) ?? [],
    ) ?? [];
    const policy =
      item.policy ??
      policyById.get(reference?.policyId ?? "") ??
      (numberCandidates.length === 1 ? numberCandidates[0] : undefined);
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

  return resolvedItems.filter((item) => {
    if (!isRenewalWorkItem(item)) return true;

    const reference = renewalReferencesByWorkItem.get(item.id);
    const directPolicy = item.policy
      ? policyById.get(item.policy.id)
      : policyById.get(reference?.policyId ?? "");
    const numberCandidates = reference?.policyNumbers.flatMap(
      (number) => policiesByNumber.get(number.toUpperCase()) ?? [],
    ) ?? [];
    const candidates = directPolicy ? [directPolicy] : numberCandidates;
    if (!candidates.length) return true;

    return candidates.some((policy) => shouldKeepRenewalWorkItemPolicy({
      status: policy.status,
      renewalStage: policy.renewalStage,
      hasSuccessor: (policy.renewals ?? []).length > 0,
      hasDecision: (policy.sourceRenewalSuggestions ?? []).length > 0,
      latestReceiptStatus: policy.receipts?.[0]?.status,
    }));
  });
}

export async function countWorkItems(filters: WorkQueueFilters = {}) {
  return (await getWorkItems(filters)).length;
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

  if (filters.organizationId) {
    where.organizationId = filters.organizationId;
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
  // Priority is persisted as text, so ordering it in PostgreSQL would make
  // LOW sort ahead of HIGH. The semantic rank is applied after legacy
  // renewal relations are resolved; these fields keep the database read
  // bounded and deterministic before that final comparison.
  void filters;
  return [{ dueDate: "asc" }, { createdAt: "desc" }, { id: "asc" }];
}

function compareWorkQueueItems(left: WorkQueueItem, right: WorkQueueItem) {
  return (
    comparePriorityDesc(left.priority, right.priority) ||
    compareDateAsc(left.dueDate, right.dueDate) ||
    right.createdAt.getTime() - left.createdAt.getTime() ||
    compareNaturalText(left.client?.fullName ?? left.folio ?? left.id, right.client?.fullName ?? right.folio ?? right.id) ||
    left.id.localeCompare(right.id)
  );
}
