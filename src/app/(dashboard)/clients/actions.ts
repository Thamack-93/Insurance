"use server";

import { writeActivityLog } from "@/lib/activity-log";
import { AuthError } from "@/lib/auth";
import { normalizeOptionalText, optionalRelationId, parseDateInput } from "@/lib/form-utils";
import { NO_REFERIDOR_VALUE } from "@/lib/constants";
import { clientSchema, type ClientFormValues } from "@/lib/validations";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";
import {
  assertOrganizationContextInTransaction,
  requireOrganizationContext,
  requireOrganizationRole,
  withTenantTransaction,
} from "@/lib/organization-context";
import { OPEN_WORK_ITEM_STATUSES } from "@/lib/work-queue";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

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
    birthDate: values.type === "PERSON" && values.birthDate ? parseDateInput(values.birthDate) : null,
    preferredContactMethod: normalizeOptionalText(values.preferredContactMethod),
    referidorId: referidorId && referidorId !== NO_REFERIDOR_VALUE ? referidorId : null,
    notes: normalizeOptionalText(values.notes),
    status: values.status,
  };
}

function mergeClientMetadata(target: {
  type: string;
  email: string | null;
  phone: string | null;
  secondaryPhone: string | null;
  rfc: string | null;
  address: string | null;
  birthDate: Date | null;
  preferredContactMethod: string | null;
  notes: string | null;
  portfolioOwnerId: string | null;
}, source: {
  type: string;
  email: string | null;
  phone: string | null;
  secondaryPhone: string | null;
  rfc: string | null;
  address: string | null;
  birthDate: Date | null;
  preferredContactMethod: string | null;
  notes: string | null;
  portfolioOwnerId: string | null;
}) {
  return {
    type: target.type === "PERSON" && source.type !== "PERSON" ? source.type : target.type,
    email: target.email ?? source.email,
    phone: target.phone ?? source.phone,
    secondaryPhone: target.secondaryPhone ?? source.secondaryPhone,
    rfc: target.rfc ?? source.rfc,
    address: target.address ?? source.address,
    birthDate: target.birthDate ?? source.birthDate,
    preferredContactMethod: target.preferredContactMethod ?? source.preferredContactMethod,
    notes: target.notes ?? source.notes,
    portfolioOwnerId: target.portfolioOwnerId ?? source.portfolioOwnerId,
  };
}

function appendConsolidationNote(current: string | null, details: string) {
  const note = `Consolidado desde ${details}`;
  if (!current?.trim()) return note;
  if (current.includes(note)) return current;
  return `${current.trim()}\n\n${note}`;
}

