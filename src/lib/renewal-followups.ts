import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { SYSTEM_USER_ID } from "@/lib/auth";
import { logError } from "@/lib/logger";
import { createNotificationEvent } from "@/lib/notification-foundation";
import { renewalStageLabel } from "@/lib/status";
import { upsertWorkItemFromSource } from "@/lib/work-items";
import { OPEN_WORK_ITEM_STATUSES } from "@/lib/work-queue";
import { forEachRenewalCandidate, type RenewalBoardCard } from "@/lib/renewal-board";
import {
  buildRenewalFollowUpMessage,
  businessWeekKey,
  renewalFollowUpDedupeKey,
  renewalFollowUpWorkItemSourceId,
  RENEWAL_FOLLOWUP_SOURCE_SUFFIX,
} from "@/lib/renewal-board.logic";

/**
 * Recordatorios de seguimiento para las renovaciones estancadas.
 *
 * No hay un sistema de avisos nuevo: cada renovación sin avance deja un
 * pendiente en la cola de trabajo (el mismo WorkItem que ya usa Operación) y un
 * evento de notificación para el responsable de la cartera, que pasa por
 * `createNotificationEvent` y por tanto respeta el canal y las preferencias que
 * el usuario ya configuró. Si el usuario apagó el aviso, el evento queda como
 * SKIPPED y el pendiente sigue existiendo en la aplicación.
 *
 * Qué cuenta como estancada lo decide `getRenewalStallState`, la misma regla
 * que pinta el distintivo "Sin avance" en el tablero. El barrido, en cambio,
 * recorre todas las renovaciones vivas y no sólo las de la ventana que el
 * tablero muestra: una renovación vencida hace meses, o estancada con el
 * vencimiento lejos, es precisamente la que nadie va a ver por su cuenta.
 */

export type RenewalFollowUpSummary = {
  scanned: number;
  stalled: number;
  workItemsUpserted: number;
  workItemsClosed: number;
  notificationsCreated: number;
};

/**
 * Cierra el recordatorio de "sin avance" de una póliza, si lo hay.
 *
 * Un pendiente de seguimiento sólo tiene sentido mientras la renovación siga
 * parada: en cuanto avanza, se renueva o se cierra, dejarlo abierto convierte
 * la bandeja en ruido y el usuario deja de creerle.
 */
type DbClient = PrismaClient | Prisma.TransactionClient;

export async function closeRenewalFollowUp(
  organizationId: string,
  policyId: string,
  userId: string | null,
  client?: DbClient,
): Promise<boolean> {
  const db = client ?? getDb();
  const item = await db.workItem.findFirst({
    where: {
      organizationId,
      sourceType: "Renewal",
      sourceId: renewalFollowUpWorkItemSourceId(policyId),
      status: { in: [...OPEN_WORK_ITEM_STATUSES] },
    },
    select: { id: true },
  });

  if (!item) return false;

  await db.workItem.update({
    where: { id: item.id },
    data: { status: "RESOLVED", closedDate: new Date(), updatedById: userId },
  });

  return true;
}

function followUpPriority(card: RenewalBoardCard) {
  return card.priority;
}

export async function runRenewalFollowUpScan(
  organizationId: string,
  now: Date = new Date(),
): Promise<RenewalFollowUpSummary> {
  const summary: RenewalFollowUpSummary = {
    scanned: 0,
    stalled: 0,
    workItemsUpserted: 0,
    workItemsClosed: 0,
    notificationsCreated: 0,
  };

  try {
    const db = getDb();
    const weekKey = businessWeekKey(now);

    // Sin alcance de cartera y sin ventana de vencimiento: el job corre para
    // toda la casa y cada aviso se dirige al responsable de la póliza.
    const stalledPolicyIds: string[] = [];

    const { scanned } = await forEachRenewalCandidate(organizationId, async (card) => {
      if (!card.stall.stalled) return;
      summary.stalled += 1;
      stalledPolicyIds.push(card.policyId);

      const stageLabel = renewalStageLabel(card.stage);
      const message = buildRenewalFollowUpMessage({
        policyNumber: card.policyNumber,
        clientName: card.clientName,
        stageLabel,
        daysUntilRenewal: card.daysUntilRenewal,
        stall: card.stall,
      });

      const dedupeKey = renewalFollowUpDedupeKey(card.policyId, card.stage, weekKey);
      const alreadyNotified = await db.notificationEvent.findUnique({
        where: { organizationId_dedupeKey: { organizationId: card.organizationId, dedupeKey } },
        select: { id: true },
      });

      const sourceId = renewalFollowUpWorkItemSourceId(card.policyId);
      const workItem = await upsertWorkItemFromSource(
        {
          organizationId: card.organizationId,
          sourceType: "Renewal",
          sourceId,
          workItemType: "TASK",
          taskType: "RENEWAL",
          status: "OPEN",
          priority: followUpPriority(card),
          title: message.title,
          description: message.body,
          entityType: "Policy",
          entityId: card.policyId,
          clientId: card.clientId,
          policyId: card.policyId,
          insurerId: card.insurerId,
          dueDate: card.endDate,
          createdById: null,
          updatedById: null,
        },
        db,
      );

      if (workItem) summary.workItemsUpserted += 1;

      // El pendiente se refresca siempre; el aviso sólo suena una vez por
      // semana y por etapa, para no convertir el seguimiento en ruido diario.
      if (alreadyNotified || !card.ownerId) return;

      const event = await createNotificationEvent(
        {
          organizationId: card.organizationId,
          type: "RENEWAL_FOLLOWUP",
          title: message.title,
          body: message.body,
          priority: followUpPriority(card),
          userId: card.ownerId,
          clientId: card.clientId,
          policyId: card.policyId,
          workItemId: workItem?.id ?? null,
          dedupeKey,
        },
        db,
      );

      if (!event) return;

      summary.notificationsCreated += 1;
      await writeActivityLog({
        organizationId: card.organizationId,
        entityType: "Policy",
        entityId: card.policyId,
        action: "RENEWAL_FOLLOWUP_REMINDER",
        newValue: {
          stage: card.stage,
          daysUntilRenewal: card.daysUntilRenewal,
          reason: card.stall.reason,
          daysSinceLastMove: card.stall.daysSinceLastMove,
          notificationStatus: event.status,
        },
        userId: SYSTEM_USER_ID,
        db,
      });
    });

    summary.scanned = scanned;

    // Reconciliación: cualquier recordatorio que siga abierto y ya no
    // corresponda a una renovación estancada se cierra. Cubre las que
    // avanzaron, las que se renovaron y las que se cerraron como no renovadas,
    // que además ya salieron del barrido.
    // Sólo los pendientes que generó este barrido: los pendientes normales de
    // renovación tienen su propio ciclo de vida y no se tocan.
    const stale = await db.workItem.findMany({
      where: {
        organizationId,
        sourceType: "Renewal",
        sourceId: { endsWith: RENEWAL_FOLLOWUP_SOURCE_SUFFIX },
        status: { in: [...OPEN_WORK_ITEM_STATUSES] },
        policyId: { notIn: stalledPolicyIds.length > 0 ? stalledPolicyIds : ["-"] },
      },
      select: { id: true },
    });

    if (stale.length > 0) {
      const closed = await db.workItem.updateMany({
        where: { organizationId, id: { in: stale.map((item) => item.id) } },
        data: { status: "RESOLVED", closedDate: now },
      });
      summary.workItemsClosed = closed.count;
    }

    return summary;
  } catch (error) {
    logError("renewal-followups.runRenewalFollowUpScan", error);
    return summary;
  }
}
