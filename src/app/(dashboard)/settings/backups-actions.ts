"use server";

import { revalidatePath } from "next/cache";
import {
  formatBackupPreflightError,
  rekeyStoredBackup,
  getBackupPreflightStatus,
  verifyStoredBackup,
} from "@/lib/backup";
import {
  getBackupArtifact,
  getOrganizationBackupArtifacts,
  getPlatformBackupArtifacts,
  updateBackupArtifactStatus,
  upsertBackupArtifact,
} from "@/lib/backup-catalog";
import { createAndCatalogBackup, reconcileBackupCatalog } from "@/lib/backup-orchestrator";
import { AuthError, requireSuperAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";
import { errorResult, successResult, type MutationResult } from "@/lib/mutation-utils";

export type BackupListItem = {
  id: string;
  pathname: string;
  filename: string;
  size: number;
  createdAt: string;
  manifestAvailable: boolean;
  storage: "original" | "rekeyed";
  scope: "PLATFORM";
  status: string;
  capability: "COMPLETE" | "DATABASE_ONLY";
  formatVersion: number | null;
  keyVersion: string | null;
};

export type OrganizationBackupListItem = Omit<BackupListItem, "scope"> & {
  id: string;
  pathname: string;
  organizationId: string;
  scope: "ORGANIZATION";
  status: string;
  capability: "COMPLETE" | "DATABASE_ONLY";
  formatVersion: number | null;
};

export async function listBackupsAction(): Promise<BackupListItem[]> {
  await requireSuperAdmin();
  const artifacts = await getPlatformBackupArtifacts();
  return artifacts
    .map((artifact) => ({
      ...artifact,
      storage: artifact.storage as "original" | "rekeyed",
      scope: "PLATFORM" as const,
      capability: artifact.capability === "COMPLETE" ? "COMPLETE" as const : "DATABASE_ONLY" as const,
    }));
}

export async function listOrganizationBackupsAction(organizationId: string): Promise<OrganizationBackupListItem[]> {
  await requireSuperAdmin();
  const db = getDb();
  const organization = await db.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) throw new Error("La organización no existe.");

  const artifacts = await getOrganizationBackupArtifacts(organizationId);
  return artifacts
    .filter((artifact): artifact is typeof artifact & { scope: "ORGANIZATION" } => artifact.scope === "ORGANIZATION")
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
    const backup = await createAndCatalogBackup({
      scope: "ORGANIZATION",
      organizationId,
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
    if (!artifact || artifact.scope !== "ORGANIZATION" || !artifact.organizationId) return errorResult("No se encontró el artefacto de la organización.");
    if (artifact.status === "PRUNED") return errorResult("El artefacto fue eliminado por retención.");
    const verification = await verifyStoredBackup(artifact.filename, artifact.pathname);
    if (!verification.valid) {
      await updateBackupArtifactStatus(artifact.id, "INVALID");
      return errorResult(verification.reason);
    }
    if ((verification.manifest.scope ?? "PLATFORM") !== "ORGANIZATION" || verification.manifest.organization?.id !== artifact.organizationId) {
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
    const backup = await createAndCatalogBackup({
      scope: "PLATFORM",
    });
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

export async function verifyBackupAction(artifactId: string): Promise<MutationResult> {
  try {
    await requireSuperAdmin();
    const artifact = await getBackupArtifact(artifactId);
    if (!artifact || artifact.scope !== "PLATFORM" || artifact.organizationId) {
      return errorResult("No se encontró el artefacto global.");
    }
    if (artifact.status === "PRUNED") return errorResult("El artefacto fue eliminado por retención.");
    const verification = await verifyStoredBackup(artifact.filename, artifact.pathname);
    if (!verification.valid) {
      await updateBackupArtifactStatus(artifact.id, "INVALID");
      return errorResult(verification.reason);
    }
    if ((verification.manifest.scope ?? "PLATFORM") !== "PLATFORM") {
      await updateBackupArtifactStatus(artifact.id, "INVALID");
      return errorResult("El manifiesto no corresponde a un respaldo global.");
    }
    await updateBackupArtifactStatus(artifact.id, "VERIFIED", verification.manifest.capability);
    return successResult(
      artifact.id,
      "/settings",
      `Respaldo verificado (${verification.manifest.totals.rows} filas).`,
    );
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    logError("settings.backups.verify", error, { artifactId });
    return errorResult("No se pudo verificar el respaldo.");
  }
}

export async function rekeyBackupAction(artifactId: string): Promise<MutationResult> {
  try {
    await requireSuperAdmin();
    const artifact = await getBackupArtifact(artifactId);
    if (!artifact || artifact.scope !== "PLATFORM" || artifact.organizationId) {
      return errorResult("No se encontró el artefacto global.");
    }
    if (artifact.status !== "VERIFIED") return errorResult("Solo puede re-cifrarse un artefacto verificado.");
    const copy = await rekeyStoredBackup(artifact.filename, new Date(), artifact.pathname);
    await upsertBackupArtifact({
      entry: {
        filename: copy.filename,
        pathname: copy.pathname,
        size: copy.size,
        createdAt: new Date(copy.manifest.completedAt),
        manifestAvailable: true,
        storage: "rekeyed",
      },
      scope: "PLATFORM",
      status: "VERIFIED",
      capability: copy.manifest.capability,
      manifest: copy.manifest,
      sourceArtifactId: artifact.id,
    });
    revalidatePath("/settings");
    return successResult(
      copy.filename,
      "/settings",
      `Copia re-cifrada y verificada: ${copy.filename}. El respaldo original no fue modificado.`,
    );
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    if (error instanceof Error) return errorResult(error.message);
    logError("settings.backups.rekey", error, { artifactId });
    return errorResult("No se pudo crear la copia re-cifrada.");
  }
}

export async function reconcileBackupCatalogAction(): Promise<MutationResult> {
  try {
    const actor = await requireSuperAdmin();
    const result = await reconcileBackupCatalog();
    await getDb().platformAuditLog.create({
      data: {
        actorUserId: actor.id,
        action: "BACKUP_CATALOG_RECONCILED",
        reason: "Reconciliación manual del catálogo de respaldos.",
        metadataJson: JSON.stringify(result),
      },
    });
    revalidatePath("/settings");
    revalidatePath("/platform");
    return successResult(actor.id, "/settings", `Catálogo reconciliado: ${result.verified} verificados, ${result.invalid} inválidos y ${result.blocked} bloqueados.`);
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    logError("settings.backups.reconcile", error);
    return errorResult("No se pudo reconciliar el catálogo de respaldos.");
  }
}