async function ensureValidReferidor(
  db: PrismaClient | Prisma.TransactionClient,
  referidorId: string | null,
  currentClientId?: string,
  organizationId?: string,
) {
  if (!referidorId) {
    return null;
  }

  if (currentClientId && referidorId === currentClientId) {
    throw new Error("Un cliente no puede ser su propio referidor.");
  }

  const referidor = await db.client.findFirst({
    where: { id: referidorId, ...(organizationId ? { organizationId } : {}) },
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
    const next = await db.client.findFirst({
      where: { id: cursor.referidorId, ...(organizationId ? { organizationId } : {}) },
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
    const context = await requireOrganizationContext();
    const userId = context.userId;
    const normalized = normalizeClientInput(parsed.data);
    const client = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      normalized.referidorId = await ensureValidReferidor(tx, normalized.referidorId, undefined, context.organizationId);
      const created = await tx.client.create({
        data: {
          ...normalized,
          organizationId: context.organizationId,
          portfolioOwnerId: userId,
          createdById: userId,
          updatedById: userId,
        },
      });
      await writeActivityLog({
        entityType: "Client",
        entityId: created.id,
        action: "CLIENT_CREATE",
        newValue: created,
        userId,
        organizationId: context.organizationId,
        db: tx,
      });
      return created;
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
    const context = await requireOrganizationContext();
    const userId = context.userId;
    const ownerScope = context.membershipRole === "AGENT" ? { portfolioOwnerId: context.userId } : {};
    const normalized = normalizeClientInput(parsed.data);
    const result = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const previousClient = await tx.client.findFirst({
        where: { id, organizationId: context.organizationId, ...ownerScope },
      });
      if (!previousClient) return null;
      normalized.referidorId = await ensureValidReferidor(tx, normalized.referidorId, id, context.organizationId);
      const updated = await tx.client.updateMany({
        where: { id, organizationId: context.organizationId, ...ownerScope },
        data: { ...normalized, updatedById: userId },
      });
      if (updated.count !== 1) return null;
      const client = await tx.client.findFirstOrThrow({
        where: { id, organizationId: context.organizationId, ...ownerScope },
      });
      await writeActivityLog({
        entityType: "Client",
        entityId: client.id,
        action: "CLIENT_UPDATE",
        oldValue: previousClient,
        newValue: client,
        userId,
        organizationId: context.organizationId,
        db: tx,
      });
      return { client, previousClient };
    });
    if (!result) return errorResult("El cliente ya no existe o no está disponible.");
    const { client, previousClient } = result;
    const referidos = await withTenantTransaction(context, (tx) => tx.client.findMany({
      where: { referidorId: id, organizationId: context.organizationId },
      select: { id: true },
    }));

    revalidatePaths(
      collectRevalidatePaths(client.id, [previousClient.referidorId, client.referidorId, ...referidos.map((item) => item.id)]),
    );

    return successResult(client.id, `/clients/${client.id}`, "Cliente actualizado.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo actualizar el cliente.");
  }
}

export async function updateClientQualityFields(
  id: string,
  values: {
    email?: string;
    phone?: string;
    secondaryPhone?: string;
    rfc?: string;
    address?: string;
    birthDate?: string;
    preferredContactMethod?: string;
    notes?: string;
  },
): Promise<MutationResult> {
  try {
    const context = await requireOrganizationContext();
    const userId = context.userId;
    const ownerScope = context.membershipRole === "AGENT" ? { portfolioOwnerId: context.userId } : {};
    const client = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const previousClient = await tx.client.findFirst({
        where: { id, organizationId: context.organizationId, ...ownerScope },
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          secondaryPhone: true,
          rfc: true,
          address: true,
          birthDate: true,
          preferredContactMethod: true,
          notes: true,
          status: true,
          type: true,
        },
      });
      if (!previousClient) return null;
      const updated = await tx.client.updateMany({
        where: { id, organizationId: context.organizationId, ...ownerScope },
        data: {
          ...(values.email !== undefined ? { email: normalizeOptionalText(values.email) } : {}),
          ...(values.phone !== undefined ? { phone: normalizeOptionalText(values.phone) } : {}),
          ...(values.secondaryPhone !== undefined ? { secondaryPhone: normalizeOptionalText(values.secondaryPhone) } : {}),
          ...(values.rfc !== undefined ? { rfc: normalizeOptionalText(values.rfc) } : {}),
          ...(values.address !== undefined ? { address: normalizeOptionalText(values.address) } : {}),
          ...(values.birthDate !== undefined ? { birthDate: values.birthDate ? parseDateInput(values.birthDate) : null } : {}),
          ...(values.preferredContactMethod !== undefined
            ? { preferredContactMethod: normalizeOptionalText(values.preferredContactMethod) }
            : {}),
          ...(values.notes !== undefined ? { notes: normalizeOptionalText(values.notes) } : {}),
          updatedById: userId,
        },
      });
      if (updated.count !== 1) return null;
      const current = await tx.client.findFirstOrThrow({
        where: { id, organizationId: context.organizationId, ...ownerScope },
      });
      await writeActivityLog({
        entityType: "Client",
        entityId: current.id,
        action: "CLIENT_QUALITY_UPDATE",
        oldValue: previousClient,
        newValue: current,
        userId,
        organizationId: context.organizationId,
        db: tx,
      });
      return current;
    });
    if (!client) return errorResult("El cliente ya no existe o no está disponible.");

    revalidatePaths([
      "/clients",
      `/clients/${client.id}`,
      "/dashboard",
      "/today",
      "/portfolio",
      "/risks",
      "/data-quality",
    ]);

    return successResult(client.id, `/clients/${client.id}`, "Datos de calidad actualizados.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo actualizar la calidad del cliente.");
  }
}

