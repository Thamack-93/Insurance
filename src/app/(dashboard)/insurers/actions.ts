"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import type { InsurerFormValues } from "@/lib/validations";
import type { MutationResult } from "@/lib/mutation-utils";

export async function createInsurer(values: InsurerFormValues): Promise<MutationResult> {
  try {
    const db = getDb();

    const insurer = await db.insurer.create({
      data: {
        name: values.name,
        portalUrl: values.portalUrl || null,
        contactName: values.contactName || null,
        contactEmail: values.contactEmail || null,
        contactPhone: values.contactPhone || null,
        notes: values.notes || null,
        status: values.status,
      },
    });

    await writeActivityLog({
      action: "CREATE_INSURER",
      entityType: "Insurer",
      entityId: insurer.id,
      newValue: { name: insurer.name },
    });

    return {
      ok: true,
      id: insurer.id,
      redirectTo: `/insurers/${insurer.id}`,
      message: "Aseguradora creada exitosamente.",
    };
  } catch (error) {
    console.error("Error creating insurer:", error);
    return { ok: false, error: "No se pudo crear la aseguradora. Intenta de nuevo." };
  }
}

export async function updateInsurer(id: string, values: InsurerFormValues): Promise<MutationResult> {
  try {
    const db = getDb();

    const existingInsurer = await db.insurer.findUnique({
      where: { id },
    });

    if (!existingInsurer) {
      return { ok: false, error: "Aseguradora no encontrada." };
    }

    const insurer = await db.insurer.update({
      where: { id },
      data: {
        name: values.name,
        portalUrl: values.portalUrl || null,
        contactName: values.contactName || null,
        contactEmail: values.contactEmail || null,
        contactPhone: values.contactPhone || null,
        notes: values.notes || null,
        status: values.status,
      },
    });

    await writeActivityLog({
      action: "UPDATE_INSURER",
      entityType: "Insurer",
      entityId: insurer.id,
      oldValue: { name: existingInsurer.name },
      newValue: { name: insurer.name },
    });

    return {
      ok: true,
      id: insurer.id,
      redirectTo: `/insurers/${insurer.id}`,
      message: "Aseguradora actualizada exitosamente.",
    };
  } catch (error) {
    console.error("Error updating insurer:", error);
    return { ok: false, error: "No se pudo actualizar la aseguradora. Intenta de nuevo." };
  }
}
