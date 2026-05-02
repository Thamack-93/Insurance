"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { logError } from "@/lib/logger";
import type { ClaimFormValues } from "@/lib/validations";
import {
  errorResult,
  revalidatePaths,
  successResult,
  type MutationResult,
} from "@/lib/mutation-utils";

function normalizeClaimInput(values: ClaimFormValues) {
  return {
    folio: values.folio.trim(),
    clientId: values.clientId,
    policyId: values.policyId,
    insurerId: values.insurerId,
    claimType: values.claimType.trim(),
    description: values.description?.trim() || null,
    status: values.status,
    incidentDate: new Date(values.incidentDate),
    reportedDate: new Date(values.reportedDate),
    closedDate: values.closedDate ? new Date(values.closedDate) : null,
    amountClaimed: values.amountClaimed ?? null,
    amountPaid: values.amountPaid ?? null,
    notes: values.notes?.trim() || null,
  };
}

export async function createClaim(values: ClaimFormValues): Promise<MutationResult> {
  try {
    const db = getDb();

    const claim = await db.claim.create({
      data: normalizeClaimInput(values),
    });

    await writeActivityLog({
      action: "CREATE_CLAIM",
      entityType: "Claim",
      entityId: claim.id,
      newValue: { folio: claim.folio },
    });

    revalidatePaths([
      "/claims",
      `/claims/${claim.id}`,
      `/clients/${claim.clientId}`,
      `/policies/${claim.policyId}`,
      "/dashboard",
      "/today",
    ]);

    return successResult(claim.id, `/claims/${claim.id}`, "Siniestro creado exitosamente.");
  } catch (error) {
    logError("claims.createClaim", error);
    return errorResult("No se pudo crear el siniestro. Intenta de nuevo.");
  }
}

export async function updateClaim(id: string, values: ClaimFormValues): Promise<MutationResult> {
  try {
    const db = getDb();

    const existingClaim = await db.claim.findUnique({
      where: { id },
    });

    if (!existingClaim) {
      return errorResult("Siniestro no encontrado.");
    }

    const claim = await db.claim.update({
      where: { id },
      data: normalizeClaimInput(values),
    });

    await writeActivityLog({
      action: "UPDATE_CLAIM",
      entityType: "Claim",
      entityId: claim.id,
      oldValue: { folio: existingClaim.folio },
      newValue: { folio: claim.folio },
    });

    revalidatePaths([
      "/claims",
      `/claims/${claim.id}`,
      `/clients/${claim.clientId}`,
      `/policies/${claim.policyId}`,
      "/dashboard",
      "/today",
    ]);

    return successResult(claim.id, `/claims/${claim.id}`, "Siniestro actualizado exitosamente.");
  } catch (error) {
    logError("claims.updateClaim", error, { id });
    return errorResult("No se pudo actualizar el siniestro. Intenta de nuevo.");
  }
}