export async function consolidateClientIntoTarget(
  sourceClientId: string,
  targetClientId: string,
  reason: string,
): Promise<MutationResult> {
  try {
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
    if (sourceClientId === targetClientId) {
      return errorResult("Selecciona un cliente distinto para consolidar.");
    }

    const sourceClient = await withTenantTransaction(context, (tx) => tx.client.findFirst({
      where: { id: sourceClientId, organizationId: context.organizationId },
      select: {
        id: true,
        fullName: true,
        type: true,
        email: true,
        phone: true,
        secondaryPhone: true,
        rfc: true,
        address: true,
        birthDate: true,
        preferredContactMethod: true,
        notes: true,
        portfolioOwnerId: true,
        status: true,
      },
    }));
    const targetClient = await withTenantTransaction(context, (tx) => tx.client.findFirst({
      where: { id: targetClientId, organizationId: context.organizationId },
      select: {
        id: true,
        fullName: true,
        type: true,
        email: true,
        phone: true,
        secondaryPhone: true,
        rfc: true,
        address: true,
        birthDate: true,
        preferredContactMethod: true,
        notes: true,
        portfolioOwnerId: true,
        status: true,
      },
    }));

    if (!sourceClient) {
      return errorResult("El cliente origen ya no existe.");
    }
    if (!targetClient) {
      return errorResult("El cliente destino ya no existe.");
    }

    const cleanedReason = reason.trim();
    const summaryReason = cleanedReason || `Consolidación manual hacia ${targetClient.fullName}.`;

    await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
      const mergedMetadata = mergeClientMetadata(targetClient, sourceClient);
      await tx.client.update({
        where: { id: targetClient.id },
        data: {
          ...mergedMetadata,
          notes: appendConsolidationNote(targetClient.notes, `${sourceClient.fullName}`),
          status: "ACTIVE",
          updatedById: context.userId,
        },
      });

      await tx.policy.updateMany({ where: { clientId: sourceClient.id, organizationId: context.organizationId }, data: { clientId: targetClient.id } });
      await tx.receipt.updateMany({ where: { clientId: sourceClient.id, organizationId: context.organizationId }, data: { clientId: targetClient.id } });
      await tx.payment.updateMany({ where: { clientId: sourceClient.id, organizationId: context.organizationId }, data: { clientId: targetClient.id } });
      await tx.commission.updateMany({ where: { clientId: sourceClient.id, organizationId: context.organizationId }, data: { clientId: targetClient.id } });
      await tx.claim.updateMany({ where: { clientId: sourceClient.id, organizationId: context.organizationId }, data: { clientId: targetClient.id } });
      await tx.quote.updateMany({ where: { clientId: sourceClient.id, organizationId: context.organizationId }, data: { clientId: targetClient.id } });
      await tx.document.updateMany({ where: { clientId: sourceClient.id, organizationId: context.organizationId }, data: { clientId: targetClient.id } });
      await tx.workItem.updateMany({ where: { clientId: sourceClient.id, organizationId: context.organizationId }, data: { clientId: targetClient.id } });
      await tx.notificationEvent.updateMany({ where: { clientId: sourceClient.id, organizationId: context.organizationId }, data: { clientId: targetClient.id } });
      await tx.client.updateMany({ where: { referidorId: sourceClient.id, organizationId: context.organizationId }, data: { referidorId: targetClient.id } });

      await tx.client.update({
        where: { id: sourceClient.id },
        data: {
          status: "ARCHIVED",
          notes: appendConsolidationNote(sourceClient.notes, `fusionado con ${targetClient.fullName}`),
          updatedById: context.userId,
        },
      });

      const openWorkItems = await tx.workItem.findMany({
        where: {
          clientId: targetClient.id,
          organizationId: context.organizationId,
          status: { in: [...OPEN_WORK_ITEM_STATUSES] },
        },
        select: { id: true },
      });

      await writeActivityLog({
        entityType: "Client",
        entityId: sourceClient.id,
        action: "CLIENT_CONSOLIDATED",
        oldValue: sourceClient,
        newValue: {
          targetClientId: targetClient.id,
          targetClientName: targetClient.fullName,
          reason: summaryReason,
          openWorkItemsOnTarget: openWorkItems.length,
        },
        userId: context.userId,
        organizationId: context.organizationId,
        db: tx,
      });
    });

    revalidatePaths([
      "/clients",
      `/clients/${sourceClient.id}`,
      `/clients/${targetClient.id}`,
      "/dashboard",
      "/today",
      "/portfolio",
      "/risks",
      "/data-quality",
    ]);

    return successResult(sourceClient.id, `/clients/${targetClient.id}`, "Cliente consolidado.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    return errorResult(error instanceof Error ? error.message : "No se pudo consolidar el cliente.");
  }
}
export async function bulkArchiveClients(ids: string[]): Promise<MutationResult> {
  try {
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
    const scopedIds = Array.from(new Set(ids.filter((id) => typeof id === "string" && id.length > 0)));
    if (scopedIds.length === 0) return errorResult("Selecciona al menos un cliente para archivar.");
    const ownerScope = context.membershipRole === "AGENT" ? { portfolioOwnerId: context.userId } : {};
    const result = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
      const updated = await tx.client.updateMany({
        where: { id: { in: scopedIds }, organizationId: context.organizationId, ...ownerScope },
        data: { status: "INACTIVE", updatedById: context.userId },
      });
      await writeActivityLog({
        action: "BULK_UPDATE_STATUS",
        entityType: "CLIENT",
        entityId: scopedIds.join(","),
        newValue: { status: "INACTIVE", count: updated.count },
        userId: context.userId,
        organizationId: context.organizationId,
        db: tx,
      });
      return updated;
    });
    revalidatePaths(["/clients"]);
    return successResult("", "/clients", `Estado actualizado para ${result.count} clientes.`);
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    return errorResult(error instanceof Error ? error.message : "No se pudo archivar los clientes.");
  }
}

