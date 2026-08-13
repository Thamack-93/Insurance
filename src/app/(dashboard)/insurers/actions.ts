"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { AuthError } from "@/lib/auth";
import { assertOrganizationContextInTransaction, requireOrganizationRole } from "@/lib/organization-context";
import { logError } from "@/lib/logger";
import type { InsurerFormValues } from "@/lib/validations";
import {
  errorResult,
  revalidatePaths,
  successResult,
  type MutationResult,
} from "@/lib/mutation-utils";

function normalizeInsurerInput(values: InsurerFormValues) {
  return {
    name: values.name.trim(),
    portalUrl: values.portalUrl?.trim() || null,
    contactName: values.contactName?.trim() || null,
    contactEmail: values.contactEmail?.trim() || null,
    contactPhone: values.contactPhone?.trim() || null,
    notes: values.notes?.trim() || null,
    status: values.status,
  };
}

export async function createInsurer(values: InsurerFormValues): Promise<MutationResult> {
  try {
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
    const db = getDb();
    const insurer = await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
      const created = await tx.insurer.create({ data: { organizationId: context.organizationId, ...normalizeInsurerInput(values) } });
      await writeActivityLog({ organizationId: context.organizationId, action: "CREATE_INSURER", entityType: "Insurer", entityId: created.id, newValue: { name: created.name }, userId: context.userId, db: tx });
      return created;
    });

    revalidatePaths(["/insurers", `/insurers/${insurer.id}`, "/dashboard"]);

    return successResult(insurer.id, `/insurers/${insurer.id}`, "Aseguradora creada exitosamente.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    logError("insurers.createInsurer", error);
    return errorResult("No se pudo crear la aseguradora. Intenta de nuevo.");
  }
}

export async function updateInsurer(id: string, values: InsurerFormValues): Promise<MutationResult> {
  try {
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
    const db = getDb();
    const insurer = await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
      const existing = await tx.insurer.findFirst({ where: { id, organizationId: context.organizationId } });
      if (!existing) throw new Error("INSURER_NOT_FOUND");
      const updated = await tx.insurer.update({ where: { id }, data: normalizeInsurerInput(values) });
      await writeActivityLog({ organizationId: context.organizationId, action: "UPDATE_INSURER", entityType: "Insurer", entityId: updated.id, oldValue: { name: existing.name }, newValue: { name: updated.name }, userId: context.userId, db: tx });
      return updated;
    });

    revalidatePaths(["/insurers", `/insurers/${insurer.id}`, "/dashboard"]);

    return successResult(insurer.id, `/insurers/${insurer.id}`, "Aseguradora actualizada exitosamente.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    logError("insurers.updateInsurer", error, { id });
    return errorResult("No se pudo actualizar la aseguradora. Intenta de nuevo.");
  }
}

export async function deleteInsurer(id: string): Promise<MutationResult> {
  try {
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
    const db = getDb();
    const result = await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
      const existingInsurer = await tx.insurer.findFirst({
        where: { id, organizationId: context.organizationId },
        include: { _count: { select: { policies: true, receipts: true, commissions: true, claims: true, quotes: true } } },
      });
      if (!existingInsurer) throw new Error("INSURER_NOT_FOUND");

      const counts = existingInsurer._count;
      const blockers: string[] = [];
      if (counts.policies > 0) blockers.push(`${counts.policies} póliza${counts.policies !== 1 ? "s" : ""}`);
      if (counts.receipts > 0) blockers.push(`${counts.receipts} recibo${counts.receipts !== 1 ? "s" : ""}`);
      if (counts.commissions > 0) blockers.push(`${counts.commissions} comisión${counts.commissions !== 1 ? "es" : ""}`);
      if (counts.claims > 0) blockers.push(`${counts.claims} siniestro${counts.claims !== 1 ? "s" : ""}`);
      if (counts.quotes > 0) blockers.push(`${counts.quotes} cotización${counts.quotes !== 1 ? "es" : ""}`);

      if (blockers.length > 0) return { deleted: false as const, blockers };
      await tx.insurer.delete({ where: { id } });
      await writeActivityLog({ organizationId: context.organizationId, action: "DELETE_INSURER", entityType: "Insurer", entityId: id, oldValue: { name: existingInsurer.name }, userId: context.userId, db: tx });
      return { deleted: true as const, blockers: [] };
    });
    if (!result.deleted) return errorResult(`No se puede eliminar: la aseguradora tiene ${result.blockers.join(", ")} asociado${result.blockers.length > 1 ? "s" : ""}. Archívala o reasigna primero.`);

    revalidatePaths(["/insurers", "/dashboard"]);

    return successResult(id, "/insurers", "Aseguradora eliminada.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    logError("insurers.deleteInsurer", error, { id });
    return errorResult("No se pudo eliminar la aseguradora. Intenta de nuevo.");
  }
}
