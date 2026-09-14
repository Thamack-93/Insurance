import "server-only";

import {
  buildManualOrganizationBackupTarget,
  buildManualPlatformBackupTarget,
  createDatabaseBackup,
  createOrganizationDatabaseBackup,
  deleteStoredBackup,
  GLOBAL_BACKUP_RETENTION_DAYS,
  listBackups,
  listEmergencyBackups,
  listOrganizationBackups,
  listRekeyedBackups,
  verifyStoredBackup,
  type BackupEntry,
  type BackupTarget,
  type CreatedBackup,
} from "@/lib/backup";
import {
  getAllBackupArtifacts,
  getBackupArtifactByPathname,
  getOrganizationBackupArtifacts,
  getPlatformBackupArtifacts,
  markBackupArtifactsPruned,
  reserveBackupArtifact,
  updateBackupArtifactStatus,
  upsertBackupArtifact,
} from "@/lib/backup-catalog";
import { selectBackupRetention } from "@/lib/backup-logic";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";
import type { BackupVerification } from "@/lib/backup";

const POST_UPLOAD_VERIFY_DELAYS_MS = [0, 500, 1_500, 3_000] as const;
const TRANSIENT_VERIFY_CODES = new Set<string>([
  "MANIFEST_NOT_FOUND",
  "PAYLOAD_NOT_FOUND",
  "BLOB_UNAVAILABLE",
]);

export type CreateAndCatalogBackupInput = {
  scope: "PLATFORM" | "ORGANIZATION";
  organizationId?: string;
  now?: Date;
  target?: BackupTarget;
  emergency?: boolean;
};

function assertVerificationScope(
  input: Pick<CreateAndCatalogBackupInput, "scope" | "organizationId">,
  verification: Extract<Awaited<ReturnType<typeof verifyStoredBackup>>, { valid: true }>,
) {
  const manifestScope = verification.manifest.scope ?? "PLATFORM";
  if (manifestScope !== input.scope) throw new Error("El scope del manifiesto no coincide con el catálogo.");
  if (
    input.scope === "ORGANIZATION" &&
    verification.manifest.organization?.id !== input.organizationId
  ) {
    throw new Error("El manifiesto tenant pertenece a otra organización.");
  }
}

function createdFromVerification(
  target: BackupTarget,
  verification: Extract<Awaited<ReturnType<typeof verifyStoredBackup>>, { valid: true }>,
): CreatedBackup {
  return {
    filename: target.filename,
    pathname: target.pathname,
    size: verification.size,
    createdAt: new Date(verification.manifest.createdAt),
    manifestAvailable: true,
    scope: verification.manifest.scope === "ORGANIZATION" ? "ORGANIZATION" : "PLATFORM",
    organizationId: verification.manifest.organization?.id,
    manifest: verification.manifest,
    pruned: [],
  };
}

function transientVerificationCode(verification: BackupVerification) {
  return !verification.valid && TRANSIENT_VERIFY_CODES.has(verification.code);
}

async function verifyAfterUpload(input: {
  filename: string;
  pathname: string;
  artifactId: string;
  scope: "PLATFORM" | "ORGANIZATION";
  organizationId?: string;
}): Promise<BackupVerification> {
  let last: BackupVerification = {
    valid: false,
    filename: input.filename,
    reason: "No se pudo verificar el respaldo.",
    code: "BLOB_UNAVAILABLE",
  };

  for (const [index, delayMs] of POST_UPLOAD_VERIFY_DELAYS_MS.entries()) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      last = await verifyStoredBackup(input.filename, input.pathname);
    } catch (error) {
      last = {
        valid: false,
        filename: input.filename,
        reason: "No se pudo consultar el respaldo almacenado.",
        code: "BLOB_UNAVAILABLE",
      };
      logError("backup-orchestrator.verify", error, {
        scope: input.scope,
        organizationId: input.organizationId,
        artifactId: input.artifactId,
        stage: "post_upload",
        attempt: index + 1,
        code: last.code,
      });
    }

    if (last.valid) return last;
    logError("backup-orchestrator.verify", new Error(last.reason), {
      scope: input.scope,
      organizationId: input.organizationId,
      artifactId: input.artifactId,
      stage: "post_upload",
      attempt: index + 1,
      code: last.code,
    });
    if (!transientVerificationCode(last) || index === POST_UPLOAD_VERIFY_DELAYS_MS.length - 1) return last;
  }

  return last;
}

async function pruneVerifiedBackups(scope: "PLATFORM" | "ORGANIZATION", organizationId: string | undefined, now: Date) {
  const artifacts = scope === "PLATFORM"
    ? await getPlatformBackupArtifacts()
    : await getOrganizationBackupArtifacts(organizationId ?? "");
  const verified = artifacts
    .filter((artifact) => artifact.status === "VERIFIED" && artifact.storage === "original")
    .map((artifact) => ({ ...artifact, createdAt: new Date(artifact.createdAt) }));
  const toRemove = scope === "PLATFORM"
    ? verified.filter((artifact) => now.getTime() - artifact.createdAt.getTime() >= GLOBAL_BACKUP_RETENTION_DAYS * 86_400_000)
    : selectBackupRetention(verified.map((artifact) => ({ ...artifact, id: artifact.pathname }))).remove;

  const pruned: string[] = [];
  for (const artifact of toRemove) {
    await deleteStoredBackup(artifact.pathname);
    await markBackupArtifactsPruned([artifact.pathname]);
    pruned.push(artifact.pathname);
  }
  return pruned;
}

