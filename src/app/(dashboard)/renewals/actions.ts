"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { getCurrentUserId } from "@/lib/auth";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";
import { assertPolicyPortfolioAccess } from "@/lib/portfolio-access";
import { OPEN_WORK_ITEM_STATUSES } from "@/lib/work-queue";

export async function markRenewalAsNotContinuing(policyId: string): Promise<MutationResult> {
  try {
    const db = getDb();
    const userId = await getCurrentUserId();
    await assertPolicyPortfolioAccess(policyId, userId);

    const policy = await db.policy.findUnique({
      where: { id: policyId },
      include: {
        client: { select: { fullName: true } },
      },
    });

    if (!policy) {
      return errorResult("La póliza ya no existe.");
    }

    const now = new Date();
    const { workItemCancelled, suggestionCreated } = await db.$transaction(async (tx) => {
      const workItem = await tx.workItem.findFirst({
        where: {
          workItemType: "TASK",
          taskType: "RENEWAL",
          policyId,
          status: { in: [...OPEN_WORK_ITEM_STATUSES] },
        },
        orderBy: { createdAt: "desc" },
      });

      let cancelledWorkItemId: string | null = null;

      if (workItem) {
        const updatedWorkItem = await tx.workItem.update({
          where: { id: workItem.id },
          data: {
            status: "CANCELLED",
            closedDate: now,
            updatedById: userId,
            notes: workItem.notes
              ? `${workItem.notes}\n\nNo se va a renovar.`
              : "No se va a renovar.",
          },
        });
        cancelledWorkItemId = updatedWorkItem.id;

        await writeActivityLog({
          entityType: "WorkItem",
          entityId: updatedWorkItem.sourceId ?? updatedWorkItem.id,
          action: "TASK_CANCEL_RENEWAL",
          oldValue: workItem,
          newValue: updatedWorkItem,
          db: tx,
        });
      }

      const existingSuggestion = await tx.policyRenewalSuggestion.findFirst({
        where: { sourcePolicyId: policy.id },
        orderBy: { updatedAt: "desc" },
      });

      if (existingSuggestion) {
        await tx.policyRenewalSuggestion.update({
          where: { id: existingSuggestion.id },
          data: {
            targetPolicyId: null,
            status: "DECLINED",
            reason: "No se va a renovar.",
            reviewedAt: now,
            reviewedById: userId,
            resolutionNote: "Cerrado manualmente desde Renovaciones.",
          },
        });
      } else {
        await tx.policyRenewalSuggestion.create({
          data: {
            sourcePolicyId: policy.id,
            targetPolicyId: null,
            status: "DECLINED",
            reason: "No se va a renovar.",
            reviewedAt: now,
            reviewedById: userId,
            resolutionNote: "Cerrado manualmente desde Renovaciones.",
          },
        });
      }

      await writeActivityLog({
        entityType: "Policy",
        entityId: policy.id,
        action: "RENEWAL_DECLINED",
        newValue: {
          policyNumber: policy.policyNumber,
          clientName: policy.client.fullName,
          note: "No se va a renovar.",
          workItemCancelled: Boolean(cancelledWorkItemId),
        },
        db: tx,
      });

      return {
        workItemCancelled: Boolean(cancelledWorkItemId),
        suggestionCreated: Boolean(existingSuggestion),
      };
    });

    revalidatePaths([
      "/renewals",
      "/tasks",
      "/dashboard",
      "/today",
      "/portfolio",
      `/policies/${policyId}`,
      "/risks",
    ]);

    return successResult(
      policyId,
      "/renewals",
      workItemCancelled || suggestionCreated ? "Renovación cerrada como no renovada." : "Decisión registrada como no renovada.",
    );
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo cerrar la renovación.");
  }
}
