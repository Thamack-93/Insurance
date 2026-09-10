"use server";

import { writeActivityLog } from "@/lib/activity-log";
import { AuthError } from "@/lib/auth";
import { normalizeOptionalText, parseDateInput } from "@/lib/form-utils";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";
import { assertEndorsementOrganizationAccess, assertPolicyOrganizationAccess } from "@/lib/portfolio-access";
import { assertOrganizationContextInTransaction, requireOrganizationContext, withTenantTransaction } from "@/lib/organization-context";
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
    const context = await requireOrganizationContext();
    const userId = context.userId;
    await assertPolicyOrganizationAccess(parsed.data.policyId, context);

    const policy = await withTenantTransaction(context, (tx) => tx.policy.findFirst({
      where: { id: parsed.data.policyId, organizationId: context.organizationId },
      select: { id: true, policyNumber: true, currency: true, clientId: true },
    }));

    if (!policy) {
      return errorResult("La poliza seleccionada ya no existe.");
    }

    const duplicate = await withTenantTransaction(context, (tx) => tx.policyEndorsement.findFirst({
      where: {
        organizationId: context.organizationId,
        policyId: policy.id,
        endorsementNumber: parsed.data.endorsementNumber.trim(),
      },
      select: { id: true },
    }));

    if (duplicate) {
      return errorResult("Ya existe un endoso con ese numero para esta poliza.");
    }

    const endorsement = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const currentPolicy = await tx.policy.findFirst({ where: { id: policy.id, organizationId: context.organizationId }, select: { id: true } });
      if (!currentPolicy) throw new AuthError("La póliza ya no pertenece a tu organización.", 403);
      const created = await tx.policyEndorsement.create({ data: { ...normalizeEndorsementInput(parsed.data, policy.currency), organizationId: context.organizationId, createdById: userId, updatedById: userId } });
      await writeActivityLog({ organizationId: context.organizationId, entityType: "PolicyEndorsement", entityId: created.id, action: "ENDORSEMENT_CREATE", newValue: created, userId, db: tx });
      return created;
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
    const context = await requireOrganizationContext();
    const userId = context.userId;
    await assertEndorsementOrganizationAccess(id, context);

    const existingEndorsement = await withTenantTransaction(context, (tx) => tx.policyEndorsement.findFirst({
      where: { id, organizationId: context.organizationId },
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
    }));

    if (!existingEndorsement) {
      return errorResult("El endoso ya no existe.");
    }

    if (parsed.data.policyId !== existingEndorsement.policyId) {
      return errorResult("No se puede mover un endoso a otra poliza desde esta pantalla.");
    }

    const duplicate = await withTenantTransaction(context, (tx) => tx.policyEndorsement.findFirst({
      where: {
        organizationId: context.organizationId,
        policyId: existingEndorsement.policyId,
        endorsementNumber: parsed.data.endorsementNumber.trim(),
        id: { not: id },
      },
      select: { id: true },
    }));

    if (duplicate) {
      return errorResult("Ya existe un endoso con ese numero para esta poliza.");
    }

    const updatedEndorsement = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const updated = await tx.policyEndorsement.update({ where: { id, organizationId: context.organizationId }, data: { ...normalizeEndorsementInput(parsed.data, existingEndorsement.policy.currency), policyId: existingEndorsement.policyId, updatedById: userId } });
      await writeActivityLog({ organizationId: context.organizationId, entityType: "PolicyEndorsement", entityId: updated.id, action: "ENDORSEMENT_UPDATE", oldValue: existingEndorsement, newValue: updated, userId, db: tx });
      return updated;
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
    const context = await requireOrganizationContext();
    const userId = context.userId;
    await assertEndorsementOrganizationAccess(id, context);

    const existingEndorsement = await withTenantTransaction(context, (tx) => tx.policyEndorsement.findFirst({
      where: { id, organizationId: context.organizationId },
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
    }));

    if (!existingEndorsement) {
      return errorResult("El endoso ya no existe.");
    }

    if (existingEndorsement.receipts.length > 0) {
      return errorResult("No se puede eliminar: el endoso tiene recibos asociados.");
    }

    if (existingEndorsement.documents.length > 0) {
      return errorResult("No se puede eliminar: el endoso tiene documentos asociados.");
    }

    await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      await tx.policyEndorsement.delete({ where: { id, organizationId: context.organizationId } });
      await writeActivityLog({ organizationId: context.organizationId, entityType: "PolicyEndorsement", entityId: id, action: "ENDORSEMENT_DELETE", oldValue: existingEndorsement, userId, db: tx });
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
