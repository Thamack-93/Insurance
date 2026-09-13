import "server-only";

import { addDays } from "date-fns";
import { writeActivityLog } from "@/lib/activity-log";
import { createNotificationEvent } from "@/lib/notification-foundation";
import { withSystemOrganizationTransaction } from "@/lib/organization-context";
import { upsertWorkItemFromSource } from "@/lib/work-items";

const OPEN_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_CLIENT", "WAITING_INSURER"] as const;

export type ClaimFollowUpSummary = {
  scanned: number;
  overdue: number;
  escalated: number;
  workItemsUpserted: number;
  workItemsClosed: number;
  notificationsCreated: number;
};

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Creates deterministic claim/requirement work items and deduplicated reminders. */
export async function runClaimFollowUpScan(organizationId: string, now = new Date()): Promise<ClaimFollowUpSummary> {
  const summary: ClaimFollowUpSummary = { scanned: 0, overdue: 0, escalated: 0, workItemsUpserted: 0, workItemsClosed: 0, notificationsCreated: 0 };
  const startedAt = Date.now();
  try {
  await withSystemOrganizationTransaction(organizationId, "claim follow-up", async (tx) => {
    const run = await tx.maintenanceRun.create({ data: { organizationId, type: "CLAIM_FOLLOWUP", status: "RUNNING", startedAt: now } });
    const claims = await tx.claim.findMany({
      where: { organizationId },
      select: {
        id: true, folio: true, status: true, dueDate: true, assignedToId: true,
        clientId: true, policyId: true, client: { select: { fullName: true, portfolioOwnerId: true } },
        checklistItems: { select: { id: true, requirementCode: true, label: true, status: true, dueDate: true, assignedToId: true } },
      },
      orderBy: { id: "asc" },
    });
    summary.scanned = claims.length;
    const administrators = await tx.organizationMembership.findMany({
      where: { organizationId, active: true, role: { in: ["OWNER", "ADMIN"] } },
      select: { userId: true },
    });
    const activeMembers = new Set((await tx.organizationMembership.findMany({ where: { organizationId, active: true, user: { active: true } }, select: { userId: true } })).map((row) => row.userId));

    for (const claim of claims) {
      const completedRequirementKeys = claim.checklistItems
        .filter((item) => item.status === "RECEIVED" || item.status === "WAIVED")
        .map((item) => `claim:${claim.id}:requirement:${item.requirementCode}`);
      if (completedRequirementKeys.length) {
        const closedRequirements = await tx.workItem.updateMany({
          where: { organizationId, sourceType: "Claim", sourceId: { in: completedRequirementKeys }, status: { in: [...OPEN_STATUSES] } },
          data: { status: "RESOLVED", closedDate: now, organizationId },
        });
        summary.workItemsClosed += closedRequirements.count;
      }
      if (claim.status === "RESOLVED" || claim.status === "CANCELLED") {
        const closed = await tx.workItem.updateMany({
          where: { organizationId, sourceType: "Claim", sourceId: { startsWith: `claim:${claim.id}:` }, status: { in: [...OPEN_STATUSES] } },
          data: { status: claim.status === "CANCELLED" ? "CANCELLED" : "RESOLVED", closedDate: now },
        });
        summary.workItemsClosed += closed.count;
        continue;
      }

      const candidates = [
        ...(claim.dueDate ? [{ key: "claim", id: claim.id, label: "Seguimiento del siniestro", dueDate: claim.dueDate, assignee: claim.assignedToId ?? claim.client.portfolioOwnerId, entityType: "Claim", entityId: claim.id }] : []),
        ...claim.checklistItems.filter((item) => item.dueDate && item.status !== "RECEIVED" && item.status !== "WAIVED").map((item) => ({ key: `requirement:${item.requirementCode}`, id: item.id, label: item.label, dueDate: item.dueDate as Date, assignee: item.assignedToId ?? claim.assignedToId ?? claim.client.portfolioOwnerId, entityType: "Claim", entityId: claim.id })),
      ];
      for (const candidate of candidates) {
        if (candidate.dueDate >= now) continue;
        summary.overdue += 1;
        const escalation = candidate.dueDate <= addDays(now, -3);
        if (escalation) summary.escalated += 1;
        const sourceId = `claim:${claim.id}:${candidate.key}`;
        const workItem = await upsertWorkItemFromSource({
          organizationId, sourceType: "Claim", sourceId, workItemType: "TASK", taskType: "CLAIM_FOLLOWUP", status: "OPEN",
          priority: escalation ? "URGENT" : "HIGH", title: `${candidate.label} · ${claim.folio}`,
          description: `Vencido desde ${dayKey(candidate.dueDate)}.`, entityType: candidate.entityType, entityId: candidate.entityId,
          clientId: claim.clientId, policyId: claim.policyId, dueDate: candidate.dueDate, assignedToId: candidate.assignee,
          metadataJson: JSON.stringify({ claimId: claim.id, requirementId: candidate.key.startsWith("requirement:") ? candidate.id : null, reminderStage: escalation ? "ADMIN_ESCALATION" : "OWNER_OVERDUE" }),
        }, tx);
        if (workItem) summary.workItemsUpserted += 1;
        const recipients = (escalation ? administrators.map((row) => row.userId) : (candidate.assignee ? [candidate.assignee] : [])).filter((userId) => activeMembers.has(userId));
        for (const userId of recipients) {
          const dedupeKey = `claim-followup:${claim.id}:${candidate.key}:${escalation ? "admin" : "owner"}:${dayKey(candidate.dueDate)}`;
          const event = await createNotificationEvent({ organizationId, type: "CLAIM_FOLLOWUP", title: `${escalation ? "Escalación" : "Pendiente"}: ${candidate.label}`, body: `Siniestro ${claim.folio} requiere atención.`, priority: escalation ? "URGENT" : "HIGH", userId, clientId: claim.clientId, policyId: claim.policyId, workItemId: workItem?.id ?? null, dedupeKey }, tx);
          if (event) {
            summary.notificationsCreated += 1;
            await writeActivityLog({ organizationId, action: "CLAIM_FOLLOWUP_REMINDER", entityType: "Claim", entityId: claim.id, newValue: { requirement: candidate.key, escalation, notificationStatus: event.status }, userId, db: tx });
          }
        }
      }
    }
    await tx.maintenanceRun.update({ where: { id: run.id, organizationId }, data: { organizationId, status: "COMPLETED", completedAt: new Date(), summaryJson: JSON.stringify({ ...summary, durationMs: Date.now() - startedAt }) } });
  });
  } catch (error) {
    await withSystemOrganizationTransaction(organizationId, "claim follow-up failure", (tx) => tx.maintenanceRun.create({ data: { organizationId, type: "CLAIM_FOLLOWUP", status: "FAILED", startedAt: now, completedAt: new Date(), summaryJson: JSON.stringify({ ...summary, durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message.slice(0, 300) : "unknown" }) } })).catch(() => undefined);
    throw error;
  }
  return summary;
}
