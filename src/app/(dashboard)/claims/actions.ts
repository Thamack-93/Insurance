"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { getCurrentUserId } from "@/lib/auth";
import { logError } from "@/lib/logger";
import {
  assertClaimPortfolioAccess,
  assertClientPortfolioAccess,
  assertPolicyPortfolioAccess,
} from "@/lib/portfolio-access";
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

    const userId = await getCurrentUserId();
    await assertClientPortfolioAccess(values.clientId, userId);
    await assertPolicyPortfolioAccess(values.policyId, userId);
    const relatedPolicy = await db.policy.findFirst({
      where: { id: values.policyId, clientId: values.clientId, insurerId: values.insurerId },
      select: { id: true },
    });
    if (!relatedPolicy) return errorResult("La póliza, el cliente y la aseguradora no corresponden al mismo registro.");
    const claim = await db.claim.create({
      data: { ...normalizeClaimInput(values), createdById: userId, updatedById: userId },
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
    const userId = await getCurrentUserId();
    await assertClaimPortfolioAccess(id, userId);
    await assertClientPortfolioAccess(values.clientId, userId);
    await assertPolicyPortfolioAccess(values.policyId, userId);
    const relatedPolicy = await db.policy.findFirst({
      where: { id: values.policyId, clientId: values.clientId, insurerId: values.insurerId },
      select: { id: true },
    });
    if (!relatedPolicy) return errorResult("La póliza, el cliente y la aseguradora no corresponden al mismo registro.");

    const existingClaim = await db.claim.findUnique({
      where: { id },
    });

    if (!existingClaim) {
      return errorResult("Siniestro no encontrado.");
    }

    const claim = await db.claim.update({
      where: { id },
      data: { ...normalizeClaimInput(values), updatedById: userId },
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

export async function deleteClaim(id: string): Promise<MutationResult> {
  try {
    const db = getDb();
    const userId = await getCurrentUserId();
    await assertClaimPortfolioAccess(id, userId);

    const existingClaim = await db.claim.findUnique({
      where: { id },
      include: { _count: { select: { documents: true } } },
    });

    if (!existingClaim) {
      return errorResult("El siniestro ya no existe.");
    }

    if (existingClaim.status === "IN_PROGRESS" || existingClaim.status === "WAITING_INSURER") {
      return errorResult(
        "No se puede eliminar: el siniestro está en proceso. Ciérralo o cancélalo antes de eliminarlo.",
      );
    }

    await db.claim.delete({ where: { id } });

    await writeActivityLog({
      action: "DELETE_CLAIM",
      entityType: "Claim",
      entityId: id,
      oldValue: {
        folio: existingClaim.folio,
        clientId: existingClaim.clientId,
        policyId: existingClaim.policyId,
      },
    });

    revalidatePaths([
      "/claims",
      `/clients/${existingClaim.clientId}`,
      `/policies/${existingClaim.policyId}`,
      "/dashboard",
      "/today",
    ]);

    return successResult(id, "/claims", "Siniestro eliminado.");
  } catch (error) {
    logError("claims.deleteClaim", error, { id });
    return errorResult("No se pudo eliminar el siniestro. Intenta de nuevo.");
  }
}
