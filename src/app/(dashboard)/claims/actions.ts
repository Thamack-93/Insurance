"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { logError } from "@/lib/logger";
import { assertOrganizationContextInTransaction, requireOrganizationContext } from "@/lib/organization-context";
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
    const context = await requireOrganizationContext();
    const claim = await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const client = await tx.client.findFirst({
        where: {
          id: values.clientId,
          organizationId: context.organizationId,
          ...(context.membershipRole === "AGENT" ? { portfolioOwnerId: context.userId } : {}),
        },
        select: { id: true },
      });
      const policy = await tx.policy.findFirst({
        where: { id: values.policyId, organizationId: context.organizationId, clientId: values.clientId, insurerId: values.insurerId },
        select: { id: true },
      });
      const insurer = await tx.insurer.findFirst({ where: { id: values.insurerId, organizationId: context.organizationId }, select: { id: true } });
      if (!client || !policy || !insurer) throw new Error("TENANT_RELATION_MISMATCH");
      const created = await tx.claim.create({
        data: { organizationId: context.organizationId, ...normalizeClaimInput(values), createdById: context.userId, updatedById: context.userId },
      });
      await writeActivityLog({
        organizationId: context.organizationId,
        action: "CREATE_CLAIM",
        entityType: "Claim",
        entityId: created.id,
        newValue: { folio: created.folio },
        userId: context.userId,
        db: tx,
      });
      return created;
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
    const context = await requireOrganizationContext();
    const claim = await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const existing = await tx.claim.findFirst({
        where: { id, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { client: { portfolioOwnerId: context.userId } } : {}) },
      });
      const client = await tx.client.findFirst({ where: { id: values.clientId, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { portfolioOwnerId: context.userId } : {}) }, select: { id: true } });
      const policy = await tx.policy.findFirst({ where: { id: values.policyId, organizationId: context.organizationId, clientId: values.clientId, insurerId: values.insurerId }, select: { id: true } });
      const insurer = await tx.insurer.findFirst({ where: { id: values.insurerId, organizationId: context.organizationId }, select: { id: true } });
      if (!existing) throw new Error("CLAIM_NOT_FOUND");
      if (!client || !policy || !insurer) throw new Error("TENANT_RELATION_MISMATCH");
      const updated = await tx.claim.update({ where: { id }, data: { ...normalizeClaimInput(values), updatedById: context.userId } });
      await writeActivityLog({
        organizationId: context.organizationId,
        action: "UPDATE_CLAIM",
        entityType: "Claim",
        entityId: updated.id,
        oldValue: { folio: existing.folio },
        newValue: { folio: updated.folio },
        userId: context.userId,
        db: tx,
      });
      return updated;
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
    const context = await requireOrganizationContext();
    const existingClaim = await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const existing = await tx.claim.findFirst({
        where: { id, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { client: { portfolioOwnerId: context.userId } } : {}) },
        include: { _count: { select: { documents: true } } },
      });
      if (!existing) throw new Error("CLAIM_NOT_FOUND");
      if (existing.status === "IN_PROGRESS" || existing.status === "WAITING_INSURER") throw new Error("CLAIM_IN_PROGRESS");
      await tx.claim.delete({ where: { id } });
      await writeActivityLog({
        organizationId: context.organizationId,
        action: "DELETE_CLAIM",
        entityType: "Claim",
        entityId: id,
        oldValue: { folio: existing.folio, clientId: existing.clientId, policyId: existing.policyId },
        userId: context.userId,
        db: tx,
      });
      return existing;
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
