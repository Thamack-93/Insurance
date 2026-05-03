"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { getCurrentUserId } from "@/lib/auth";
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
    const userId = await getCurrentUserId();
    const client = await db.client.create({
      data: { ...normalizeClientInput(parsed.data), createdById: userId, updatedById: userId },
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

    const userId = await getCurrentUserId();
    const client = await db.client.update({
      where: { id },
      data: { ...normalizeClientInput(parsed.data), updatedById: userId },
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
export async function deleteClient(id: string): Promise<MutationResult> {
  try {
    const db = getDb();

    const existingClient = await db.client.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            policies: true,
            receipts: true,
            payments: true,
            commissions: true,
            claims: true,
            quotes: true,
          },
        },
      },
    });

    if (!existingClient) {
      return errorResult("El cliente ya no existe.");
    }

    const counts = existingClient._count;
    const blockers: string[] = [];
    if (counts.policies > 0) blockers.push(`${counts.policies} póliza${counts.policies !== 1 ? "s" : ""}`);
    if (counts.receipts > 0) blockers.push(`${counts.receipts} recibo${counts.receipts !== 1 ? "s" : ""}`);
    if (counts.payments > 0) blockers.push(`${counts.payments} pago${counts.payments !== 1 ? "s" : ""}`);
    if (counts.commissions > 0) blockers.push(`${counts.commissions} comisión${counts.commissions !== 1 ? "es" : ""}`);
    if (counts.claims > 0) blockers.push(`${counts.claims} siniestro${counts.claims !== 1 ? "s" : ""}`);
    if (counts.quotes > 0) blockers.push(`${counts.quotes} cotización${counts.quotes !== 1 ? "es" : ""}`);

    if (blockers.length > 0) {
      return errorResult(
        `No se puede eliminar: el cliente tiene ${blockers.join(", ")} asociado${blockers.length > 1 ? "s" : ""}. Archívalo o elimina primero esos registros.`,
      );
    }

    await db.client.delete({ where: { id } });

    await writeActivityLog({
      entityType: "Client",
      entityId: id,
      action: "CLIENT_DELETE",
      oldValue: { fullName: existingClient.fullName },
    });

    revalidatePaths(["/clients", "/dashboard", "/today", "/portfolio", "/risks"]);

    return successResult(id, "/clients", "Cliente eliminado.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo eliminar el cliente.");
  }
}
