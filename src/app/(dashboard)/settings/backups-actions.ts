"use server";

import { revalidatePath } from "next/cache";
import {
  createDatabaseBackup,
  createOrganizationDatabaseBackup,
  formatBackupPreflightError,
  rekeyStoredBackup,
  listBackups,
  listRekeyedBackups,
  listOrganizationBackups,
  getBackupPreflightStatus,
  verifyStoredBackup,
  type BackupEntry,
} from "@/lib/backup";
import {
  getBackupArtifact,
  getOrganizationBackupArtifacts,
  updateBackupArtifactStatus,
  upsertBackupArtifact,
} from "@/lib/backup-catalog";
import { AuthError, requireSuperAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";
import { errorResult, successResult, type MutationResult } from "@/lib/mutation-utils";

export type BackupListItem = {
  filename: string;
  size: number;
  createdAt: string;
  manifestAvailable: boolean;
  storage: "original" | "rekeyed";
};

export type OrganizationBackupListItem = BackupListItem & {
  id: string;
  pathname: string;
  organizationId: string;
  scope: "ORGANIZATION" | "LEGACY_SINGLETON";
  status: string;
  capability: "COMPLETE" | "DATABASE_ONLY";
  formatVersion: number | null;
};

function toItem(entry: BackupEntry, storage: BackupListItem["storage"]): BackupListItem {
  return {
    filename: entry.filename,
    size: entry.size,
    createdAt: entry.createdAt.toISOString(),
    manifestAvailable: entry.manifestAvailable,
    storage,
  };
}

export async function listBackupsAction(): Promise<BackupListItem[]> {
  await requireSuperAdmin();
  const [originals, rekeyed] = await Promise.all([listBackups(), listRekeyedBackups()]);
  return [
    ...originals.map((entry) => toItem(entry, "original")),
    ...rekeyed.map((entry) => toItem(entry, "rekeyed")),
  ];
}

export async function listOrganizationBackupsAction(organizationId: string): Promise<OrganizationBackupListItem[]> {
  await requireSuperAdmin();
  const db = getDb();
  const organization = await db.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) throw new Error("La organización no existe.");

  const tenantEntries = await listOrganizationBackups(organizationId);
  for (const entry of tenantEntries) {
    await upsertBackupArtifact({
      entry,
      scope: "ORGANIZATION",
      organizationId,
    });
  }

  const artifacts = await getOrganizationBackupArtifacts(organizationId);
  return artifacts
    .filter((artifact): artifact is typeof artifact & { scope: "ORGANIZATION" | "LEGACY_SINGLETON" } =>
      artifact.scope === "ORGANIZATION" || artifact.scope === "LEGACY_SINGLETON")
    .map((artifact) => ({
      ...artifact,
      storage: artifact.storage as "original" | "rekeyed",
      scope: artifact.scope,
      organizationId: artifact.organizationId ?? organizationId,
      capability: artifact.capability === "COMPLETE" ? "COMPLETE" : "DATABASE_ONLY",
    }));
}

export async function createOrganizationBackup(organizationId: string): Promise<MutationResult> {
  try {
    await requireSuperAdmin();
    const preflight = getBackupPreflightStatus();
    if (!preflight.ready) return errorResult(formatBackupPreflightError(preflight));
    const backup = await createOrganizationDatabaseBackup(organizationId);
    await upsertBackupArtifact({
      entry: backup,
      scope: "ORGANIZATION",
      organizationId,
      status: "VERIFIED",
      capability: backup.manifest.capability,
      manifest: backup.manifest,
    });
    revalidatePath(`/platform/organizations/${encodeURIComponent(organizationId)}`);
    return successResult(backup.filename, `/platform/organizations/${encodeURIComponent(organizationId)}`, `Respaldo de organización creado: ${backup.filename}`);
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    if (error instanceof Error) return errorResult(error.message);
    logError("platform.organization-backups.create", error, { organizationId });
    return errorResult("No se pudo crear el respaldo de la organización.");
  }
}

export async function verifyOrganizationBackupAction(artifactId: string): Promise<MutationResult> {
  try {
    await requireSuperAdmin();
    const artifact = await getBackupArtifact(artifactId);
    if (!artifact || !artifact.organizationId) return errorResult("No se encontró el artefacto de la organización.");
    const verification = await verifyStoredBackup(artifact.filename, artifact.pathname);
    if (!verification.valid) {
      await updateBackupArtifactStatus(artifact.id, "INVALID");
      return errorResult(verification.reason);
    }
    if (verification.manifest.version === 2 && verification.manifest.organization?.id !== artifact.organizationId) {
      await updateBackupArtifactStatus(artifact.id, "INVALID");
      return errorResult("El backup no corresponde a la organización del catálogo.");
    }
    await updateBackupArtifactStatus(artifact.id, "VERIFIED", verification.manifest.capability);
    return successResult(artifact.id, `/platform/organizations/${encodeURIComponent(artifact.organizationId)}`, `Respaldo verificado (${verification.manifest.totals.rows} filas).`);
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    logError("platform.organization-backups.verify", error, { artifactId });
    return errorResult("No se pudo verificar el respaldo de la organización.");
  }
}

export async function createBackup(): Promise<MutationResult> {
  try {
    await requireSuperAdmin();
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
    await requireSuperAdmin();
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

export async function rekeyBackupAction(filename: string): Promise<MutationResult> {
  try {
    await requireSuperAdmin();
    const copy = await rekeyStoredBackup(filename);
    revalidatePath("/settings");
    return successResult(
      copy.filename,
      "/settings",
      `Copia re-cifrada y verificada: ${copy.filename}. El respaldo original no fue modificado.`,
    );
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    if (error instanceof Error) return errorResult(error.message);
    logError("settings.backups.rekey", error, { filename });
    return errorResult("No se pudo crear la copia re-cifrada.");
  }
}
