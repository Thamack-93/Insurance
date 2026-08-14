import type { Prisma } from "@/generated/prisma/client";
import type { AlertSeverity } from "@/lib/domain-values";
import { resolveAlertEntityLink } from "@/lib/alert-links";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";
import { getOrganizationIdForUser } from "@/lib/portfolio-access";
import { getCurrentUserId } from "@/lib/auth";
import { mapNotificationStatusToWorkItemStatus, upsertWorkItemFromSource } from "@/lib/work-items";

export { notificationLink } from "@/lib/notifications-shared";

export type NotificationInput = {
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
export async function createNotification(input: NotificationInput): Promise<NotificationRecord | null> {
  const db = getDb();
  try {
    const entityType = input.entityType ?? "System";
    const entityId = input.entityId ?? "general";
    const alert = await db.alert.create({
      data: {
        alertType: input.type,
        severity: input.severity ?? "INFO",
        title: input.title,
        description: input.body ?? null,
        entityType,
        entityId,
        ...(await resolveAlertEntityLink(db, entityType, entityId)),
      },
    });
    await upsertWorkItemFromSource({
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
    });
    return alert as NotificationRecord;
  } catch (error) {
    logError("notifications.createNotification", error, { type: input.type });
    return null;
  }
}

export async function getUnreadNotificationCount(): Promise<number> {
  const db = getDb();
  try {
    const organizationId = await getOrganizationIdForCurrentUser();
    return await db.alert.count({
      where: { readAt: null, status: { not: "RESOLVED" }, ...(organizationId ? { organizationId } : {}) },
    });
  } catch (error) {
    logError("notifications.getUnreadNotificationCount", error);
    return 0;
  }
}

export async function getUnreadNotifications(limit = 10): Promise<NotificationRecord[]> {
  const db = getDb();
  try {
    const organizationId = await getOrganizationIdForCurrentUser();
    const rows = await db.alert.findMany({
      where: { readAt: null, status: { not: "RESOLVED" }, ...(organizationId ? { organizationId } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
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
export async function getRecentNotifications(limit = 10): Promise<NotificationRecord[]> {
  const db = getDb();
  try {
    const organizationId = await getOrganizationIdForCurrentUser();
    const rows = await db.alert.findMany({
      where: { status: { not: "RESOLVED" }, ...(organizationId ? { organizationId } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return rows as NotificationRecord[];
  } catch (error) {
    logError("notifications.getRecentNotifications", error);
    return [];
  }
}

export async function getAllNotifications({
  filter = {},
  page = 1,
  pageSize = 25,
}: {
  filter?: NotificationFilter;
  page?: number;
  pageSize?: number;
}): Promise<{ entries: NotificationRecord[]; total: number }> {
  const db = getDb();
  const where: Prisma.AlertWhereInput = {};
  if (filter.type) where.alertType = filter.type;
  if (filter.read === "read") where.readAt = { not: null };
  else if (filter.read === "unread") where.readAt = null;

  const safePage = Math.max(1, page);
  const skip = (safePage - 1) * pageSize;

  try {
    const organizationId = await getOrganizationIdForCurrentUser();
    if (organizationId) where.organizationId = organizationId;
    const [entries, total] = await Promise.all([
      db.alert.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take: pageSize,
      }),
      db.alert.count({ where }),
    ]);
    return { entries: entries as NotificationRecord[], total };
  } catch (error) {
    logError("notifications.getAllNotifications", error);
    return { entries: [], total: 0 };
  }
}

export async function getNotificationTypes(): Promise<string[]> {
  const db = getDb();
  try {
    const organizationId = await getOrganizationIdForCurrentUser();
    const rows = await db.alert.findMany({
      where: organizationId ? { organizationId } : undefined,
      distinct: ["alertType"],
      select: { alertType: true },
      orderBy: { alertType: "asc" },
    });
    return rows.map((row) => row.alertType);
  } catch (error) {
    logError("notifications.getNotificationTypes", error);
    return [];
  }
}

async function getOrganizationIdForCurrentUser(): Promise<string | null> {
  try {
    return await getOrganizationIdForUser(await getCurrentUserId());
  } catch {
    return null;
  }
}
