"use server";

import { getDb } from "@/lib/db";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";
import { mapAlertStatusToWorkItemStatus, upsertWorkItemFromSource } from "@/lib/work-items";

export async function markAlertRead(id: string): Promise<MutationResult> {
  if (!id) return errorResult("Notificación no encontrada.");
  try {
    const db = getDb();
    const existing = await db.alert.findUnique({ where: { id } });
    if (!existing) return errorResult("La notificación ya no existe.");
    if (!existing.readAt) {
      const alert = await db.alert.update({
        where: { id },
        data: { readAt: new Date(), status: "DISMISSED" },
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
      });
    }
    revalidatePaths(["/", "/notifications"]);
    return successResult(id, "/notifications", "Notificación marcada como leída.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo marcar como leída.");
  }
}

export async function markAllAlertsRead(): Promise<MutationResult> {
  try {
    const db = getDb();
    const now = new Date();
    const result = await db.alert.updateMany({
      where: { readAt: null },
      data: { readAt: now, status: "DISMISSED" },
    });
    await db.workItem.updateMany({
      where: { sourceType: "Alert" },
      data: { readAt: now, status: "DISMISSED" },
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
