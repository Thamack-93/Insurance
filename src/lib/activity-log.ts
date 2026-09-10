import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getCurrentUserIdOrSystem } from "@/lib/auth";

const SENSITIVE_ACTIVITY_KEY = /(token|secret|password|authorization|cookie|session|webhook|apiKey|filename|document|content|email|phone|rfc|address|personal|body|text)/i;

function redactActivityValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactActivityValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      SENSITIVE_ACTIVITY_KEY.test(key) ? "[REDACTED]" : redactActivityValue(entry),
    ]));
  }
  if (typeof value === "string") {
    return value
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
      .replace(/\b(?:\+?\d[\d\s().-]{8,}\d)\b/g, "[REDACTED_PHONE]")
      .replace(/\b[^\s/\\]+\.(?:pdf|docx?|xlsx?|csv|png|jpe?g|webp)\b/gi, "[REDACTED_FILE]");
  }
  return value;
}

async function withTenantActivity<T>(organizationId: string, callback: (db: Prisma.TransactionClient) => Promise<T>) {
  // Lazy import avoids a runtime cycle: organization-context records activity
  // while opening a tenant transaction, so activity-log must not eagerly load
  // the tenant bridge during module initialization.
  const { withTenantOrganization } = await import("@/lib/tenant-dal");
  return withTenantOrganization(organizationId, callback);
}

export function safeJson(value: unknown, maxLength = 5000) {
  const text =
    typeof value === "string" ? redactActivityValue(value) as string : JSON.stringify(redactActivityValue(value), null, 2) ?? String(value);

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

const transactionRegistryGlobal = globalThis as typeof globalThis & {
  __policydeskTenantTransactions?: WeakSet<object>;
};

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
  organizationId: string;
  db?: PrismaClient | Prisma.TransactionClient;
}) {
  const resolvedUserId = userId ?? (await getCurrentUserIdOrSystem());
  const create = (db: Prisma.TransactionClient) => db.activityLog.create({
    data: {
      entityType,
      entityId,
      action,
      oldValue: oldValue === undefined ? null : safeJson(oldValue),
      newValue: newValue === undefined ? null : safeJson(newValue),
      userId: resolvedUserId,
      organizationId,
    },
  });
  // A root Prisma client is never a valid tenant writer. Older callers may
  // still pass it while they are being migrated; route those calls through a
  // fresh, membership-validated tenant transaction instead of allowing a
  // context-free ActivityLog insert during forced RLS.
  if (client && (
    (typeof client === "object" && client !== null && transactionRegistryGlobal.__policydeskTenantTransactions?.has(client))
    || !("$transaction" in client)
  )) return create(client as Prisma.TransactionClient);
  return withTenantActivity(organizationId, create);
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
  limit: number,
  organizationId: string,
  client?: Prisma.TransactionClient,
): Promise<ActivityEntry[]> {
  if (client) return client.activityLog.findMany({
    where: { entityType, entityId, organizationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return withTenantActivity(organizationId, (db) => db.activityLog.findMany({
    where: { entityType, entityId, organizationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  }));
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
  organizationId,
  filter = {},
  page = 1,
  pageSize = 25,
  client,
}: {
  organizationId: string;
  filter?: ActivityFilter;
  page?: number;
  pageSize?: number;
  client?: Prisma.TransactionClient;
}): Promise<{ entries: ActivityEntry[]; total: number }> {
  if (client) {
    const where: Prisma.ActivityLogWhereInput = { organizationId };
    if (filter.entityType) where.entityType = filter.entityType;
    if (filter.entityId) where.entityId = filter.entityId;
    if (filter.actionStartsWith) where.action = { startsWith: filter.actionStartsWith };
    else if (filter.action) where.action = { contains: filter.action };
    if (filter.from || filter.to) where.createdAt = { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) };
    const safePage = Math.max(1, page);
    const skip = (safePage - 1) * pageSize;
    const [entries, total] = await Promise.all([
      client.activityLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: pageSize, skip }),
      client.activityLog.count({ where }),
    ]);
    return { entries, total };
  }
  return withTenantActivity(organizationId, async (db) => {
    const where: Prisma.ActivityLogWhereInput = { organizationId };
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
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: pageSize,
        skip,
      }),
      db.activityLog.count({ where }),
    ]);

    return { entries, total };
  });
}
