"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { AuthError, getCurrentUser, getCurrentUserId, requireAdmin } from "@/lib/auth";
import { normalizeOptionalText, optionalRelationId, parseDateInput } from "@/lib/form-utils";
import { resolvePolicyFamilyRootId } from "@/lib/policy-families";
import type { Prisma } from "@/generated/prisma/client";
import { policySchema, type PolicyFormValues } from "@/lib/validations";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";
import { assertClientPortfolioAccess, assertPolicyPortfolioAccess } from "@/lib/portfolio-access";
import { buildPolicyNumberSearchVariants } from "@/lib/policy-number";

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
    const userId = await getCurrentUserId();
    await assertClientPortfolioAccess(parsed.data.clientId, userId);
    const normalized = normalizePolicyInput(parsed.data);
    const renewalSourceId = normalized.renewedFromPolicyId;
    const renewalSource = renewalSourceId
      ? await db.policy.findUnique({
          where: { id: renewalSourceId },
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
    const userId = await getCurrentUserId();
    const currentUser = await getCurrentUser();
    await assertPolicyPortfolioAccess(id, userId);
    await assertClientPortfolioAccess(parsed.data.clientId, userId);
    const previousPolicy = await db.policy.findUnique({ where: { id } });

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

      await assertPolicyPortfolioAccess(nextRenewedFromPolicyId, userId);
      nextRenewalSource = await db.policy.findUnique({
        where: { id: nextRenewedFromPolicyId },
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
            where: { id: nextRenewalSource.id },
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

      const finalPolicy = await tx.policy.findUnique({
        where: { id },
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
    const userId = await getCurrentUserId();
    await assertPolicyPortfolioAccess(id, userId);
    const previousPolicy = await db.policy.findUnique({
      where: { id },
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
    await requireAdmin();
    const db = getDb();

    const existingPolicy = await db.policy.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            receipts: true,
            endorsements: true,
            payments: true,
            commissions: true,
            claims: true,
          },
        },
      },
    });

    if (!existingPolicy) {
      return errorResult("La poliza ya no existe.");
    }

    const counts = existingPolicy._count;
    const blockers: string[] = [];
    if (counts.receipts > 0) blockers.push(`${counts.receipts} recibo${counts.receipts !== 1 ? "s" : ""}`);
    if (counts.endorsements > 0) blockers.push(`${counts.endorsements} endoso${counts.endorsements !== 1 ? "s" : ""}`);
    if (counts.payments > 0) blockers.push(`${counts.payments} pago${counts.payments !== 1 ? "s" : ""}`);
    if (counts.commissions > 0) blockers.push(`${counts.commissions} comisión${counts.commissions !== 1 ? "es" : ""}`);
    if (counts.claims > 0) blockers.push(`${counts.claims} siniestro${counts.claims !== 1 ? "s" : ""}`);

    if (blockers.length > 0) {
      return errorResult(
        `No se puede eliminar: la póliza tiene ${blockers.join(", ")} asociado${blockers.length > 1 ? "s" : ""}. Cancélala o elimina primero esos registros.`,
      );
    }

    await db.policy.delete({ where: { id } });

    await writeActivityLog({
      entityType: "Policy",
      entityId: id,
      action: "POLICY_DELETE",
      oldValue: { policyNumber: existingPolicy.policyNumber, clientId: existingPolicy.clientId },
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
