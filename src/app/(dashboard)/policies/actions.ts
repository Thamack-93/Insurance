"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { AuthError, getCurrentUser } from "@/lib/auth";
import { normalizeOptionalText, optionalRelationId, parseDateInput } from "@/lib/form-utils";
import { resolvePolicyFamilyRootId } from "@/lib/policy-families";
import type { Prisma } from "@/generated/prisma/client";
import { policySchema, type PolicyFormValues } from "@/lib/validations";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";
import { assertClientOrganizationAccess, assertPolicyOrganizationAccess } from "@/lib/portfolio-access";
import { requireOrganizationContext } from "@/lib/organization-context";
import { buildPolicyNumberSearchVariants } from "@/lib/policy-number";
import { buildPolicyDeleteBlockedMessage } from "@/lib/policy-delete";

function normalizePolicyInput(values: PolicyFormValues) {
  return {
    policyNumber: values.policyNumber.trim(),
    clientId: values.clientId,
    insurerId: values.insurerId,
    policyType: values.policyType,
    status: values.status,
    startDate: parseDateInput(values.startDate),
    endDate: parseDateInput(values.endDate),
    premiumAmount: values.premiumAmount,
    currency: values.currency,
    paymentFrequency: values.paymentFrequency,
    paymentPlan: normalizeOptionalText(values.paymentPlan),
    insuredObject: normalizeOptionalText(values.insuredObject),
    beneficiaryInfo: normalizeOptionalText(values.beneficiaryInfo),
    notes: normalizeOptionalText(values.notes),
    renewedFromPolicyId: optionalRelationId(values.renewedFromPolicyId),
  };
}

type RenewalPolicyRecord = {
  id: string;
  policyNumber: string;
  clientId: string;
  insurerId: string;
  familyRootId: string | null;
  status: string;
};

async function clearPreviousRenewalSource(tx: Prisma.TransactionClient, sourcePolicyId: string, currentPolicyId: string, userId: string) {
  const remainingChildren = await tx.policy.count({
    where: {
      renewedFromPolicyId: sourcePolicyId,
      id: { not: currentPolicyId },
    },
  });

  if (remainingChildren === 0) {
    await tx.policy.update({
      where: { id: sourcePolicyId },
      data: {
        status: "ACTIVE",
        updatedById: userId,
      },
    });
  }
}

export async function createPolicy(values: PolicyFormValues): Promise<MutationResult> {
  const parsed = policySchema.safeParse(values);

  if (!parsed.success) {
    return errorResult(parsed.error.issues[0]?.message ?? "No se pudo validar la poliza.");
  }

  try {
    const db = getDb();
    const context = await requireOrganizationContext();
    const userId = context.userId;
    await assertClientOrganizationAccess(parsed.data.clientId, context);
    const normalized = normalizePolicyInput(parsed.data);
    const renewalSourceId = normalized.renewedFromPolicyId;
    const renewalSource = renewalSourceId
      ? await db.policy.findFirst({
          where: { id: renewalSourceId, organizationId: context.organizationId },
          select: {
            id: true,
            policyNumber: true,
            clientId: true,
            insurerId: true,
            familyRootId: true,
          },
        })
      : null;

    if (renewalSourceId && !renewalSource) {
      return errorResult("La póliza que se va a renovar ya no existe.");
    }
    if (renewalSource && (renewalSource.clientId !== normalized.clientId || renewalSource.insurerId !== normalized.insurerId)) {
      return errorResult("La póliza renovada debe pertenecer al mismo cliente y aseguradora.");
    }

    const familyRootId = await resolvePolicyFamilyRootId({
      policyNumber: parsed.data.policyNumber.trim(),
      clientId: parsed.data.clientId,
      insurerId: parsed.data.insurerId,
    });
    const policyNumberVariants = buildPolicyNumberSearchVariants(normalized.policyNumber);
    const overlap = await db.policy.findFirst({
      where: {
        OR: policyNumberVariants.map((variant) => ({ policyNumber: variant })),
        clientId: normalized.clientId,
        insurerId: normalized.insurerId,
        organizationId: context.organizationId,
        startDate: { lte: normalized.endDate },
        endDate: { gte: normalized.startDate },
        ...(renewalSourceId ? { id: { not: renewalSourceId } } : {}),
      },
      select: { id: true },
    });
    if (overlap) {
      return errorResult("Ya existe una vigencia solapada para esta póliza. Revisa la familia antes de continuar.");
    }

    const policy = await db.$transaction(async (tx) => {
      const effectiveFamilyRootId = renewalSource ? renewalSource.familyRootId ?? renewalSource.id : familyRootId;
      const createdPolicy = await tx.policy.create({
        data: {
          ...normalized,
          organizationId: context.organizationId,
          familyRootId: effectiveFamilyRootId,
          renewedFromPolicyId: renewalSource?.id ?? null,
          status: renewalSource ? "ACTIVE" : normalized.status,
          createdById: userId,
          updatedById: userId,
        },
      });

      if (renewalSource) {
        await tx.policy.update({
          where: { id: renewalSource.id },
          data: {
            status: "RENEWED",
            updatedById: userId,
          },
        });
      }

      await writeActivityLog({
        entityType: "Policy",
        entityId: createdPolicy.id,
        action: renewalSource ? "POLICY_CREATE_RENEWAL" : "POLICY_CREATE",
        newValue: {
          ...createdPolicy,
          renewedFromPolicyId: renewalSource?.id ?? null,
          familyRootId: effectiveFamilyRootId,
        },
        organizationId: context.organizationId,
        db: tx,
      });

      return createdPolicy;
    });

    revalidatePaths([
      "/policies",
      `/policies/${policy.id}`,
      `/clients/${policy.clientId}`,
      "/dashboard",
      "/today",
      "/portfolio",
      "/renewals",
      "/risks",
      "/data-quality",
    ]);

    return successResult(policy.id, `/policies/${policy.id}`, "Poliza creada.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo crear la poliza.");
  }
}

