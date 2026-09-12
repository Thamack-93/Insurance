"use server";

import type { Prisma } from "@/generated/prisma/client";
import { writeActivityLog } from "@/lib/activity-log";
import { formatBusinessDateInput, parseBusinessDateInput } from "@/lib/business-dates";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";
import { assertOrganizationContextInTransaction, requireOrganizationContext, withTenantTransaction } from "@/lib/organization-context";
import { canScheduleRenewalManualFollowUp, isRenewalStage, isTerminalRenewalStage, renewalManualFollowUpWorkItemSourceId, resolveRenewalStage } from "@/lib/renewal-board.logic";
import { closeRenewalFollowUp, closeRenewalManualFollowUp, upsertRenewalManualFollowUp } from "@/lib/renewal-followups";
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
    const result = await withTenantTransaction(context, (tx) => prepareRenewalWhatsAppContactForContext({ db: tx, context, policyId: input.policyId, capturedPhone: input.capturedPhone }));
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
    const result = await withTenantTransaction(context, (tx) => prepareRenewalQuoteShareForContext({ db: tx, context, policyId: input.policyId, handoff: input.handoff, capturedPhone: input.capturedPhone }));
    revalidatePaths(["/operations", "/activity", "/clients"]);
    return result;
  } catch (error) {
    return { outcome: "ERROR", error: renewalWhatsAppError(error) };
  }
}

type RenewalManualFollowUpActionInput = {
  policyId: string;
  dueDate: string;
  notes?: string;
};

const renewalMutationPolicyWhere = (context: Awaited<ReturnType<typeof requireOrganizationContext>>, policyId: string) => ({
  id: policyId,
  organizationId: context.organizationId,
  ...(context.membershipRole === "AGENT" ? { client: { portfolioOwnerId: context.userId } } : {}),
});

export async function scheduleRenewalManualFollowUp(input: RenewalManualFollowUpActionInput): Promise<MutationResult> {
  try {
    const policyId = input?.policyId?.trim();
    const dateKey = input?.dueDate?.trim();
    if (!policyId) return errorResult("La póliza no es válida.");
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return errorResult("La fecha de seguimiento no es válida.");

    const dueDate = parseBusinessDateInput(dateKey);
    if (Number.isNaN(dueDate.getTime())) return errorResult("La fecha de seguimiento no es válida.");

    const notes = typeof input.notes === "string" ? input.notes.trim() : "";
    if (notes.length > 500) return errorResult("La nota no puede tener más de 500 caracteres.");

    const context = await requireOrganizationContext();
    const result = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const policy = await tx.policy.findFirst({
        where: renewalMutationPolicyWhere(context, policyId),
        select: {
          id: true,
          policyNumber: true,
          status: true,
          renewalStage: true,
          clientId: true,
          insurerId: true,
          sourceRenewalSuggestions: { where: { status: "DECLINED" }, select: { id: true }, take: 1 },
        },
      });

      if (!policy) return errorResult("La póliza ya no existe o no tienes acceso a ella.");

      const stage = resolveRenewalStage({
        policyStatus: policy.status,
        renewalStage: policy.renewalStage,
        hasDeclinedSuggestion: policy.sourceRenewalSuggestions.length > 0,
      });
      if (policy.status !== "ACTIVE" || !canScheduleRenewalManualFollowUp(stage)) {
        return errorResult("Esta renovación ya no está disponible para seguimiento.");
      }

      const mutation = await upsertRenewalManualFollowUp({
        organizationId: context.organizationId,
        policyId: policy.id,
        policyNumber: policy.policyNumber,
        clientId: policy.clientId,
        insurerId: policy.insurerId,
        stage,
        dueDate,
        notes: notes || null,
        userId: context.userId,
      }, tx);

      await writeActivityLog({
        organizationId: context.organizationId,
        entityType: "Policy",
        entityId: policy.id,
        action: mutation.created ? "SCHEDULE_RENEWAL_FOLLOWUP" : "RESCHEDULE_RENEWAL_FOLLOWUP",
        oldValue: mutation.created ? undefined : {
          dueDate: mutation.previousDueDate ? formatBusinessDateInput(mutation.previousDueDate) : null,
          stage,
          noteExists: Boolean(notes),
        },
        newValue: {
          dueDate: formatBusinessDateInput(dueDate),
          stage,
          noteExists: Boolean(notes),
        },
        userId: context.userId,
        db: tx,
      });

      return successResult(
        policy.id,
        "/operations?view=renewal-board",
        mutation.created ? "Seguimiento programado." : "Seguimiento reprogramado.",
      );
    });

    revalidatePaths(["/operations", "/today", "/tasks", "/dashboard", "/activity", `/policies/${policyId}`]);
    return result;
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo programar el seguimiento.");
  }
}

