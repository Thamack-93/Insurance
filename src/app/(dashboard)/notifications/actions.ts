"use server";

import { getDb } from "@/lib/db";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";
import { mapNotificationStatusToWorkItemStatus, upsertWorkItemFromSource } from "@/lib/work-items";
import { requireOrganizationContext, assertOrganizationContextInTransaction } from "@/lib/organization-context";

export async function markNotificationRead(id: string): Promise<MutationResult> {
  if (!id) return errorResult("Notificación no encontrada.");
  try {
    const context = await requireOrganizationContext();
    const db = getDb();
    const changed = await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const existing = await tx.alert.findFirst({ where: { id, organizationId: context.organizationId } });
      if (!existing) return false;
      if (!existing.readAt) {
        const alert = await tx.alert.update({ where: { id }, data: { readAt: new Date(), status: "DISMISSED" } });
        await upsertWorkItemFromSource({
          organizationId: context.organizationId,
          sourceType: "Notification",
          sourceId: alert.id,
          workItemType: "NOTIFICATION",
          status: mapNotificationStatusToWorkItemStatus(alert.status),
          severity: alert.severity,
          title: alert.title,
          description: alert.description,
          entityType: alert.entityType,
          entityId: alert.entityId,
          readAt: alert.readAt,
        }, tx);
      }
      return true;
    });
    if (!changed) return errorResult("La notificación ya no existe.");
    revalidatePaths(["/", "/notifications"]);
    return successResult(id, "/notifications", "Notificación marcada como leída.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo marcar como leída.");
  }
}

export async function markAllNotificationsRead(): Promise<MutationResult> {
  try {
    const context = await requireOrganizationContext();
    const db = getDb();
    const now = new Date();
    const result = await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const alerts = await tx.alert.updateMany({
        where: { organizationId: context.organizationId, readAt: null },
        data: { readAt: now, status: "DISMISSED" },
      });
      await tx.workItem.updateMany({
        where: { organizationId: context.organizationId, sourceType: "Notification" },
        data: { readAt: now, status: "DISMISSED" },
      });
      return alerts;
    });
    revalidatePaths(["/", "/notifications"]);
    return successResult(
      "bulk",
      "/notifications",
      `${result.count} notificación${result.count === 1 ? "" : "es"} marcada${result.count === 1 ? "" : "s"} como leída${result.count === 1 ? "" : "s"}.`,
    );
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudieron marcar como leídas.");
  }
}
