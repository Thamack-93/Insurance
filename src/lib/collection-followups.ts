import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { assertOrganizationContextInTransaction, requireOrganizationContext, withSystemOrganizationTransaction, withTenantTransaction } from "@/lib/organization-context";
import { writeActivityLog } from "@/lib/activity-log";
import { upsertWorkItemFromSource } from "@/lib/work-items";
import { createNotificationEvent } from "@/lib/notification-foundation";
import { errorResult, successResult, type MutationResult } from "@/lib/mutation-utils";

export const COLLECTION_OUTCOMES = ["NO_ANSWER", "CONTACTED", "PROMISED_PAYMENT", "DISPUTED", "WRONG_CONTACT"] as const;
export type CollectionOutcome = (typeof COLLECTION_OUTCOMES)[number];

export type CollectionFollowUpInput = {
  receiptId: string;
  outcome: CollectionOutcome;
  notes?: string | null;
  promisedPaymentDate?: Date | null;
  nextContactDate?: Date | null;
  assignedToId?: string | null;
  expectedVersion?: number;
};

export class CollectionConflictError extends Error {
  constructor() {
    super("La ficha de cobranza cambió mientras la editabas. Recarga los datos antes de guardar.");
    this.name = "CollectionConflictError";
  }
}

export type CollectionFollowUpScanSummary = {
  scanned: number;
  due: number;
  brokenPromises: number;
  notificationsCreated: number;
};

function metadataFromWorkItem(item: { metadataJson: string | null } | null) {
  if (!item?.metadataJson) return {} as Record<string, unknown>;
  try {
    const value = JSON.parse(item.metadataJson);
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function recordCollectionFollowUp(input: CollectionFollowUpInput): Promise<MutationResult> {
  try {
    const context = await requireOrganizationContext();
    const result = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const receipt = await tx.receipt.findFirst({
        where: { id: input.receiptId, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { client: { portfolioOwnerId: context.userId } } : {}) },
        select: { id: true, receiptNumber: true, policyId: true, clientId: true, amount: true, currency: true },
      });
      if (!receipt) throw new Error("El recibo no existe o no pertenece a tu cartera.");

      const sourceId = `receipt:${receipt.id}:collection-followup`;
      const current = await tx.workItem.findFirst({ where: { organizationId: context.organizationId, sourceType: "Collection", sourceId }, select: { id: true, version: true, metadataJson: true } });
      if (input.expectedVersion !== undefined && current && current.version !== input.expectedVersion) throw new CollectionConflictError();

      if (input.outcome === "PROMISED_PAYMENT" && !input.promisedPaymentDate) throw new Error("Una promesa de pago requiere fecha.");
      if (input.outcome !== "PROMISED_PAYMENT" && !input.nextContactDate) throw new Error("Indica la próxima fecha de contacto.");
      if (input.assignedToId) {
        const assignee = await tx.user.findFirst({ where: { id: input.assignedToId, active: true, organizationMemberships: { some: { organizationId: context.organizationId, active: true } } }, select: { id: true } });
        if (!assignee) throw new Error("El responsable no pertenece a esta organización.");
      }

      const metadata = {
        ...metadataFromWorkItem(current),
        kind: "COLLECTION_FOLLOWUP",
        outcome: input.outcome,
        promisedPaymentDate: input.promisedPaymentDate?.toISOString() ?? null,
        nextContactDate: input.nextContactDate?.toISOString() ?? null,
        lastContactAt: new Date().toISOString(),
      };
      const workItem = await upsertWorkItemFromSource({
        organizationId: context.organizationId,
        sourceType: "Collection",
        sourceId,
        workItemType: "TASK",
        taskType: "PAYMENT",
        status: "OPEN",
        priority: input.outcome === "PROMISED_PAYMENT" ? "HIGH" : "MEDIUM",
        title: `Cobranza ${receipt.receiptNumber}`,
        description: input.notes ?? null,
        entityType: "RECEIPT",
        entityId: receipt.id,
        clientId: receipt.clientId,
        policyId: receipt.policyId,
        receiptId: receipt.id,
        dueDate: input.nextContactDate ?? input.promisedPaymentDate,
        assignedToId: input.assignedToId ?? context.userId,
        notes: input.notes ?? null,
        metadataJson: JSON.stringify(metadata),
        createdById: context.userId,
        updatedById: context.userId,
      }, tx);
      if (!workItem) throw new Error("No se pudo crear el seguimiento.");
      await writeActivityLog({ organizationId: context.organizationId, entityType: "Receipt", entityId: receipt.id, action: "COLLECTION_FOLLOWUP_RECORDED", oldValue: current ? { version: current.version } : null, newValue: { outcome: input.outcome, promisedPaymentDate: input.promisedPaymentDate, nextContactDate: input.nextContactDate, workItemId: workItem.id }, userId: context.userId, db: tx });
      return workItem;
    });
    return successResult(result.id, `/receipts/${input.receiptId}`, "Seguimiento de cobranza guardado.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo guardar el seguimiento.");
  }
}

