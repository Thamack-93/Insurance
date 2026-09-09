"use server";

import { getDb } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { writeActivityLog } from "@/lib/activity-log";
import { logError } from "@/lib/logger";
import { assertOrganizationContextInTransaction, requireOrganizationContext } from "@/lib/organization-context";
import { claimOperationalWhere } from "@/lib/portfolio-access";
import { CLAIM_CHECKLIST_STATUSES, type ClaimChecklistStatusValue, checklistTimestamps, createCustomClaimRequirementCode } from "@/lib/claim-checklists";
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

type ChecklistInput = { claimId: string };
type ChecklistStatusInput = ChecklistInput & { itemId: string; status: ClaimChecklistStatusValue; expectedUpdatedAt?: string };

async function findWritableClaim(tx: Prisma.TransactionClient, claimId: string, organizationId: string, portfolioOwnerId?: string) {
  return tx.claim.findFirst({ where: { id: claimId, ...claimOperationalWhere(portfolioOwnerId, organizationId) }, select: { id: true, status: true } });
}

export async function createClaimRequirement(claimId: string, label: string): Promise<MutationResult> {
  try {
    const context = await requireOrganizationContext();
    const normalized = label.trim();
    if (!normalized || normalized.length > 200) return errorResult("El requisito debe tener entre 1 y 200 caracteres.");
    const item = await getDb().$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const claim = await findWritableClaim(tx, claimId, context.organizationId, context.membershipRole === "AGENT" ? context.userId : undefined);
      if (!claim) throw new Error("CLAIM_NOT_FOUND");
      if (claim.status === "RESOLVED" || claim.status === "CANCELLED") throw new Error("CLAIM_TERMINAL");
      const created = await tx.claimChecklistItem.create({ data: { organizationId: context.organizationId, claimId, requirementCode: createCustomClaimRequirementCode(), label: normalized, status: "MISSING" } });
      await writeActivityLog({ organizationId: context.organizationId, action: "CREATE_CLAIM_REQUIREMENT", entityType: "Claim", entityId: claimId, newValue: { requirementCode: created.requirementCode, label: created.label, status: created.status }, userId: context.userId, db: tx });
      return created;
    });
    revalidatePaths([`/claims/${claimId}`, "/claims", "/operations"]);
    return successResult(item.id, `/claims/${claimId}`, "Requisito agregado.");
  } catch (error) {
    logError("claims.createClaimRequirement", error, { claimId });
    return errorResult("No se pudo agregar el requisito.");
  }
}

export async function updateClaimRequirementStatus(input: ChecklistStatusInput): Promise<MutationResult> {
  try {
    if (!CLAIM_CHECKLIST_STATUSES.includes(input.status)) return errorResult("Estado de requisito inválido.");
    const context = await requireOrganizationContext();
    const item = await getDb().$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const claim = await findWritableClaim(tx, input.claimId, context.organizationId, context.membershipRole === "AGENT" ? context.userId : undefined);
      if (!claim) throw new Error("CLAIM_NOT_FOUND");
      if (claim.status === "RESOLVED" || claim.status === "CANCELLED") throw new Error("CLAIM_TERMINAL");
      const current = await tx.claimChecklistItem.findFirst({ where: { id: input.itemId, claimId: input.claimId, organizationId: context.organizationId } });
      if (!current) throw new Error("REQUIREMENT_NOT_FOUND");
      if (input.expectedUpdatedAt && current.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new Error("STALE_REQUIREMENT");
      if (current.status === input.status) return current;
      const updated = await tx.claimChecklistItem.update({ where: { id: current.id }, data: { status: input.status, ...checklistTimestamps(input.status, new Date()) } });
      await writeActivityLog({ organizationId: context.organizationId, action: "UPDATE_CLAIM_REQUIREMENT", entityType: "Claim", entityId: input.claimId, oldValue: { requirementCode: current.requirementCode, label: current.label, status: current.status }, newValue: { requirementCode: updated.requirementCode, label: updated.label, status: updated.status }, userId: context.userId, db: tx });
      return updated;
    });
    revalidatePaths([`/claims/${input.claimId}`, "/claims", "/operations"]);
    return successResult(item.id, `/claims/${input.claimId}`, "Requisito actualizado.");
  } catch (error) {
    logError("claims.updateClaimRequirementStatus", error, { claimId: input.claimId, itemId: input.itemId });
    const message = error instanceof Error && error.message === "STALE_REQUIREMENT" ? "El requisito cambió; actualiza la página." : "No se pudo actualizar el requisito.";
    return errorResult(message);
  }
}

