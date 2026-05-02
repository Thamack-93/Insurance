"use server";

import { getDb } from "./db";
import { revalidatePath } from "next/cache";
import { writeActivityLog } from "./activity-log";

type EntityType = "client" | "policy" | "receipt" | "task" | "claim" | "quote" | "insurer";

const modelMap: Record<EntityType, string> = {
  client: "client",
  policy: "policy",
  receipt: "receipt",
  task: "task",
  claim: "claim",
  quote: "quote",
  insurer: "insurer",
};

export async function bulkDelete(ids: string[], entityType: EntityType, redirectPath: string) {
  const db = getDb();
  const modelName = modelMap[entityType];

  try {
    // @ts-ignore - Dynamic model access
    await db[modelName].deleteMany({
      where: {
        id: {
          in: ids,
        },
      },
    });

    await writeActivityLog({
      action: "BULK_DELETE",
      entityType: entityType.toUpperCase(),
      entityId: ids.join(","),
      newValue: { count: ids.length },
    });

    revalidatePath(redirectPath);
    return { success: true, message: `${ids.length} elementos eliminados` };
  } catch (error) {
    console.error("Bulk delete error:", error);
    return { success: false, message: "Error al eliminar elementos" };
  }
}

export async function bulkUpdateStatus(
  ids: string[],
  entityType: EntityType,
  status: string,
  redirectPath: string
) {
  const db = getDb();
  const modelName = modelMap[entityType];

  try {
    // @ts-ignore - Dynamic model access
    await db[modelName].updateMany({
      where: {
        id: {
          in: ids,
        },
      },
      data: {
        status,
      },
    });

    await writeActivityLog({
      action: "BULK_UPDATE_STATUS",
      entityType: entityType.toUpperCase(),
      entityId: ids.join(","),
      newValue: { status, count: ids.length },
    });

    revalidatePath(redirectPath);
    return { success: true, message: `Estado actualizado para ${ids.length} elementos` };
  } catch (error) {
    console.error("Bulk update error:", error);
    return { success: false, message: "Error al actualizar elementos" };
  }
}
