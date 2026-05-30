import type { Prisma, AlertSeverity } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";
import { mapAlertStatusToWorkItemStatus, upsertWorkItemFromSource } from "@/lib/work-items";

export { alertLink } from "@/lib/notifications-shared";

export type NotifyInput = {
  type: string;
  title: string;
  body?: string | null;
  severity?: AlertSeverity;
  entityType?: string;
  entityId?: string;
};

export type AlertRecord = {
  id: string;
  alertType: string;
  severity: AlertSeverity;
  title: string;
  description: string | null;
  entityType: string;
  entityId: string;
  status: "OPEN" | "DISMISSED" | "RESOLVED";
  readAt: Date | null;
  createdAt: Date;
};

export type AlertFilter = {
  type?: string;
  read?: "read" | "unread" | "all";
};

/**
 * Create a notification (Alert). Used by the risk engine, renewals helper
 * and WorkItem creation flows. Best-effort: failures are logged but not thrown
 * so that the originating flow keeps working.
 */
export async function notify(input: NotifyInput): Promise<AlertRecord | null> {
  const db = getDb();
  try {
    const alert = await db.alert.create({
      data: {
        alertType: input.type,
        severity: input.severity ?? "INFO",
        title: input.title,
        description: input.body ?? null,
        entityType: input.entityType ?? "System",
        entityId: input.entityId ?? "general",
      },
    });
    await upsertWorkItemFromSource({
      sourceType: "Alert",
      sourceId: alert.id,
      workItemType: "ALERT",
      status: mapAlertStatusToWorkItemStatus(alert.status),
      severity: alert.severity,
      title: alert.title,
      description: alert.description,
      entityType: alert.entityType,
      entityId: alert.entityId,
      readAt: alert.readAt,
      createdById: null,
      updatedById: null,
    });
    return alert as AlertRecord;
  } catch (error) {
    logError("notifications.notify", error, { type: input.type });
    return null;
  }
}

export async function getUnreadAlertCount(): Promise<number> {
  const db = getDb();
  try {
    return await db.alert.count({
      where: { readAt: null, status: { not: "RESOLVED" } },
    });
  } catch (error) {
    logError("notifications.getUnreadAlertCount", error);
    return 0;
  }
}

export async function getUnreadAlerts(limit = 10): Promise<AlertRecord[]> {
  const db = getDb();
  try {
    const rows = await db.alert.findMany({
      where: { readAt: null, status: { not: "RESOLVED" } },
      orderBy: [{ createdAt: "desc" }],
      take: limit,
    });
    return rows as AlertRecord[];
  } catch (error) {
    logError("notifications.getUnreadAlerts", error);
    return [];
  }
}

/**
 * Latest N alerts (read or unread) for the bell dropdown. Excludes RESOLVED
 * so dismissed/resolved noise stays out of the tray.
 */
export async function getRecentAlerts(limit = 10): Promise<AlertRecord[]> {
  const db = getDb();
  try {
    const rows = await db.alert.findMany({
      where: { status: { not: "RESOLVED" } },
      orderBy: [{ createdAt: "desc" }],
      take: limit,
    });
    return rows as AlertRecord[];
  } catch (error) {
    logError("notifications.getRecentAlerts", error);
    return [];
  }
}

export async function getAllAlerts({
  filter = {},
  page = 1,
  pageSize = 25,
}: {
  filter?: AlertFilter;
  page?: number;
  pageSize?: number;
}): Promise<{ entries: AlertRecord[]; total: number }> {
  const db = getDb();
  const where: Prisma.AlertWhereInput = {};
  if (filter.type) where.alertType = filter.type;
  if (filter.read === "read") where.readAt = { not: null };
  else if (filter.read === "unread") where.readAt = null;

  const safePage = Math.max(1, page);
  const skip = (safePage - 1) * pageSize;

  try {
    const [entries, total] = await Promise.all([
      db.alert.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      db.alert.count({ where }),
    ]);
    return { entries: entries as AlertRecord[], total };
  } catch (error) {
    logError("notifications.getAllAlerts", error);
    return { entries: [], total: 0 };
  }
}

export async function getAlertTypes(): Promise<string[]> {
  const db = getDb();
  try {
    const rows = await db.alert.findMany({
      distinct: ["alertType"],
      select: { alertType: true },
      orderBy: { alertType: "asc" },
    });
    return rows.map((row) => row.alertType);
  } catch (error) {
    logError("notifications.getAlertTypes", error);
    return [];
  }
}
