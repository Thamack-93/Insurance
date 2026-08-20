import "server-only";

import { getDb } from "@/lib/db";
import type { BackupEntry } from "@/lib/backup";
import type { BackupCapability, BackupManifest, BackupScope, RestoreRunStatus } from "@/lib/backup-logic";

export type BackupArtifactStatus = "DISCOVERED" | "VERIFIED" | "INVALID" | "BLOCKED";

export type BackupArtifactView = {
  id: string;
  scope: BackupScope;
  organizationId: string | null;
  filename: string;
  pathname: string;
  storage: string;
  size: number;
  createdAt: string;
  manifestAvailable: boolean;
  formatVersion: number | null;
  keyVersion: string | null;
  status: string;
  capability: BackupCapability;
  sourceArtifactId: string | null;
  payloadSha256: string | null;
  manifestSha256: string | null;
}

export async function upsertBackupArtifact(input: {
  entry: BackupEntry;
  scope: BackupScope;
  organizationId?: string | null;
  status?: BackupArtifactStatus;
  capability?: BackupCapability;
  manifest?: BackupManifest;
  sourceArtifactId?: string | null;
}) {
  const db = getDb();
  const manifest = input.manifest;
  return db.backupArtifact.upsert({
    where: { pathname: input.entry.pathname },
    update: {
      scope: input.scope,
      organizationId: input.organizationId ?? null,
      filename: input.entry.filename,
      storage: input.entry.storage ?? "original",
      size: input.entry.size,
      createdAt: input.entry.createdAt,
      manifestAvailable: input.entry.manifestAvailable,
      formatVersion: manifest?.version ?? null,
      keyVersion: manifest?.encryption.keyVersion ?? null,
      payloadSha256: manifest?.payload.sha256 ?? null,
      manifestSha256: manifest?.manifestSha256 ?? null,
      status: input.status ?? (input.entry.manifestAvailable ? "DISCOVERED" : "INVALID"),
      capability: input.capability ?? manifest?.capability ?? "DATABASE_ONLY",
      sourceArtifactId: input.sourceArtifactId ?? undefined,
      metadataJson: manifest ? JSON.stringify({ scope: manifest.scope, organization: manifest.organization }) : undefined,
    },
    create: {
      scope: input.scope,
      organizationId: input.organizationId ?? null,
      filename: input.entry.filename,
      pathname: input.entry.pathname,
      storage: input.entry.storage ?? "original",
      size: input.entry.size,
      createdAt: input.entry.createdAt,
      manifestAvailable: input.entry.manifestAvailable,
      formatVersion: manifest?.version ?? null,
      keyVersion: manifest?.encryption.keyVersion ?? null,
      payloadSha256: manifest?.payload.sha256 ?? null,
      manifestSha256: manifest?.manifestSha256 ?? null,
      status: input.status ?? (input.entry.manifestAvailable ? "DISCOVERED" : "INVALID"),
      capability: input.capability ?? manifest?.capability ?? "DATABASE_ONLY",
      sourceArtifactId: input.sourceArtifactId ?? null,
      metadataJson: manifest ? JSON.stringify({ scope: manifest.scope, organization: manifest.organization }) : null,
    },
  });
}

function toView(artifact: {
  id: string;
  scope: string;
  organizationId: string | null;
  filename: string;
  pathname: string;
  storage: string;
  size: number;
  createdAt: Date;
  manifestAvailable: boolean;
  formatVersion: number | null;
  keyVersion: string | null;
  status: string;
  capability: string;
  sourceArtifactId: string | null;
  payloadSha256: string | null;
  manifestSha256: string | null;
}): BackupArtifactView {
  return {
    ...artifact,
    scope: artifact.scope as BackupScope,
    capability: artifact.capability as BackupCapability,
    createdAt: artifact.createdAt.toISOString(),
  };
}

export async function getOrganizationBackupArtifacts(organizationId: string) {
  const db = getDb();
  const artifacts = await db.backupArtifact.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
  });
  return artifacts.map(toView);
}

export async function getBackupArtifact(id: string) {
  const db = getDb();
  const artifact = await db.backupArtifact.findUnique({ where: { id } });
  return artifact ? toView(artifact) : null;
}

export async function updateBackupArtifactStatus(id: string, status: BackupArtifactStatus, capability?: BackupCapability) {
  const db = getDb();
  const artifact = await db.backupArtifact.update({
    where: { id },
    data: { status, ...(capability ? { capability } : {}) },
  });
  return toView(artifact);
}

export async function createOrganizationRestoreRun(input: {
  organizationId: string;
  artifactId: string;
  emergencyBackupId?: string;
  actorUserId: string;
  reason: string;
  status?: RestoreRunStatus;
  stage?: string;
  targetFingerprint?: string;
}) {
  const db = getDb();
  return db.organizationRestoreRun.create({
    data: {
      organizationId: input.organizationId,
      artifactId: input.artifactId,
      emergencyBackupId: input.emergencyBackupId,
      actorUserId: input.actorUserId,
      reason: input.reason,
      status: input.status ?? "PREVIEW",
      stage: input.stage,
      targetFingerprint: input.targetFingerprint,
    },
  });
}

export async function finishOrganizationRestoreRun(input: {
  id: string;
  status: RestoreRunStatus;
  stage?: string;
  failureCode?: string;
  reportFingerprint?: string;
}) {
  const db = getDb();
  return db.organizationRestoreRun.update({
    where: { id: input.id },
    data: {
      status: input.status,
      stage: input.stage,
      failureCode: input.failureCode,
      reportFingerprint: input.reportFingerprint,
      completedAt: new Date(),
    },
  });
}