export async function updatePolicy(id: string, values: PolicyFormValues): Promise<MutationResult> {
  const parsed = policySchema.safeParse(values);

  if (!parsed.success) {
    return errorResult(parsed.error.issues[0]?.message ?? "No se pudo validar la poliza.");
  }

  try {
    const db = getDb();
    const context = await requireOrganizationContext();
    const userId = context.userId;
    const currentUser = await getCurrentUser();
    await assertPolicyOrganizationAccess(id, context);
    await assertClientOrganizationAccess(parsed.data.clientId, context);
    const previousPolicy = await db.policy.findFirst({ where: { id, organizationId: context.organizationId } });

    if (!previousPolicy) {
      return errorResult("La poliza ya no existe.");
    }

    const normalized = normalizePolicyInput(parsed.data);
    const nextRenewedFromPolicyId = normalized.renewedFromPolicyId;
    const previousRenewedFromPolicyId = previousPolicy.renewedFromPolicyId ?? null;
    const renewalChanged = previousRenewedFromPolicyId !== nextRenewedFromPolicyId;

    if (renewalChanged && currentUser?.role !== "ADMIN") {
      return errorResult("Solo un administrador puede cambiar el vínculo de renovación.");
    }

    let nextRenewalSource: RenewalPolicyRecord | null = null;
    if (nextRenewedFromPolicyId) {
      if (nextRenewedFromPolicyId === id) {
        return errorResult("La póliza origen y la destino no pueden ser la misma.");
      }

      await assertPolicyOrganizationAccess(nextRenewedFromPolicyId, context);
      nextRenewalSource = await db.policy.findFirst({
        where: { id: nextRenewedFromPolicyId, organizationId: context.organizationId },
        select: {
          id: true,
          policyNumber: true,
          clientId: true,
          insurerId: true,
          familyRootId: true,
          status: true,
        },
      });

      if (!nextRenewalSource) {
        return errorResult("La póliza origen ya no existe.");
      }
      if (nextRenewalSource.clientId !== normalized.clientId || nextRenewalSource.insurerId !== normalized.insurerId) {
        return errorResult("La póliza destino debe pertenecer al mismo cliente y aseguradora.");
      }
    }

    const policy = await db.$transaction(async (tx) => {
      await tx.policy.update({
        where: { id },
        data: {
          ...normalized,
          status: (normalized.renewedFromPolicyId || renewalChanged) ? "ACTIVE" : normalized.status,
          updatedById: userId,
        },
      });

      if (renewalChanged) {
        if (previousRenewedFromPolicyId) {
          await clearPreviousRenewalSource(tx, previousRenewedFromPolicyId, id, userId);
        }

        if (nextRenewalSource) {
          const effectiveFamilyRootId = nextRenewalSource.familyRootId ?? nextRenewalSource.id;
          await tx.policy.update({
            where: { id },
            data: {
              renewedFromPolicyId: nextRenewalSource.id,
              familyRootId: effectiveFamilyRootId,
              status: "ACTIVE",
              updatedById: userId,
            },
          });

          await tx.policy.update({
            where: { id: nextRenewalSource.id, organizationId: context.organizationId },
            data: {
              status: "RENEWED",
              updatedById: userId,
            },
          });
        } else {
          await tx.policy.update({
            where: { id },
            data: {
              renewedFromPolicyId: null,
              status: "ACTIVE",
              updatedById: userId,
            },
          });
        }
      }

      const finalPolicy = await tx.policy.findFirst({
        where: { id, organizationId: context.organizationId },
        include: {
          client: true,
          insurer: true,
        },
      });

      if (!finalPolicy) {
        throw new Error("La poliza ya no existe.");
      }

      await writeActivityLog({
        entityType: "Policy",
        entityId: finalPolicy.id,
        action: renewalChanged ? "POLICY_UPDATE_RENEWAL" : "POLICY_UPDATE",
        oldValue: previousPolicy,
        newValue: finalPolicy,
        organizationId: context.organizationId,
        db: tx,
      });

      return finalPolicy;
    });

    revalidatePaths([
      "/policies",
      `/policies/${policy.id}`,
      `/clients/${policy.clientId}`,
      "/dashboard",
      "/today",
      "/portfolio",
      "/renewals",
      "/risks",
      "/data-quality",
    ]);

    return successResult(policy.id, `/policies/${policy.id}`, "Poliza actualizada.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo actualizar la poliza.");
  }
}

