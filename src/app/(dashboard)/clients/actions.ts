"use server";

import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { AuthError, getCurrentUserId, requireAdmin } from "@/lib/auth";
import { normalizeOptionalText, optionalRelationId } from "@/lib/form-utils";
import { NO_REFERIDOR_VALUE } from "@/lib/constants";
import { clientSchema, type ClientFormValues } from "@/lib/validations";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";

function normalizeClientInput(values: ClientFormValues) {
  const referidorId = optionalRelationId(values.referidorId);
  return {
    fullName: values.fullName.trim(),
    type: values.type,
    email: normalizeOptionalText(values.email),
    phone: normalizeOptionalText(values.phone),
    secondaryPhone: normalizeOptionalText(values.secondaryPhone),
    rfc: normalizeOptionalText(values.rfc),
    address: normalizeOptionalText(values.address),
    preferredContactMethod: normalizeOptionalText(values.preferredContactMethod),
    referidorId: referidorId && referidorId !== NO_REFERIDOR_VALUE ? referidorId : null,
    notes: normalizeOptionalText(values.notes),
    status: values.status,
  };
}

async function ensureValidReferidor(
  db: ReturnType<typeof getDb>,
  referidorId: string | null,
  currentClientId?: string,
) {
  if (!referidorId) {
    return null;
  }

  if (currentClientId && referidorId === currentClientId) {
    throw new Error("Un cliente no puede ser su propio referidor.");
  }

  const referidor = await db.client.findUnique({
    where: { id: referidorId },
    select: { id: true, referidorId: true },
  });

  if (!referidor) {
    throw new Error("El referidor seleccionado no existe.");
  }

  if (!currentClientId) {
    return referidor.id;
  }

  const visited = new Set<string>([currentClientId]);
  let cursor = referidor;
  let depth = 0;

  while (cursor.referidorId) {
    if (visited.has(cursor.referidorId)) {
      throw new Error("La relación de referidor generaría un ciclo.");
    }

    visited.add(cursor.referidorId);
    const next = await db.client.findUnique({
      where: { id: cursor.referidorId },
      select: { id: true, referidorId: true },
    });

    if (!next) {
      break;
    }

    cursor = next;
    depth += 1;

    if (depth > 20) {
      throw new Error("La cadena de referidores es demasiado profunda.");
    }
  }

  return referidor.id;
}

function collectRevalidatePaths(currentClientId: string, referidorIds: Array<string | null | undefined>) {
  const paths = new Set<string>(["/clients", `/clients/${currentClientId}`, "/dashboard", "/today", "/portfolio", "/risks"]);

  for (const id of referidorIds) {
    if (id) {
      paths.add(`/clients/${id}`);
    }
  }

  return Array.from(paths);
}

export async function createClient(values: ClientFormValues): Promise<MutationResult> {
  const parsed = clientSchema.safeParse(values);

  if (!parsed.success) {
    return errorResult(parsed.error.issues[0]?.message ?? "No se pudo validar el cliente.");
  }

  try {
    const db = getDb();
    const userId = await getCurrentUserId();
    const normalized = normalizeClientInput(parsed.data);
    normalized.referidorId = await ensureValidReferidor(db, normalized.referidorId);
    const client = await db.client.create({
      data: { ...normalized, createdById: userId, updatedById: userId },
    });

    await writeActivityLog({
      entityType: "Client",
      entityId: client.id,
      action: "CLIENT_CREATE",
      newValue: client,
    });

    revalidatePaths(collectRevalidatePaths(client.id, [client.referidorId]));

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
    const normalized = normalizeClientInput(parsed.data);
    normalized.referidorId = await ensureValidReferidor(db, normalized.referidorId, id);
    const client = await db.client.update({
      where: { id },
      data: { ...normalized, updatedById: userId },
    });
    const referidos = await db.client.findMany({
      where: { referidorId: id },
      select: { id: true },
    });

    await writeActivityLog({
      entityType: "Client",
      entityId: client.id,
      action: "CLIENT_UPDATE",
      oldValue: previousClient,
      newValue: client,
    });

    revalidatePaths(
      collectRevalidatePaths(client.id, [previousClient.referidorId, client.referidorId, ...referidos.map((item) => item.id)]),
    );

    return successResult(client.id, `/clients/${client.id}`, "Cliente actualizado.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo actualizar el cliente.");
  }
}
export async function deleteClient(id: string): Promise<MutationResult> {
  try {
    await requireAdmin();
    const db = getDb();

    const existingClient = await db.client.findUnique({
      where: { id },
      include: {
        referidor: { select: { id: true } },
        referidos: { select: { id: true } },
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

    revalidatePaths(
      collectRevalidatePaths(id, [existingClient.referidor?.id, ...existingClient.referidos.map((client) => client.id)]),
    );

    return successResult(id, "/clients", "Cliente eliminado.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    return errorResult(error instanceof Error ? error.message : "No se pudo eliminar el cliente.");
  }
}