export async function deleteClaimRequirement(input: ChecklistInput & { itemId: string; expectedUpdatedAt?: string }): Promise<MutationResult> {
  try {
    const context = await requireOrganizationContext();
    await getDb().$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const claim = await findWritableClaim(tx, input.claimId, context.organizationId, context.membershipRole === "AGENT" ? context.userId : undefined);
      if (!claim) throw new Error("CLAIM_NOT_FOUND");
      if (claim.status === "RESOLVED" || claim.status === "CANCELLED") throw new Error("CLAIM_TERMINAL");
      const current = await tx.claimChecklistItem.findFirst({ where: { id: input.itemId, claimId: input.claimId, organizationId: context.organizationId } });
      if (!current || !current.requirementCode.startsWith("CUSTOM:")) throw new Error("REQUIREMENT_NOT_CUSTOM");
      if (input.expectedUpdatedAt && current.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new Error("STALE_REQUIREMENT");
      await tx.claimChecklistItem.delete({ where: { id: current.id } });
      await writeActivityLog({ organizationId: context.organizationId, action: "DELETE_CLAIM_REQUIREMENT", entityType: "Claim", entityId: input.claimId, oldValue: { requirementCode: current.requirementCode, label: current.label, status: current.status }, userId: context.userId, db: tx });
    });
    revalidatePaths([`/claims/${input.claimId}`, "/claims", "/operations"]);
    return successResult(input.itemId, `/claims/${input.claimId}`, "Requisito eliminado.");
  } catch (error) {
    logError("claims.deleteClaimRequirement", error, { claimId: input.claimId, itemId: input.itemId });
    return errorResult(error instanceof Error && error.message === "STALE_REQUIREMENT" ? "El requisito cambió; actualiza la página." : "No se pudo eliminar el requisito.");
  }
}

export async function setClaimRequirementDocument(input: ChecklistInput & { itemId: string; documentId: string | null; expectedUpdatedAt?: string }): Promise<MutationResult> {
  try {
    const context = await requireOrganizationContext();
    await getDb().$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const claim = await findWritableClaim(tx, input.claimId, context.organizationId, context.membershipRole === "AGENT" ? context.userId : undefined);
      if (!claim) throw new Error("CLAIM_NOT_FOUND");
      if (claim.status === "RESOLVED" || claim.status === "CANCELLED") throw new Error("CLAIM_TERMINAL");
      const current = await tx.claimChecklistItem.findFirst({ where: { id: input.itemId, claimId: input.claimId, organizationId: context.organizationId } });
      if (!current) throw new Error("REQUIREMENT_NOT_FOUND");
      if (input.expectedUpdatedAt && current.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new Error("STALE_REQUIREMENT");
      let documentId: string | null = null;
      if (input.documentId) {
        const document = await tx.document.findFirst({ where: { id: input.documentId, organizationId: context.organizationId, claimId: input.claimId }, select: { id: true } });
        if (!document) throw new Error("DOCUMENT_NOT_ELIGIBLE");
        documentId = document.id;
      }
      if (current.documentId === documentId) return;
      await tx.claimChecklistItem.update({ where: { id: current.id }, data: { documentId } });
      await writeActivityLog({ organizationId: context.organizationId, action: documentId ? "LINK_CLAIM_REQUIREMENT_DOCUMENT" : "UNLINK_CLAIM_REQUIREMENT_DOCUMENT", entityType: "Claim", entityId: input.claimId, oldValue: { requirementCode: current.requirementCode, documentId: current.documentId }, newValue: { requirementCode: current.requirementCode, documentId }, userId: context.userId, db: tx });
    });
    revalidatePaths([`/claims/${input.claimId}`]);
    return successResult(input.itemId, `/claims/${input.claimId}`, input.documentId ? "Documento vinculado." : "Documento desvinculado.");
  } catch (error) {
    logError("claims.setClaimRequirementDocument", error, { claimId: input.claimId, itemId: input.itemId });
    return errorResult(error instanceof Error && error.message === "STALE_REQUIREMENT" ? "El requisito cambió; actualiza la página." : "No se pudo vincular el documento.");
  }
}