export async function deleteClient(id: string): Promise<MutationResult> {
  try {
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
    const result = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
      const existingClient = await tx.client.findFirst({
        where: { id, organizationId: context.organizationId },
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
      if (!existingClient) return { status: "missing" as const };

      const counts = existingClient._count;
      const blockers: string[] = [];
      if (counts.policies > 0) blockers.push(`${counts.policies} póliza${counts.policies !== 1 ? "s" : ""}`);
      if (counts.receipts > 0) blockers.push(`${counts.receipts} recibo${counts.receipts !== 1 ? "s" : ""}`);
      if (counts.payments > 0) blockers.push(`${counts.payments} pago${counts.payments !== 1 ? "s" : ""}`);
      if (counts.commissions > 0) blockers.push(`${counts.commissions} comisión${counts.commissions !== 1 ? "es" : ""}`);
      if (counts.claims > 0) blockers.push(`${counts.claims} siniestro${counts.claims !== 1 ? "s" : ""}`);
      if (counts.quotes > 0) blockers.push(`${counts.quotes} cotización${counts.quotes !== 1 ? "es" : ""}`);
      if (blockers.length > 0) return { status: "blocked" as const, blockers };

      const deleted = await tx.client.deleteMany({ where: { id, organizationId: context.organizationId } });
      if (deleted.count !== 1) return { status: "missing" as const };
      await writeActivityLog({
        entityType: "Client",
        entityId: id,
        action: "CLIENT_DELETE",
        oldValue: { fullName: existingClient.fullName },
        userId: context.userId,
        organizationId: context.organizationId,
        db: tx,
      });
      return { status: "deleted" as const, existingClient };
    });

    if (result.status === "missing") return errorResult("El cliente ya no existe.");
    if (result.status === "blocked") {
      return errorResult(
        `No se puede eliminar: el cliente tiene ${result.blockers.join(", ")} asociado${result.blockers.length > 1 ? "s" : ""}. Archívalo o elimina primero esos registros.`,
      );
    }
    const { existingClient } = result;

    revalidatePaths(
      collectRevalidatePaths(id, [existingClient.referidor?.id, ...existingClient.referidos.map((client) => client.id)]),
    );

    return successResult(id, "/clients", "Cliente eliminado.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    return errorResult(error instanceof Error ? error.message : "No se pudo eliminar el cliente.");
  }
}

export async function reassignClientPortfolio(input: {
  clientId: string;
  portfolioOwnerId: string;
  reason: string;
}): Promise<MutationResult> {
  try {
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
    const reason = input.reason.trim();
    if (!reason) return errorResult("Captura el motivo de la reasignación.");

    const result = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
      const [client, ownerMembership] = await Promise.all([
        tx.client.findFirst({
          where: { id: input.clientId, organizationId: context.organizationId },
          select: { id: true, fullName: true, portfolioOwnerId: true },
        }),
        tx.organizationMembership.findFirst({
          where: {
            organizationId: context.organizationId,
            userId: input.portfolioOwnerId,
            active: true,
            user: { active: true },
          },
          select: { user: { select: { id: true, name: true } } },
        }),
      ]);
      if (!client) return { status: "missing-client" as const };
      if (!ownerMembership) return { status: "missing-owner" as const };
      const owner = ownerMembership.user;
      if (client.portfolioOwnerId === owner.id) return { status: "unchanged" as const, client };

      const updated = await tx.client.updateMany({
        where: { id: client.id, organizationId: context.organizationId },
        data: { portfolioOwnerId: owner.id, updatedById: context.userId },
      });
      if (updated.count !== 1) return { status: "missing-client" as const };

      const openWorkItems = await tx.workItem.findMany({
        where: {
          clientId: client.id,
          organizationId: context.organizationId,
          status: {
            in: [
              "OPEN",
              "IN_PROGRESS",
              "WAITING_CLIENT",
              "WAITING_INSURER",
              "WAITING_DOCUMENT",
              "SENT",
            ],
          },
        },
        select: { id: true, notes: true },
      });

      for (const workItem of openWorkItems) {
        await tx.workItem.update({
          where: { id: workItem.id, organizationId: context.organizationId },
          data: {
            assignedToId: null,
            notes: [workItem.notes, `Revisar responsable tras reasignación de cartera: ${reason}`]
              .filter(Boolean)
              .join("\n"),
          },
        });
      }

      await writeActivityLog({
        entityType: "Client",
        entityId: client.id,
        action: "CLIENT_PORTFOLIO_REASSIGN",
        oldValue: { portfolioOwnerId: client.portfolioOwnerId },
        newValue: {
          portfolioOwnerId: owner.id,
          portfolioOwnerName: owner.name,
          reason,
          openWorkItemsPendingAssignment: openWorkItems.length,
        },
        userId: context.userId,
        organizationId: context.organizationId,
        db: tx,
      });
      return { status: "updated" as const, client };
    });

    if (result.status === "missing-client") return errorResult("El cliente ya no existe.");
    if (result.status === "missing-owner") return errorResult("El agente seleccionado no existe o está inactivo en esta organización.");
    if (result.status === "unchanged") {
      return successResult(result.client.id, `/clients/${result.client.id}`, "La cartera ya pertenece a ese agente.");
    }
    const { client } = result;

    revalidatePaths([
      "/clients",
      `/clients/${client.id}`,
      "/dashboard",
      "/today",
      "/portfolio",
      "/tasks",
      "/renewals",
      "/receipts",
    ]);
    return successResult(client.id, `/clients/${client.id}`, "Cartera reasignada; revisa los pendientes abiertos.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    return errorResult(error instanceof Error ? error.message : "No se pudo reasignar la cartera.");
  }
}
