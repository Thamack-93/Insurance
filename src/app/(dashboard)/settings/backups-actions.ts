"use server";

import fs from "node:fs/promises";
import { revalidatePath } from "next/cache";
import {
  backupDatabase,
  listBackups,
  rotateBackups,
  restoreDatabaseFromFile,
  type BackupEntry,
} from "@/lib/backup";
import { assertSafeBackupPath } from "@/lib/files";
import { resetDb } from "@/lib/db";
import { AuthError, requireAdmin } from "@/lib/auth";
import { errorResult, successResult, type MutationResult } from "@/lib/mutation-utils";
import { logError } from "@/lib/logger";
import { areLocalBackupsEnabled } from "@/lib/deployment";

export type BackupListItem = {
  filename: string;
  size: number;
  createdAt: string;
};

function toItem(entry: BackupEntry): BackupListItem {
  return {
    filename: entry.filename,
    size: entry.size,
    createdAt: entry.createdAt.toISOString(),
  };
}

export async function listBackupsAction(): Promise<BackupListItem[]> {
  await requireAdmin();
  if (!areLocalBackupsEnabled()) {
    return [];
  }
  const entries = await listBackups();
  return entries.map(toItem);
}

export async function createBackup(): Promise<MutationResult> {
  try {
    await requireAdmin();
    if (!areLocalBackupsEnabled()) {
      return errorResult("Los respaldos locales están deshabilitados en esta demo desplegada.");
    }
    const target = await backupDatabase();
    if (!target) {
      return errorResult("No se encontró la base de datos para respaldar.");
    }

    await rotateBackups();
    revalidatePath("/settings");

    const filename = target.split(/[\\/]/).pop() ?? target;
    return successResult(filename, "/settings", `Respaldo creado: ${filename}`);
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    logError("settings.backups.create", error);
    return errorResult("No se pudo crear el respaldo. Intenta de nuevo.");
  }
}

export async function restoreBackup(filename: string): Promise<MutationResult> {
  try {
    await requireAdmin();
    if (!areLocalBackupsEnabled()) {
      return errorResult("Las restauraciones locales están deshabilitadas en esta demo desplegada.");
    }
    const safePath = assertSafeBackupPath(filename);
    await fs.access(safePath);

    // Take a safety snapshot of the current DB before overwriting.
    await backupDatabase("pre-restore");
    await rotateBackups();

    // Close the Prisma client (and its better-sqlite3 handle) before
    // overwriting the database file, then drop the cached singleton so the
    // next getDb() call opens a fresh connection against the restored file.
    await resetDb();

    await restoreDatabaseFromFile(safePath);

    revalidatePath("/", "layout");
    return successResult(filename, "/settings", `Respaldo restaurado: ${filename}`);
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    logError("settings.backups.restore", error, { filename });
    if (error instanceof Error && error.message.includes("Backup path must stay")) {
      return errorResult("Ruta de respaldo no válida.");
    }
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return errorResult("El archivo de respaldo ya no existe.");
    }
    return errorResult("No se pudo restaurar el respaldo. Intenta de nuevo.");
  }
}
