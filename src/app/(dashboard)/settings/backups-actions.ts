"use server";

import { revalidatePath } from "next/cache";
import {
  createDatabaseBackup,
  formatBackupPreflightError,
  listBackups,
  getBackupPreflightStatus,
  verifyStoredBackup,
  type BackupEntry,
} from "@/lib/backup";
import { AuthError, requireAdmin } from "@/lib/auth";
import { logError } from "@/lib/logger";
import { errorResult, successResult, type MutationResult } from "@/lib/mutation-utils";

export type BackupListItem = {
  filename: string;
  size: number;
  createdAt: string;
  manifestAvailable: boolean;
};

function toItem(entry: BackupEntry): BackupListItem {
  return {
    filename: entry.filename,
    size: entry.size,
    createdAt: entry.createdAt.toISOString(),
    manifestAvailable: entry.manifestAvailable,
  };
}

export async function listBackupsAction(): Promise<BackupListItem[]> {
  await requireAdmin();
  return (await listBackups()).map(toItem);
}

export async function createBackup(): Promise<MutationResult> {
  try {
    await requireAdmin();
    const preflight = getBackupPreflightStatus();
    if (!preflight.ready) {
      return errorResult(formatBackupPreflightError(preflight));
    }
    const backup = await createDatabaseBackup();
    revalidatePath("/settings");
    return successResult(
      backup.filename,
      "/settings",
      `Respaldo cifrado creado: ${backup.filename}`,
    );
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    if (error instanceof Error) return errorResult(error.message);
    logError("settings.backups.create", error);
    return errorResult("No se pudo crear el respaldo cifrado. Revisa la configuración segura.");
  }
}

export async function verifyBackupAction(filename: string): Promise<MutationResult> {
  try {
    await requireAdmin();
    const verification = await verifyStoredBackup(filename);
    if (!verification.valid) return errorResult(verification.reason);
    return successResult(
      filename,
      "/settings",
      `Respaldo verificado (${verification.manifest.totals.rows} filas).`,
    );
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    logError("settings.backups.verify", error, { filename });
    return errorResult("No se pudo verificar el respaldo.");
  }
}
