"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { AuthError, getCurrentUserId } from "@/lib/auth";
import { normalizeOptionalText, parseDateInput } from "@/lib/form-utils";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";
import { assertEndorsementPortfolioAccess, assertPolicyPortfolioAccess } from "@/lib/portfolio-access";
import { endorsementSchema, type EndorsementFormValues } from "@/lib/validations";

function normalizeEndorsementInput(values: EndorsementFormValues, policyCurrency: string) {
  return {
    endorsementNumber: values.endorsementNumber.trim(),
    policyId: values.policyId,
    status: values.status,
    startDate: parseDateInput(values.startDate),
    endDate: parseDateInput(values.endDate),
    amount: values.amount,
    currency: values.currency || policyCurrency,
    reference: normalizeOptionalText(values.reference),
    concept: normalizeOptionalText(values.concept),
    notes: normalizeOptionalText(values.notes),
  };
}

export async function createEndorsement(values: EndorsementFormValues): Promise<MutationResult> {
  const parsed = endorsementSchema.safeParse(values);

  if (!parsed.success) {
    return errorResult(parsed.error.issues[0]?.message ?? "No se pudo validar el endoso.");
  }

  try {
    const db = getDb();
    const userId = await getCurrentUserId();
    await assertPolicyPortfolioAccess(parsed.data.policyId, userId);

    const policy = await db.policy.findUnique({
      where: { id: parsed.data.policyId },
      select: { id: true, policyNumber: true, currency: true, clientId: true },
    });

    if (!policy) {
      return errorResult("La poliza seleccionada ya no existe.");
    }

    const duplicate = await db.policyEndorsement.findFirst({
      where: {
        policyId: policy.id,
        endorsementNumber: parsed.data.endorsementNumber.trim(),
      },
      select: { id: true },
    });

    if (duplicate) {
      return errorResult("Ya existe un endoso con ese numero para esta poliza.");
    }

    const endorsement = await db.policyEndorsement.create({
      data: {
        ...normalizeEndorsementInput(parsed.data, policy.currency),
        createdById: userId,
        updatedById: userId,
      },
    });

    await writeActivityLog({
      entityType: "PolicyEndorsement",
      entityId: endorsement.id,
      action: "ENDORSEMENT_CREATE",
      newValue: endorsement,
    });

    revalidatePaths([
      `/policies/${policy.id}`,
      `/clients/${policy.clientId}`,
      "/receipts",
      "/due-payments",
      "/dashboard",
      "/today",
      "/portfolio",
      "/risks",
    ]);

    return successResult(endorsement.id, `/policies/${policy.id}`, "Endoso creado.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    return errorResult(error instanceof Error ? error.message : "No se pudo crear el endoso.");
  }
}

export async function updateEndorsement(id: string, values: EndorsementFormValues): Promise<MutationResult> {
  const parsed = endorsementSchema.safeParse(values);

  if (!parsed.success) {
    return errorResult(parsed.error.issues[0]?.message ?? "No se pudo validar el endoso.");
  }

  try {
    const db = getDb();
    const userId = await getCurrentUserId();
    await assertEndorsementPortfolioAccess(id, userId);

    const existingEndorsement = await db.policyEndorsement.findUnique({
      where: { id },
      select: {
        id: true,
        endorsementNumber: true,
        policyId: true,
        status: true,
        startDate: true,
        endDate: true,
        amount: true,
        currency: true,
        reference: true,
        concept: true,
        notes: true,
        policy: {
          select: {
            id: true,
            policyNumber: true,
            currency: true,
            clientId: true,
          },
        },
      },
    });

    if (!existingEndorsement) {
      return errorResult("El endoso ya no existe.");
    }

    if (parsed.data.policyId !== existingEndorsement.policyId) {
      return errorResult("No se puede mover un endoso a otra poliza desde esta pantalla.");
    }

    const duplicate = await db.policyEndorsement.findFirst({
      where: {
        policyId: existingEndorsement.policyId,
        endorsementNumber: parsed.data.endorsementNumber.trim(),
        id: { not: id },
      },
      select: { id: true },
    });

    if (duplicate) {
      return errorResult("Ya existe un endoso con ese numero para esta poliza.");
    }

    const updatedEndorsement = await db.policyEndorsement.update({
      where: { id },
      data: {
        ...normalizeEndorsementInput(parsed.data, existingEndorsement.policy.currency),
        policyId: existingEndorsement.policyId,
        updatedById: userId,
      },
    });

    await writeActivityLog({
      entityType: "PolicyEndorsement",
      entityId: updatedEndorsement.id,
      action: "ENDORSEMENT_UPDATE",
      oldValue: existingEndorsement,
      newValue: updatedEndorsement,
    });

    revalidatePaths([
      `/policies/${existingEndorsement.policyId}`,
      `/clients/${existingEndorsement.policy.clientId}`,
      "/receipts",
      "/due-payments",
      "/dashboard",
      "/today",
      "/portfolio",
      "/risks",
    ]);

    return successResult(updatedEndorsement.id, `/policies/${existingEndorsement.policyId}`, "Endoso actualizado.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    return errorResult(error instanceof Error ? error.message : "No se pudo actualizar el endoso.");
  }
}

export async function deleteEndorsement(id: string): Promise<MutationResult> {
  try {
    const db = getDb();
    const userId = await getCurrentUserId();
    await assertEndorsementPortfolioAccess(id, userId);

    const existingEndorsement = await db.policyEndorsement.findUnique({
      where: { id },
      include: {
        policy: {
          select: { id: true, clientId: true, policyNumber: true },
        },
        receipts: {
          select: { id: true, receiptNumber: true, payments: { where: { status: "POSTED" }, select: { id: true } } },
        },
        documents: {
          select: { id: true },
        },
      },
    });

    if (!existingEndorsement) {
      return errorResult("El endoso ya no existe.");
    }

    if (existingEndorsement.receipts.length > 0) {
      return errorResult("No se puede eliminar: el endoso tiene recibos asociados.");
    }

    if (existingEndorsement.documents.length > 0) {
      return errorResult("No se puede eliminar: el endoso tiene documentos asociados.");
    }

    await db.policyEndorsement.delete({ where: { id } });

    await writeActivityLog({
      entityType: "PolicyEndorsement",
      entityId: id,
      action: "ENDORSEMENT_DELETE",
      oldValue: existingEndorsement,
    });

    revalidatePaths([
      `/policies/${existingEndorsement.policyId}`,
      `/clients/${existingEndorsement.policy.clientId}`,
      "/receipts",
      "/due-payments",
      "/dashboard",
      "/today",
      "/portfolio",
      "/risks",
    ]);

    return successResult(id, `/policies/${existingEndorsement.policyId}`, "Endoso eliminado.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    return errorResult(error instanceof Error ? error.message : "No se pudo eliminar el endoso.");
  }
}
