"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { normalizeOptionalText } from "@/lib/form-utils";
import { clientSchema, type ClientFormValues } from "@/lib/validations";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";

function normalizeClientInput(values: ClientFormValues) {
  return {
    fullName: values.fullName.trim(),
    type: values.type,
    email: normalizeOptionalText(values.email),
    phone: normalizeOptionalText(values.phone),
    secondaryPhone: normalizeOptionalText(values.secondaryPhone),
    rfc: normalizeOptionalText(values.rfc),
    address: normalizeOptionalText(values.address),
    preferredContactMethod: normalizeOptionalText(values.preferredContactMethod),
    notes: normalizeOptionalText(values.notes),
    status: values.status,
  };
}

export async function createClient(values: ClientFormValues): Promise<MutationResult> {
  const parsed = clientSchema.safeParse(values);

  if (!parsed.success) {
    return errorResult(parsed.error.issues[0]?.message ?? "No se pudo validar el cliente.");
  }

  try {
    const db = getDb();
    const client = await db.client.create({
      data: normalizeClientInput(parsed.data),
    });

    await writeActivityLog({
      entityType: "Client",
      entityId: client.id,
      action: "CLIENT_CREATE",
      newValue: client,
    });

    revalidatePaths(["/clients", `/clients/${client.id}`, "/dashboard", "/today", "/portfolio", "/risks"]);

    return successResult(client.id, `/clients/${client.id}`, "Cliente creado.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo crear el cliente.");
  }
}

export async function updateClient(id: string, values: ClientFormValues): Promise<MutationResult> {
  const parsed = clientSchema.safeParse(values);

  if (!parsed.success) {
    return errorResult(parsed.error.issues[0]?.message ?? "No se pudo validar el cliente.");
  }

  try {
    const db = getDb();
    const previousClient = await db.client.findUnique({ where: { id } });

    if (!previousClient) {
      return errorResult("El cliente ya no existe.");
    }

    const client = await db.client.update({
      where: { id },
      data: normalizeClientInput(parsed.data),
    });

    await writeActivityLog({
      entityType: "Client",
      entityId: client.id,
      action: "CLIENT_UPDATE",
      oldValue: previousClient,
      newValue: client,
    });

    revalidatePaths(["/clients", `/clients/${client.id}`, "/dashboard", "/today", "/portfolio", "/risks"]);

    return successResult(client.id, `/clients/${client.id}`, "Cliente actualizado.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo actualizar el cliente.");
  }
}