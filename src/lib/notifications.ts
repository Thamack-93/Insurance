import type { Prisma } from "@/generated/prisma/client";
import type { AlertSeverity } from "@/lib/domain-values";
import { resolveAlertEntityLink } from "@/lib/alert-links";
import { logError } from "@/lib/logger";
import { mapNotificationStatusToWorkItemStatus, upsertWorkItemFromSource } from "@/lib/work-items";
import { withTenantOrganization, type TenantTransactionClient } from "@/lib/tenant-dal";

export { notificationLink } from "@/lib/notifications-shared";

export type NotificationInput = {
  organizationId: string;
  type: string;
  title: string;
  body?: string | null;
  severity?: AlertSeverity;
  entityType?: string;
  entityId?: string;
};

export type NotificationRecord = {
  id: string;
  alertType: string;
  severity: string;
  title: string;
  description: string | null;
  entityType: string;
  entityId: string;
  status: "OPEN" | "DISMISSED" | "RESOLVED";
  readAt: Date | null;
  createdAt: Date;
};

export type NotificationFilter = {
  type?: string;
  read?: "read" | "unread" | "all";
};

/**
 * Create an in-app notification. Used by the risk engine and WorkItem creation
 * flows. Best-effort: failures are logged but not thrown so the originating
 * flow keeps working.
 */
export async function createNotification(input: NotificationInput, client?: TenantTransactionClient): Promise<NotificationRecord | null> {
  if (!client) return withTenantOrganization(input.organizationId, (tx) => createNotification(input, tx));
  const db = client;
  try {
    const entityType = input.entityType ?? "System";
    const entityId = input.entityId ?? "general";
    const alert = await db.alert.create({
      data: {
        organizationId: input.organizationId,
        alertType: input.type,
        severity: input.severity ?? "INFO",
        title: input.title,
        description: input.body ?? null,
        entityType,
        entityId,
        ...(await resolveAlertEntityLink(db, input.organizationId, entityType, entityId)),
      },
    });
    await upsertWorkItemFromSource({
      organizationId: input.organizationId,
      sourceType: "Notification",
      sourceId: alert.id,
      sourceAlertId: alert.id,
      workItemType: "NOTIFICATION",
      status: mapNotificationStatusToWorkItemStatus(alert.status),
      severity: alert.severity,
      title: alert.title,
      description: alert.description,
      entityType: alert.entityType,
      entityId: alert.entityId,
      readAt: alert.readAt,
      createdById: null,
      updatedById: null,
    }, db);
    return alert as NotificationRecord;
  } catch (error) {
    logError("notifications.createNotification", error, { type: input.type });
    return null;
  }
}

export async function getUnreadNotificationCount(organizationId: string): Promise<number> {
  try {
    return await withTenantOrganization(organizationId, (db) => db.alert.count({
      where: { organizationId, readAt: null, status: { not: "RESOLVED" } },
    }));
  } catch (error) {
    logError("notifications.getUnreadNotificationCount", error);
    return 0;
  }
}

export async function getUnreadNotifications(organizationId: string, limit = 10): Promise<NotificationRecord[]> {
  try {
    const rows = await withTenantOrganization(organizationId, (db) => db.alert.findMany({
      where: { organizationId, readAt: null, status: { not: "RESOLVED" } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    }));
    return rows as NotificationRecord[];
  } catch (error) {
    logError("notifications.getUnreadNotifications", error);
    return [];
  }
}

/**
 * Latest N notifications (read or unread) for the bell dropdown. Excludes
 * RESOLVED so dismissed/resolved noise stays out of the tray.
 */
export async function getRecentNotifications(limit: number, organizationId: string): Promise<NotificationRecord[]> {
  try {
    const rows = await withTenantOrganization(organizationId, (db) => db.alert.findMany({
      where: { organizationId, status: { not: "RESOLVED" } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    }));
    return rows as NotificationRecord[];
  } catch (error) {
    logError("notifications.getRecentNotifications", error);
    return [];
  }
}

export async function getAllNotifications({
  organizationId,
  filter = {},
  page = 1,
  pageSize = 25,
}: {
  organizationId: string;
  filter?: NotificationFilter;
  page?: number;
  pageSize?: number;
}): Promise<{ entries: NotificationRecord[]; total: number }> {
  const where: Prisma.AlertWhereInput = { organizationId };
  if (filter.type) where.alertType = filter.type;
  if (filter.read === "read") where.readAt = { not: null };
  else if (filter.read === "unread") where.readAt = null;

  const safePage = Math.max(1, page);
  const skip = (safePage - 1) * pageSize;

  try {
    const [entries, total] = await withTenantOrganization(organizationId, (db) => Promise.all([
      db.alert.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take: pageSize,
      }),
      db.alert.count({ where }),
    ]));
    return { entries: entries as NotificationRecord[], total };
  } catch (error) {
    logError("notifications.getAllNotifications", error);
    return { entries: [], total: 0 };
  }
}

export async function getNotificationTypes(organizationId: string): Promise<string[]> {
  try {
    const rows = await withTenantOrganization(organizationId, (db) => db.alert.findMany({
      where: { organizationId },
      distinct: ["alertType"],
      select: { alertType: true },
      orderBy: { alertType: "asc" },
    }));
    return rows.map((row) => row.alertType);
  } catch (error) {
    logError("notifications.getNotificationTypes", error);
    return [];
  }
}