export async function closeCollectionFollowUp(receiptId: string, client: Prisma.TransactionClient, reason: "PAYMENT" | "CANCELLED", userId: string, organizationId: string) {
  const sourceId = `receipt:${receiptId}:collection-followup`;
  const existing = await client.workItem.findFirst({ where: { organizationId, sourceType: "Collection", sourceId } });
  if (!existing || ["RESOLVED", "CANCELLED", "ARCHIVED", "DISMISSED"].includes(existing.status)) return;
  await client.workItem.update({ where: { id: existing.id }, data: { status: reason === "PAYMENT" ? "RESOLVED" : "CANCELLED", closedDate: new Date(), updatedById: userId, version: { increment: 1 } } });
  await writeActivityLog({ organizationId, entityType: "Receipt", entityId: receiptId, action: reason === "PAYMENT" ? "COLLECTION_FOLLOWUP_CLOSED_PAYMENT" : "COLLECTION_FOLLOWUP_CANCELLED", oldValue: { status: existing.status }, newValue: { status: reason === "PAYMENT" ? "RESOLVED" : "CANCELLED" }, userId, db: client });
}

/** Daily scan for due contacts and promises whose promised date has passed. */
export async function runCollectionFollowUpScan(organizationId: string, now = new Date()): Promise<CollectionFollowUpScanSummary> {
  const summary: CollectionFollowUpScanSummary = { scanned: 0, due: 0, brokenPromises: 0, notificationsCreated: 0 };
  const startedAt = Date.now();
  try {
  await withSystemOrganizationTransaction(organizationId, "collection follow-up", async (tx) => {
    const run = await tx.maintenanceRun.create({ data: { organizationId, type: "COLLECTION_FOLLOWUP", status: "RUNNING", startedAt: now } });
    const items = await tx.workItem.findMany({
      where: { organizationId, sourceType: "Collection", status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] } },
      select: { id: true, sourceId: true, dueDate: true, assignedToId: true, receiptId: true, clientId: true, policyId: true, metadataJson: true, receipt: { select: { payments: { where: { status: "POSTED" }, select: { paidDate: true } } } } },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    });
    summary.scanned = items.length;
    for (const item of items) {
      const metadata = metadataFromWorkItem(item);
      const promised = typeof metadata.promisedPaymentDate === "string" ? new Date(metadata.promisedPaymentDate) : null;
      const due = item.dueDate && item.dueDate <= now;
      const qualifyingPayment = promised && item.receipt?.payments.some((payment) => payment.paidDate <= promised);
      const brokenPromise = Boolean(promised && promised < now && metadata.outcome === "PROMISED_PAYMENT" && !qualifyingPayment);
      if (!due && !brokenPromise) continue;
      if (due) summary.due += 1;
      if (brokenPromise) summary.brokenPromises += 1;
      if (!item.assignedToId) continue;
      const stage = brokenPromise ? "BROKEN_PROMISE" : "DUE_CONTACT";
      const event = await createNotificationEvent({
        organizationId,
        type: "COLLECTION_FOLLOWUP",
        title: brokenPromise ? "Promesa de pago incumplida" : "Contacto de cobranza pendiente",
        body: brokenPromise ? "La fecha prometida pasó sin un pago calificante registrado." : "Hay un seguimiento de cobranza que requiere atención.",
        priority: brokenPromise ? "URGENT" : "HIGH",
        userId: item.assignedToId,
        workItemId: item.id,
        clientId: item.clientId,
        policyId: item.policyId,
        receiptId: item.receiptId,
        dedupeKey: `collection-followup:${item.sourceId}:${stage}:${now.toISOString().slice(0, 10)}`,
      }, tx);
      if (event) {
        summary.notificationsCreated += 1;
        await writeActivityLog({ organizationId, entityType: "Receipt", entityId: item.receiptId ?? item.sourceId ?? item.id, action: "COLLECTION_FOLLOWUP_REMINDER", newValue: { stage, notificationStatus: event.status }, userId: item.assignedToId, db: tx });
      }
    }
    await tx.maintenanceRun.update({ where: { id: run.id, organizationId }, data: { organizationId, status: "COMPLETED", completedAt: new Date(), summaryJson: JSON.stringify({ ...summary, durationMs: Date.now() - startedAt }) } });
  });
  } catch (error) {
    await withSystemOrganizationTransaction(organizationId, "collection follow-up failure", (tx) => tx.maintenanceRun.create({ data: { organizationId, type: "COLLECTION_FOLLOWUP", status: "FAILED", startedAt: now, completedAt: new Date(), summaryJson: JSON.stringify({ ...summary, durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message.slice(0, 300) : "unknown" }) } })).catch(() => undefined);
    throw error;
  }
  return summary;
}
