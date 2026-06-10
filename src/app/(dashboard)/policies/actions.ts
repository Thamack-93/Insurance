"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { AuthError, getCurrentUserId, requireAdmin } from "@/lib/auth";
import { normalizeOptionalText, parseDateInput } from "@/lib/form-utils";
import { resolvePolicyFamilyRootId } from "@/lib/policy-families";
import { policySchema, type PolicyFormValues } from "@/lib/validations";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";
import { assertClientPortfolioAccess, assertPolicyPortfolioAccess } from "@/lib/portfolio-access";

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
  };
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
    const familyRootId = await resolvePolicyFamilyRootId({
      policyNumber: parsed.data.policyNumber.trim(),
      clientId: parsed.data.clientId,
      insurerId: parsed.data.insurerId,
    });
    const overlap = await db.policy.findFirst({
      where: {
        policyNumber: normalized.policyNumber,
        clientId: normalized.clientId,
        insurerId: normalized.insurerId,
        startDate: { lte: normalized.endDate },
        endDate: { gte: normalized.startDate },
      },
      select: { id: true },
    });
    if (overlap) {
      return errorResult("Ya existe una vigencia solapada para esta póliza. Revisa la familia antes de continuar.");
    }
    const policy = await db.policy.create({
      data: {
        ...normalized,
        familyRootId,
        createdById: userId,
        updatedById: userId,
      },
    });

    await writeActivityLog({
      entityType: "Policy",
      entityId: policy.id,
      action: "POLICY_CREATE",
      newValue: policy,
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
    await assertPolicyPortfolioAccess(id, userId);
    await assertClientPortfolioAccess(parsed.data.clientId, userId);
    const previousPolicy = await db.policy.findUnique({ where: { id } });

    if (!previousPolicy) {
      return errorResult("La poliza ya no existe.");
    }

    const policy = await db.policy.update({
      where: { id },
      data: { ...normalizePolicyInput(parsed.data), updatedById: userId },
    });

    await writeActivityLog({
      entityType: "Policy",
      entityId: policy.id,
      action: "POLICY_UPDATE",
      oldValue: previousPolicy,
      newValue: policy,
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