export async function clearRenewalManualFollowUp(policyId: string): Promise<MutationResult> {
  try {
    const normalizedPolicyId = policyId?.trim();
    if (!normalizedPolicyId) return errorResult("La póliza no es válida.");

    const context = await requireOrganizationContext();
    const result = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const policy = await tx.policy.findFirst({
        where: renewalMutationPolicyWhere(context, normalizedPolicyId),
        select: {
          id: true,
          renewalStage: true,
          status: true,
          sourceRenewalSuggestions: { where: { status: "DECLINED" }, select: { id: true }, take: 1 },
        },
      });
      if (!policy) return errorResult("La póliza ya no existe o no tienes acceso a ella.");

      const stage = resolveRenewalStage({
        policyStatus: policy.status,
        renewalStage: policy.renewalStage,
        hasDeclinedSuggestion: policy.sourceRenewalSuggestions.length > 0,
      });
      const closed = await closeRenewalManualFollowUp(context.organizationId, policy.id, context.userId, tx);
      if (!closed) return successResult(policy.id, "/operations?view=renewal-board", "No había un seguimiento abierto.");

      await writeActivityLog({
        organizationId: context.organizationId,
        entityType: "Policy",
        entityId: policy.id,
        action: "CLEAR_RENEWAL_FOLLOWUP",
        oldValue: {
          dueDate: closed.dueDate ? formatBusinessDateInput(closed.dueDate) : null,
          stage,
        },
        newValue: { status: "CANCELLED", stage },
        userId: context.userId,
        db: tx,
      });

      return successResult(policy.id, "/operations?view=renewal-board", "Seguimiento eliminado.");
    });

    revalidatePaths(["/operations", "/today", "/tasks", "/dashboard", "/activity", `/policies/${normalizedPolicyId}`]);
    return result;
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo quitar el seguimiento.");
  }
}

export async function markRenewalAsNotContinuing(policyId: string): Promise<MutationResult> {
  try {
    const context = await requireOrganizationContext();
    const userId = context.userId;

    const policy = await withTenantTransaction(context, (tx) => tx.policy.findFirst({
      where: { id: policyId, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { client: { portfolioOwnerId: userId } } : {}) },
      include: {
        client: { select: { fullName: true } },
      },
    }));

    if (!policy) {
      return errorResult("La póliza ya no existe.");
    }

    const now = new Date();
    const { workItemCancelled, suggestionCreated } = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const workItem = await tx.workItem.findFirst({
        where: {
          organizationId: context.organizationId,
          workItemType: "TASK",
          taskType: "RENEWAL",
          policyId,
          sourceId: { not: renewalManualFollowUpWorkItemSourceId(policy.id) },
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
            organizationId: context.organizationId,
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
      const manualFollowUp = await closeRenewalManualFollowUp(context.organizationId, policy.id, userId, tx, now);
      if (manualFollowUp) {
        await writeActivityLog({
          organizationId: context.organizationId,
          entityType: "Policy",
          entityId: policy.id,
          action: "RENEWAL_FOLLOWUP_CLOSED_TERMINAL",
          newValue: { renewalStage: "LOST", status: "CANCELLED" },
          userId,
          db: tx,
        });
      }

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

    const context = await requireOrganizationContext();
    const userId = context.userId;

    const policy = await withTenantTransaction(context, (tx) => tx.policy.findFirst({
      where: { id: policyId, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { client: { portfolioOwnerId: userId } } : {}) },
      select: {
        id: true,
        policyNumber: true,
        status: true,
        renewalStage: true,
        client: { select: { fullName: true } },
        sourceRenewalSuggestions: { where: { status: "DECLINED" }, select: { id: true }, take: 1 },
      },
    }));

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

    await withTenantTransaction(context, async (tx) => {
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

export async function linkRenewalToPolicy(sourcePolicyId: string, targetPolicyId: string, client?: Prisma.TransactionClient): Promise<MutationResult> {
  try {
    if (sourcePolicyId === targetPolicyId) {
      return errorResult("La póliza origen y la destino no pueden ser la misma.");
    }

    const context = await requireOrganizationContext();
    const userId = context.userId;

    const loadPolicies = (tx: Prisma.TransactionClient) => Promise.all([
      tx.policy.findFirst({
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
      tx.policy.findFirst({
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
    const [sourcePolicy, targetPolicy] = client ? await loadPolicies(client) : await withTenantTransaction(context, loadPolicies);

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

    const persist = async (tx: Prisma.TransactionClient) => {
      await assertOrganizationContextInTransaction(tx, context);
      const workItem = await tx.workItem.findFirst({
        where: {
          organizationId: context.organizationId,
          workItemType: "TASK",
          taskType: "RENEWAL",
          policyId: sourcePolicy.id,
          sourceId: { not: renewalManualFollowUpWorkItemSourceId(sourcePolicy.id) },
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
            organizationId: context.organizationId,
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
      const manualFollowUp = await closeRenewalManualFollowUp(context.organizationId, sourcePolicy.id, userId, tx, now);
      if (manualFollowUp) {
        await writeActivityLog({
          organizationId: context.organizationId,
          entityType: "Policy",
          entityId: sourcePolicy.id,
          action: "RENEWAL_FOLLOWUP_CLOSED_TERMINAL",
          newValue: { renewalStage: "WON", status: "CANCELLED" },
          userId,
          db: tx,
        });
      }

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
    };
    if (client) await persist(client);
    else await withTenantTransaction(context, persist);

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
