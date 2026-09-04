"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";
import { assertOrganizationContextInTransaction, requireOrganizationContext } from "@/lib/organization-context";
import { isRenewalStage, isTerminalRenewalStage, resolveRenewalStage } from "@/lib/renewal-board.logic";
import { closeRenewalFollowUp } from "@/lib/renewal-followups";
import { renewalStageLabel } from "@/lib/status";
import { OPEN_WORK_ITEM_STATUSES } from "@/lib/work-queue";
import {
  prepareRenewalWhatsAppContactForContext,
  prepareRenewalQuoteShareForContext,
  type RenewalWhatsAppResult,
} from "@/lib/renewal-whatsapp-service";

function renewalWhatsAppError(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo preparar el contacto.";
  if (message === "WHATSAPP_CAPABILITY_DISABLED") return "WhatsApp no está disponible para esta organización.";
  if (message === "ORGANIZATION_CONTEXT_MISMATCH" || message === "UNAUTHENTICATED") return "No se pudo validar la organización activa.";
  if (/^(Captura un teléfono mexicano válido|El teléfono del cliente cambió|La renovación ya no está disponible|Esta póliza ya se renovó|Esta renovación ya se cerró)/i.test(message)) return message;
  return "No se pudo preparar el contacto de WhatsApp.";
}

export async function prepareRenewalWhatsAppContact(input: { policyId: string; capturedPhone?: string }): Promise<RenewalWhatsAppResult | { outcome: "ERROR"; error: string }> {
  try {
    if (!input?.policyId?.trim()) return { outcome: "ERROR", error: "La póliza no es válida." };
    const context = await requireOrganizationContext();
    const result = await getDb().$transaction((tx) => prepareRenewalWhatsAppContactForContext({ db: tx, context, policyId: input.policyId, capturedPhone: input.capturedPhone }));
    revalidatePaths(["/operations", "/activity", "/clients"]);
    return result;
  } catch (error) {
    return { outcome: "ERROR", error: renewalWhatsAppError(error) };
  }
}

export async function prepareRenewalQuoteShare(input: { policyId: string; handoff: "NATIVE_SHARE" | "WHATSAPP_FALLBACK"; capturedPhone?: string }): Promise<RenewalWhatsAppResult | { outcome: "ERROR"; error: string }> {
  try {
    if (!input?.policyId?.trim()) return { outcome: "ERROR", error: "La póliza no es válida." };
    if (input.handoff !== "NATIVE_SHARE" && input.handoff !== "WHATSAPP_FALLBACK") return { outcome: "ERROR", error: "La forma de compartir no es válida." };
    const context = await requireOrganizationContext();
    const result = await getDb().$transaction((tx) => prepareRenewalQuoteShareForContext({ db: tx, context, policyId: input.policyId, handoff: input.handoff, capturedPhone: input.capturedPhone }));
    revalidatePaths(["/operations", "/activity", "/clients"]);
    return result;
  } catch (error) {
    return { outcome: "ERROR", error: renewalWhatsAppError(error) };
  }
}

