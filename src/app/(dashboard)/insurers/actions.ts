"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
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
    const db = getDb();

    const insurer = await db.insurer.create({
      data: normalizeInsurerInput(values),
    });

    await writeActivityLog({
      action: "CREATE_INSURER",
      entityType: "Insurer",
      entityId: insurer.id,
      newValue: { name: insurer.name },
    });

    revalidatePaths(["/insurers", `/insurers/${insurer.id}`, "/dashboard"]);

    return successResult(insurer.id, `/insurers/${insurer.id}`, "Aseguradora creada exitosamente.");
  } catch (error) {
    logError("insurers.createInsurer", error);
    return errorResult("No se pudo crear la aseguradora. Intenta de nuevo.");
  }
}

export async function updateInsurer(id: string, values: InsurerFormValues): Promise<MutationResult> {
  try {
    const db = getDb();

    const existingInsurer = await db.insurer.findUnique({
      where: { id },
    });

    if (!existingInsurer) {
      return errorResult("Aseguradora no encontrada.");
    }

    const insurer = await db.insurer.update({
      where: { id },
      data: normalizeInsurerInput(values),
    });

    await writeActivityLog({
      action: "UPDATE_INSURER",
      entityType: "Insurer",
      entityId: insurer.id,
      oldValue: { name: existingInsurer.name },
      newValue: { name: insurer.name },
    });

    revalidatePaths(["/insurers", `/insurers/${insurer.id}`, "/dashboard"]);

    return successResult(insurer.id, `/insurers/${insurer.id}`, "Aseguradora actualizada exitosamente.");
  } catch (error) {
    logError("insurers.updateInsurer", error, { id });
    return errorResult("No se pudo actualizar la aseguradora. Intenta de nuevo.");
  }
}

export async function deleteInsurer(id: string): Promise<MutationResult> {
  try {
    const db = getDb();

    const existingInsurer = await db.insurer.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            policies: true,
            receipts: true,
            commissions: true,
            claims: true,
            quotes: true,
          },
        },
      },
    });

    if (!existingInsurer) {
      return errorResult("La aseguradora ya no existe.");
    }

    const counts = existingInsurer._count;
    const blockers: string[] = [];
    if (counts.policies > 0) blockers.push(`${counts.policies} póliza${counts.policies !== 1 ? "s" : ""}`);
    if (counts.receipts > 0) blockers.push(`${counts.receipts} recibo${counts.receipts !== 1 ? "s" : ""}`);
    if (counts.commissions > 0) blockers.push(`${counts.commissions} comisión${counts.commissions !== 1 ? "es" : ""}`);
    if (counts.claims > 0) blockers.push(`${counts.claims} siniestro${counts.claims !== 1 ? "s" : ""}`);
    if (counts.quotes > 0) blockers.push(`${counts.quotes} cotización${counts.quotes !== 1 ? "es" : ""}`);

    if (blockers.length > 0) {
      return errorResult(
        `No se puede eliminar: la aseguradora tiene ${blockers.join(", ")} asociado${blockers.length > 1 ? "s" : ""}. Archívala o reasigna primero.`,
      );
    }

    await db.insurer.delete({ where: { id } });

    await writeActivityLog({
      action: "DELETE_INSURER",
      entityType: "Insurer",
      entityId: id,
      oldValue: { name: existingInsurer.name },
    });

    revalidatePaths(["/insurers", "/dashboard"]);

    return successResult(id, "/insurers", "Aseguradora eliminada.");
  } catch (error) {
    logError("insurers.deleteInsurer", error, { id });
    return errorResult("No se pudo eliminar la aseguradora. Intenta de nuevo.");
  }
}
