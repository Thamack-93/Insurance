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
          userId,
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
        userId,
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
      "/data-quality",
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

export async function linkRenewalToPolicy(sourcePolicyId: string, targetPolicyId: string): Promise<MutationResult> {
  try {
    if (sourcePolicyId === targetPolicyId) {
      return errorResult("La póliza origen y la destino no pueden ser la misma.");
    }

    const db = getDb();
    const userId = await getCurrentUserId();
    await assertPolicyPortfolioAccess(sourcePolicyId, userId);
    await assertPolicyPortfolioAccess(targetPolicyId, userId);

    const [sourcePolicy, targetPolicy] = await Promise.all([
      db.policy.findUnique({
        where: { id: sourcePolicyId },
        select: {
          id: true,
          policyNumber: true,
          clientId: true,
          insurerId: true,
          familyRootId: true,
          status: true,
        },
      }),
      db.policy.findUnique({
        where: { id: targetPolicyId },
        select: {
          id: true,
          policyNumber: true,
          clientId: true,
          insurerId: true,
          familyRootId: true,
          status: true,
        },
      }),
    ]);

    if (!sourcePolicy) {
      return errorResult("La póliza origen ya no existe.");
    }
    if (!targetPolicy) {
      return errorResult("La póliza destino ya no existe.");
    }
    if (sourcePolicy.clientId !== targetPolicy.clientId || sourcePolicy.insurerId !== targetPolicy.insurerId) {
      return errorResult("La póliza destino debe pertenecer al mismo cliente y aseguradora.");
    }

    const now = new Date();
    const familyRootId = sourcePolicy.familyRootId ?? sourcePolicy.id;
    let workItemClosed = false;

    await db.$transaction(async (tx) => {
      const workItem = await tx.workItem.findFirst({
        where: {
          workItemType: "TASK",
          taskType: "RENEWAL",
          policyId: sourcePolicy.id,
          status: { in: [...OPEN_WORK_ITEM_STATUSES] },
        },
        orderBy: { createdAt: "desc" },
      });

      if (workItem) {
        await tx.workItem.update({
          where: { id: workItem.id },
          data: {
            status: "RESOLVED",
            closedDate: now,
            updatedById: userId,
            notes: workItem.notes
              ? `${workItem.notes}\n\nRenovación vinculada a ${targetPolicy.policyNumber}.`
              : `Renovación vinculada a ${targetPolicy.policyNumber}.`,
          },
        });
        workItemClosed = true;
      }

      const existingSuggestion = await tx.policyRenewalSuggestion.findFirst({
        where: { sourcePolicyId: sourcePolicy.id },
        orderBy: { updatedAt: "desc" },
      });

      if (existingSuggestion) {
        await tx.policyRenewalSuggestion.update({
          where: { id: existingSuggestion.id },
          data: {
            targetPolicyId: targetPolicy.id,
            status: "ACCEPTED",
            reason: "Vinculada manualmente desde Riesgos y calidad.",
            reviewedAt: now,
            reviewedById: userId,
            resolutionNote: `Vinculada manualmente con ${targetPolicy.policyNumber}.`,
          },
        });
      } else {
        await tx.policyRenewalSuggestion.create({
          data: {
            sourcePolicyId: sourcePolicy.id,
            targetPolicyId: targetPolicy.id,
            status: "ACCEPTED",
            reason: "Vinculada manualmente desde Riesgos y calidad.",
            reviewedAt: now,
            reviewedById: userId,
            resolutionNote: `Vinculada manualmente con ${targetPolicy.policyNumber}.`,
          },
        });
      }

      await tx.policy.update({
        where: { id: targetPolicy.id },
        data: {
          familyRootId,
          renewedFromPolicyId: sourcePolicy.id,
          status: "ACTIVE",
          updatedById: userId,
        },
      });

      await tx.policy.update({
        where: { id: sourcePolicy.id },
        data: {
          status: "RENEWED",
          updatedById: userId,
        },
      });

      await writeActivityLog({
        entityType: "Policy",
        entityId: sourcePolicy.id,
        action: "RENEWAL_LINKED",
        oldValue: sourcePolicy,
        newValue: {
          targetPolicyId: targetPolicy.id,
          targetPolicyNumber: targetPolicy.policyNumber,
          familyRootId,
          workItemClosed,
        },
        userId,
        db: tx,
      });
    });

    revalidatePaths([
      "/renewals",
      "/tasks",
      "/dashboard",
      "/today",
      "/portfolio",
      "/risks",
      "/data-quality",
      `/policies/${sourcePolicy.id}`,
      `/policies/${targetPolicy.id}`,
    ]);

    return successResult(targetPolicy.id, `/policies/${targetPolicy.id}`, "Renovación vinculada.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo vincular la renovación.");
  }
}
