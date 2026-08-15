"use server";

import { getDb } from "./db";
import { writeActivityLog } from "./activity-log";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "./mutation-utils";
import { logError } from "./logger";
import { assertOrganizationContextInTransaction, requireOrganizationRole } from "./organization-context";
type AnyDb = ReturnType<typeof getDb>;

type EntityType = "client" | "policy" | "receipt" | "task" | "claim" | "quote" | "insurer";

type DelegateName =
  | "client"
  | "policy"
  | "receipt"
  | "task"
  | "claim"
  | "quote"
  | "insurer";

const modelMap: Record<EntityType, DelegateName> = {
  client: "client",
  policy: "policy",
  receipt: "receipt",
  task: "task",
  claim: "claim",
  quote: "quote",
  insurer: "insurer",
};

type BulkDelegate = {
  deleteMany: (args: { where: { id: { in: string[] }; organizationId: string } }) => Promise<{ count: number }>;
  updateMany: (args: {
    where: { id: { in: string[] }; organizationId: string };
    data: { status: string };
  }) => Promise<{ count: number }>;
};

function getDelegate(db: AnyDb, entityType: EntityType): BulkDelegate {
  return (db as unknown as Record<string, BulkDelegate>)[modelMap[entityType]];
}

export async function bulkDelete(
  ids: string[],
  entityType: EntityType,
  redirectPath: string,
): Promise<MutationResult> {
  if (ids.length === 0) {
    return errorResult("Selecciona al menos un elemento para eliminar.");
  }

  try {
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
    const db = getDb();
    const result = await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
      return getDelegate(tx as AnyDb, entityType).deleteMany({ where: { id: { in: ids }, organizationId: context.organizationId } });
    });

    await writeActivityLog({
      action: "BULK_DELETE",
      entityType: entityType.toUpperCase(),
      entityId: ids.join(","),
      organizationId: context.organizationId,
      userId: context.userId,
      newValue: { count: result.count },
    });

    revalidatePaths([redirectPath]);
    return successResult("", redirectPath, `${result.count} elementos eliminados.`);
  } catch (error) {
    logError("bulkActions.bulkDelete", error, { entityType, count: ids.length });
    return errorResult(
      "No fue posible eliminar los elementos. Verifica que no tengan dependencias.",
    );
  }
}

export async function bulkUpdateStatus(
  ids: string[],
  entityType: EntityType,
  status: string,
  redirectPath: string,
): Promise<MutationResult> {
  if (ids.length === 0) {
    return errorResult("Selecciona al menos un elemento para actualizar.");
  }

  try {
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
    const db = getDb();
    const result = await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
      return getDelegate(tx as AnyDb, entityType).updateMany({
        where: { id: { in: ids }, organizationId: context.organizationId },
        data: { status },
      });
    });

    await writeActivityLog({
      action: "BULK_UPDATE_STATUS",
      entityType: entityType.toUpperCase(),
      entityId: ids.join(","),
      organizationId: context.organizationId,
      userId: context.userId,
      newValue: { status, count: result.count },
    });

    revalidatePaths([redirectPath]);
    return successResult("", redirectPath, `Estado actualizado para ${result.count} elementos.`);
  } catch (error) {
    logError("bulkActions.bulkUpdateStatus", error, { entityType, status, count: ids.length });
    return errorResult("No fue posible actualizar el estado de los elementos seleccionados.");
  }
}
