"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import type { ClaimFormValues } from "@/lib/validations";
import type { MutationResult } from "@/lib/mutation-utils";

export async function createClaim(values: ClaimFormValues): Promise<MutationResult> {
  try {
    const db = getDb();

    const claim = await db.claim.create({
      data: {
        folio: values.folio,
        clientId: values.clientId,
        policyId: values.policyId,
        insurerId: values.insurerId,
        claimType: values.claimType,
        description: values.description || null,
        status: values.status,
        incidentDate: new Date(values.incidentDate),
        reportedDate: new Date(values.reportedDate),
        closedDate: values.closedDate ? new Date(values.closedDate) : null,
        amountClaimed: values.amountClaimed ? values.amountClaimed : null,
        amountPaid: values.amountPaid ? values.amountPaid : null,
        notes: values.notes || null,
      },
    });

    await writeActivityLog({
      action: "CREATE_CLAIM",
      entityType: "Claim",
      entityId: claim.id,
      newValue: { folio: claim.folio },
    });

    return {
      ok: true,
      id: claim.id,
      redirectTo: `/claims/${claim.id}`,
      message: "Siniestro creado exitosamente.",
    };
  } catch (error) {
    console.error("Error creating claim:", error);
    return { ok: false, error: "No se pudo crear el siniestro. Intenta de nuevo." };
  }
}

export async function updateClaim(id: string, values: ClaimFormValues): Promise<MutationResult> {
  try {
    const db = getDb();

    const existingClaim = await db.claim.findUnique({
      where: { id },
    });

    if (!existingClaim) {
      return { ok: false, error: "Siniestro no encontrado." };
    }

    const claim = await db.claim.update({
      where: { id },
      data: {
        folio: values.folio,
        clientId: values.clientId,
        policyId: values.policyId,
        insurerId: values.insurerId,
        claimType: values.claimType,
        description: values.description || null,
        status: values.status,
        incidentDate: new Date(values.incidentDate),
        reportedDate: new Date(values.reportedDate),
        closedDate: values.closedDate ? new Date(values.closedDate) : null,
        amountClaimed: values.amountClaimed ? values.amountClaimed : null,
        amountPaid: values.amountPaid ? values.amountPaid : null,
        notes: values.notes || null,
      },
    });

    await writeActivityLog({
      action: "UPDATE_CLAIM",
      entityType: "Claim",
      entityId: claim.id,
      oldValue: { folio: existingClaim.folio },
      newValue: { folio: claim.folio },
    });

    return {
      ok: true,
      id: claim.id,
      redirectTo: `/claims/${claim.id}`,
      message: "Siniestro actualizado exitosamente.",
    };
  } catch (error) {
    console.error("Error updating claim:", error);
    return { ok: false, error: "No se pudo actualizar el siniestro. Intenta de nuevo." };
  }
}