export async function markRenewalAsNotContinuing(policyId: string): Promise<MutationResult> {
  try {
    const db = getDb();
    const context = await requireOrganizationContext();
    const userId = context.userId;

    const policy = await db.policy.findFirst({
      where: { id: policyId, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { client: { portfolioOwnerId: userId } } : {}) },
      include: {
        client: { select: { fullName: true } },
      },
    });

    if (!policy) {
      return errorResult("La póliza ya no existe.");
    }

    const now = new Date();
    const { workItemCancelled, suggestionCreated } = await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const workItem = await tx.workItem.findFirst({
        where: {
          organizationId: context.organizationId,
          workItemType: "TASK",
          taskType: "RENEWAL",
          policyId,
          status: { in: [...OPEN_WORK_ITEM_STATUSES] },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
          organizationId: context.organizationId,
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
        where: { organizationId: context.organizationId, sourcePolicyId: policy.id },
        orderBy: { updatedAt: "desc" },
      });

      if (existingSuggestion) {
        await tx.policyRenewalSuggestion.update({
          where: { id: existingSuggestion.id },
          data: {
            organizationId: context.organizationId,
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

      // El recordatorio de "sin avance" ya no aplica: la renovación se cerró.
      await closeRenewalFollowUp(context.organizationId, policy.id, userId, tx);

      await writeActivityLog({
        organizationId: context.organizationId,
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
      "/operations",
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

/**
 * Mueve una renovación de columna en el tablero.
 *
 * Sólo se pueden mover a mano las etapas de gestión (por vencer, contactado,
 * cotizado). Las dos columnas terminales no se escriben: "Renovado" lo produce
 * el alta de la póliza de renovación y "Perdido" el flujo de "No renueva", que
 * es a donde se delega. Si no fuera así el tablero podría afirmar que una
 * póliza se renovó sin que exista la póliza nueva.
 */
export async function setRenewalStage(policyId: string, stage: string): Promise<MutationResult> {
  try {
    if (!isRenewalStage(stage)) {
      return errorResult("La etapa de renovación no es válida.");
    }

    if (stage === "WON") {
      return errorResult("Una renovación se marca como renovada al dar de alta la póliza nueva.");
    }

    if (stage === "LOST") {
      // La pérdida es la misma decisión de siempre, con su sugerencia
      // declinada y su pendiente cancelado.
      return markRenewalAsNotContinuing(policyId);
    }

    const db = getDb();
    const context = await requireOrganizationContext();
    const userId = context.userId;

    const policy = await db.policy.findFirst({
      where: { id: policyId, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { client: { portfolioOwnerId: userId } } : {}) },
      select: {
        id: true,
        policyNumber: true,
        status: true,
        renewalStage: true,
        client: { select: { fullName: true } },
        sourceRenewalSuggestions: { where: { status: "DECLINED" }, select: { id: true }, take: 1 },
      },
    });

    if (!policy) {
      return errorResult("La póliza ya no existe.");
    }

    const currentStage = resolveRenewalStage({
      policyStatus: policy.status,
      renewalStage: policy.renewalStage,
      hasDeclinedSuggestion: policy.sourceRenewalSuggestions.length > 0,
    });

    if (isTerminalRenewalStage(currentStage)) {
      return errorResult(
        currentStage === "WON"
          ? "Esta póliza ya se renovó; su etapa la define la póliza de renovación."
          : "Esta renovación ya se cerró como no renovada.",
      );
    }

    if (currentStage === stage) {
      return successResult(policy.id, "/operations?view=renewal-board", "La renovación ya estaba en esa etapa.");
    }

    const now = new Date();

    await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      await tx.policy.update({
        where: { id: policy.id },
        data: {
          renewalStage: stage,
          renewalStageAt: now,
          renewalStageById: userId,
          updatedById: userId,
        },
      });

      await writeActivityLog({
        organizationId: context.organizationId,
        entityType: "Policy",
        entityId: policy.id,
        action: "RENEWAL_STAGE_CHANGE",
        oldValue: { renewalStage: currentStage, label: renewalStageLabel(currentStage) },
        newValue: {
          renewalStage: stage,
          label: renewalStageLabel(stage),
          policyNumber: policy.policyNumber,
          clientName: policy.client.fullName,
        },
        userId,
        db: tx,
      });

      // La renovación acaba de avanzar: el recordatorio de "sin avance" que
      // pudiera existir ya no aplica.
      await closeRenewalFollowUp(context.organizationId, policy.id, userId, tx);
    });

    revalidatePaths([
      "/operations",
      "/renewals",
      "/tasks",
      "/dashboard",
      "/today",
      "/portfolio",
      `/policies/${policy.id}`,
    ]);

    return successResult(
      policy.id,
      "/operations?view=renewal-board",
      `Renovación movida a ${renewalStageLabel(stage)}.`,
    );
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo mover la renovación.");
  }
}

export async function linkRenewalToPolicy(sourcePolicyId: string, targetPolicyId: string): Promise<MutationResult> {
  try {
    if (sourcePolicyId === targetPolicyId) {
      return errorResult("La póliza origen y la destino no pueden ser la misma.");
    }

    const db = getDb();
    const context = await requireOrganizationContext();
    const userId = context.userId;

    const [sourcePolicy, targetPolicy] = await Promise.all([
      db.policy.findFirst({
        where: { id: sourcePolicyId, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { client: { portfolioOwnerId: userId } } : {}) },
        select: {
          id: true,
          policyNumber: true,
          clientId: true,
          insurerId: true,
          familyRootId: true,
          status: true,
        },
      }),
      db.policy.findFirst({
        where: { id: targetPolicyId, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { client: { portfolioOwnerId: userId } } : {}) },
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
      await assertOrganizationContextInTransaction(tx, context);
      const workItem = await tx.workItem.findFirst({
        where: {
          organizationId: context.organizationId,
          workItemType: "TASK",
          taskType: "RENEWAL",
          policyId: sourcePolicy.id,
          status: { in: [...OPEN_WORK_ITEM_STATUSES] },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
        where: { organizationId: context.organizationId, sourcePolicyId: sourcePolicy.id },
        orderBy: { updatedAt: "desc" },
      });

      if (existingSuggestion) {
        await tx.policyRenewalSuggestion.update({
          where: { id: existingSuggestion.id },
          data: {
            organizationId: context.organizationId,
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

      // La renovación quedó cerrada: su recordatorio de "sin avance" sobra.
      await closeRenewalFollowUp(context.organizationId, sourcePolicy.id, userId, tx);

      await writeActivityLog({
        organizationId: context.organizationId,
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
      "/operations",
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