export async function updatePolicyQualityFields(
  id: string,
  values: {
    insuredObject?: string;
    premiumAmount?: number | string;
    paymentFrequency?: string;
    status?: string;
    notes?: string;
  },
): Promise<MutationResult> {
  try {
    const db = getDb();
    const context = await requireOrganizationContext();
    const userId = context.userId;
    await assertPolicyOrganizationAccess(id, context);
    const previousPolicy = await db.policy.findFirst({
      where: { id, organizationId: context.organizationId },
      select: {
        id: true,
        policyNumber: true,
        clientId: true,
        insurerId: true,
        policyType: true,
        status: true,
        startDate: true,
        endDate: true,
        premiumAmount: true,
        currency: true,
        paymentFrequency: true,
        paymentPlan: true,
        insuredObject: true,
        beneficiaryInfo: true,
        notes: true,
      },
    });

    if (!previousPolicy) {
      return errorResult("La poliza ya no existe.");
    }

    const updateData: Record<string, unknown> = {
      updatedById: userId,
    };
    if (values.insuredObject !== undefined) {
      updateData.insuredObject = normalizeOptionalText(values.insuredObject);
    }
    if (values.notes !== undefined) {
      updateData.notes = normalizeOptionalText(values.notes);
    }
    if (values.paymentFrequency !== undefined) {
      updateData.paymentFrequency = values.paymentFrequency.trim();
    }
    if (values.status !== undefined) {
      updateData.status = values.status.trim();
    }
    if (values.premiumAmount !== undefined) {
      const premium = typeof values.premiumAmount === "string" ? Number(values.premiumAmount) : values.premiumAmount;
      if (!Number.isFinite(premium) || premium <= 0) {
        return errorResult("La prima debe ser mayor a cero.");
      }
      updateData.premiumAmount = premium;
    }

    const policy = await db.policy.update({
      where: { id },
      data: updateData,
    });

    await writeActivityLog({
      entityType: "Policy",
      entityId: policy.id,
      action: "POLICY_QUALITY_UPDATE",
      oldValue: previousPolicy,
      newValue: policy,
      userId,
      organizationId: context.organizationId,
    });

    revalidatePaths([
      "/policies",
      `/policies/${policy.id}`,
      `/clients/${policy.clientId}`,
      "/dashboard",
      "/today",
      "/portfolio",
      "/renewals",
      "/risks",
      "/data-quality",
    ]);

    return successResult(policy.id, `/policies/${policy.id}`, "Datos de calidad actualizados.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    return errorResult(error instanceof Error ? error.message : "No se pudo actualizar la calidad de la poliza.");
  }
}
export async function deletePolicy(id: string): Promise<MutationResult> {
  try {
    const context = await requireOrganizationContext();
    if (context.membershipRole === "AGENT") return errorResult("Esta acción requiere permisos de administrador.");
    await assertPolicyOrganizationAccess(id, context);
    const db = getDb();

    const existingPolicy = await db.policy.findFirst({
      where: { id, organizationId: context.organizationId },
      select: {
        id: true,
        policyNumber: true,
        clientId: true,
      },
    });

    if (!existingPolicy) {
      return errorResult("La poliza ya no existe.");
    }

    const paidReceiptCount = await db.receipt.count({
      where: {
        policyId: id, organizationId: context.organizationId,
        status: "PAID",
      },
    });
    const blockerMessage = buildPolicyDeleteBlockedMessage(paidReceiptCount);
    if (blockerMessage) {
      return errorResult(blockerMessage);
    }

    await db.policy.delete({ where: { id } });

    await writeActivityLog({
      entityType: "Policy",
      entityId: id,
      action: "POLICY_DELETE",
      oldValue: { policyNumber: existingPolicy.policyNumber, clientId: existingPolicy.clientId },
      organizationId: context.organizationId,
    });

    revalidatePaths([
      "/policies",
      `/clients/${existingPolicy.clientId}`,
      "/dashboard",
      "/today",
      "/portfolio",
      "/renewals",
      "/risks",
    ]);

    return successResult(id, "/policies", "Póliza eliminada.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    return errorResult(error instanceof Error ? error.message : "No se pudo eliminar la póliza.");
  }
}
