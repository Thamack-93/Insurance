import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { getCurrentUserIdOrSystem } from "@/lib/auth";

export function safeJson(value: unknown, maxLength = 5000) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? String(value);

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export async function writeActivityLog({
  entityType,
  entityId,
  action,
  oldValue,
  newValue,
  userId,
  organizationId,
  db: client,
}: {
  entityType: string;
  entityId: string;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
  userId?: string;
  organizationId?: string | null;
  db?: PrismaClient | Prisma.TransactionClient;
}) {
  const db = client ?? getDb();
  const resolvedUserId = userId ?? (await getCurrentUserIdOrSystem());

  await db.activityLog.create({
    data: {
      entityType,
      entityId,
      action,
      oldValue: oldValue === undefined ? null : safeJson(oldValue),
      newValue: newValue === undefined ? null : safeJson(newValue),
      userId: resolvedUserId,
      ...(organizationId !== undefined ? { organizationId } : {}),
    },
  });
}

export type ActivityEntry = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  oldValue: string | null;
  newValue: string | null;
  userId: string;
  createdAt: Date;
};

export async function getActivityForEntity(
  entityType: string,
  entityId: string,
  limit = 20,
  organizationId?: string,
): Promise<ActivityEntry[]> {
  const db = getDb();
  return db.activityLog.findMany({
    where: { entityType, entityId, ...(organizationId ? { organizationId } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export type ActivityFilter = {
  entityType?: string;
  entityId?: string;
  action?: string;
  actionStartsWith?: string;
  from?: Date;
  to?: Date;
};

export async function getAllActivity({
  filter = {},
  page = 1,
  pageSize = 25,
}: {
  filter?: ActivityFilter;
  page?: number;
  pageSize?: number;
}): Promise<{ entries: ActivityEntry[]; total: number }> {
  const db = getDb();
  const where: Prisma.ActivityLogWhereInput = {};
  if (filter.entityType) where.entityType = filter.entityType;
  if (filter.entityId) where.entityId = filter.entityId;
  if (filter.actionStartsWith) {
    where.action = { startsWith: filter.actionStartsWith };
  } else if (filter.action) {
    where.action = { contains: filter.action };
  }
  if (filter.from || filter.to) {
    where.createdAt = {
      ...(filter.from ? { gte: filter.from } : {}),
      ...(filter.to ? { lte: filter.to } : {}),
    };
  }

  const safePage = Math.max(1, page);
  const skip = (safePage - 1) * pageSize;

  const [entries, total] = await Promise.all([
    db.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: pageSize,
      skip,
    }),
    db.activityLog.count({ where }),
  ]);

  return { entries, total };
}