export async function createAndCatalogBackup(input: CreateAndCatalogBackupInput): Promise<CreatedBackup> {
  const now = input.now ?? new Date();
  if (input.scope === "ORGANIZATION" && !input.organizationId) {
    throw new Error("organizationId is required for an organization backup.");
  }
  const target = input.target ?? (
    input.scope === "PLATFORM"
      ? buildManualPlatformBackupTarget(now, input.emergency)
      : buildManualOrganizationBackupTarget(input.organizationId!, now)
  );

  const reserved = await reserveBackupArtifact({
    target,
    scope: input.scope,
    organizationId: input.organizationId,
    createdAt: now,
  });

  let existingVerification: BackupVerification | null = null;
  try {
    existingVerification = await verifyStoredBackup(target.filename, target.pathname);
  } catch (error) {
    logError("backup-orchestrator.verify", error, {
      scope: input.scope,
      organizationId: input.organizationId,
      artifactId: reserved.id,
      stage: "existing_artifact",
      attempt: 1,
      code: "BLOB_UNAVAILABLE",
    });
  }
  if (existingVerification?.valid) {
    const verifiedExisting = existingVerification;
    try {
      assertVerificationScope(input, verifiedExisting);
      await upsertBackupArtifact({
        entry: createdFromVerification(target, verifiedExisting),
        scope: input.scope,
        organizationId: input.organizationId,
        status: "VERIFIED",
        capability: verifiedExisting.manifest.capability,
        manifest: verifiedExisting.manifest,
      });
      return createdFromVerification(target, verifiedExisting);
    } catch (error) {
      await updateBackupArtifactStatus(reserved.id, "BLOCKED");
      throw error;
    }
  }

  await deleteStoredBackup(target.pathname).catch(() => undefined);
  try {
    const backup = input.scope === "PLATFORM"
      ? await createDatabaseBackup(now, { target, deferRotation: true, emergency: input.emergency })
      : await createOrganizationDatabaseBackup(input.organizationId!, now, { target, deferRotation: true });
    const verification = await verifyAfterUpload({
      filename: target.filename,
      pathname: target.pathname,
      artifactId: reserved.id,
      scope: input.scope,
      organizationId: input.organizationId,
    });
    if (!verification.valid) throw new Error(verification.reason);
    assertVerificationScope(input, verification);
    await upsertBackupArtifact({
      entry: backup,
      scope: input.scope,
      organizationId: input.organizationId,
      status: "VERIFIED",
      capability: verification.manifest.capability,
      manifest: verification.manifest,
    });
    backup.pruned = input.emergency ? [] : await pruneVerifiedBackups(input.scope, input.organizationId, now);
    return backup;
  } catch (error) {
    await deleteStoredBackup(target.pathname).catch(() => undefined);
    await updateBackupArtifactStatus(reserved.id, "BLOCKED").catch(() => undefined);
    throw error;
  }
}

export async function reconcileBackupCatalog() {
  const organizations = await getDb().organization.findMany({ select: { id: true }, orderBy: { id: "asc" } });
  const [platform, rekeyed, emergency, ...tenantGroups] = await Promise.all([
    listBackups(),
    listRekeyedBackups(),
    listEmergencyBackups(),
    ...organizations.map((organization) => listOrganizationBackups(organization.id)),
  ]);
  const entries: Array<BackupEntry & { scope: "PLATFORM" | "ORGANIZATION"; organizationId?: string }> = [
    ...platform.map((entry) => ({ ...entry, scope: "PLATFORM" as const })),
    ...rekeyed.map((entry) => ({ ...entry, scope: "PLATFORM" as const, storage: "rekeyed" as const })),
    ...emergency.map((entry) => ({ ...entry, scope: "PLATFORM" as const })),
    ...tenantGroups.flatMap((group) => group.map((entry) => ({ ...entry, scope: "ORGANIZATION" as const }))),
  ];

  let verified = 0;
  let invalid = 0;
  let blocked = 0;
  for (const entry of entries) {
    const verification = await verifyStoredBackup(entry.filename, entry.pathname);
    if (!verification.valid) {
      const existing = await getBackupArtifactByPathname(entry.pathname);
      if (existing) await updateBackupArtifactStatus(existing.id, "INVALID");
      else await upsertBackupArtifact({ entry, scope: entry.scope, organizationId: entry.organizationId, status: "INVALID" });
      invalid += 1;
      continue;
    }
    try {
      assertVerificationScope({ scope: entry.scope, organizationId: entry.organizationId }, verification);
      await upsertBackupArtifact({
        entry,
        scope: entry.scope,
        organizationId: entry.organizationId,
        status: "VERIFIED",
        capability: verification.manifest.capability,
        manifest: verification.manifest,
      });
      verified += 1;
    } catch {
      const existing = await getBackupArtifactByPathname(entry.pathname);
      if (existing) await updateBackupArtifactStatus(existing.id, "BLOCKED");
      else await upsertBackupArtifact({ entry, scope: entry.scope, organizationId: entry.organizationId, status: "BLOCKED" });
      blocked += 1;
    }
  }

  const physicalPathnames = new Set(entries.map((entry) => entry.pathname));
  const catalog = await getAllBackupArtifacts();
  for (const artifact of catalog) {
    // A previously blocked reservation with no corresponding blob is a
    // terminal invalid artifact after manual reconciliation. Keep the row and
    // its audit history, but stop counting it as an active blocking incident.
    // A VERIFIED artifact that disappears remains BLOCKED so the verifier
    // cannot silently downgrade a previously healthy backup.
    if (artifact.status === "BLOCKED" && !physicalPathnames.has(artifact.pathname)) {
      await updateBackupArtifactStatus(artifact.id, "INVALID");
      invalid += 1;
      continue;
    }
    if (artifact.status === "VERIFIED" && !physicalPathnames.has(artifact.pathname)) {
      await updateBackupArtifactStatus(artifact.id, "BLOCKED");
      blocked += 1;
    }
  }
  return { verified, invalid, blocked, discovered: entries.length };
}
