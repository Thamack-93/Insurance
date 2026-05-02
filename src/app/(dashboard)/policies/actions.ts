"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { normalizeOptionalText, parseDateInput } from "@/lib/form-utils";
import { policySchema, type PolicyFormValues } from "@/lib/validations";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";

function normalizePolicyInput(values: PolicyFormValues) {
  return {
    policyNumber: values.policyNumber.trim(),
    clientId: values.clientId,
    insurerId: values.insurerId,
    policyType: values.policyType,
    status: values.status,
    startDate: parseDateInput(values.startDate),
    endDate: parseDateInput(values.endDate),
    renewalDate: values.renewalDate ? parseDateInput(values.renewalDate) : null,
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
    const policy = await db.policy.create({
      data: normalizePolicyInput(parsed.data),
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
    const previousPolicy = await db.policy.findUnique({ where: { id } });

    if (!previousPolicy) {
      return errorResult("La poliza ya no existe.");
    }

    const policy = await db.policy.update({
      where: { id },
      data: normalizePolicyInput(parsed.data),
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