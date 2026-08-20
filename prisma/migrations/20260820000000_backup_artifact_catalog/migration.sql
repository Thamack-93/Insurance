-- The catalog is operational metadata. It is deliberately separate from
-- tenant data and is never included in a tenant rollback replacement.
CREATE TABLE "BackupArtifact" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "organizationId" TEXT,
    "filename" TEXT NOT NULL,
    "pathname" TEXT NOT NULL,
    "storage" TEXT NOT NULL DEFAULT 'original',
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "manifestAvailable" BOOLEAN NOT NULL DEFAULT false,
    "formatVersion" INTEGER,
    "keyVersion" TEXT,
    "payloadSha256" TEXT,
    "manifestSha256" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISCOVERED',
    "capability" TEXT NOT NULL DEFAULT 'DATABASE_ONLY',
    "sourceArtifactId" TEXT,
    "metadataJson" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BackupArtifact_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BackupArtifact_pathname_key" UNIQUE ("pathname"),
    CONSTRAINT "BackupArtifact_scope_check" CHECK ("scope" IN ('ORGANIZATION', 'LEGACY_SINGLETON', 'PLATFORM')),
    CONSTRAINT "BackupArtifact_scope_org_check" CHECK (
      ("scope" = 'PLATFORM' AND "organizationId" IS NULL)
      OR ("scope" IN ('ORGANIZATION', 'LEGACY_SINGLETON') AND "organizationId" IS NOT NULL)
    ),
    CONSTRAINT "BackupArtifact_payloadSha256_check" CHECK ("payloadSha256" IS NULL OR "payloadSha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "BackupArtifact_manifestSha256_check" CHECK ("manifestSha256" IS NULL OR "manifestSha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "BackupArtifact_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BackupArtifact_sourceArtifactId_fkey"
      FOREIGN KEY ("sourceArtifactId") REFERENCES "BackupArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "BackupArtifact_organizationId_createdAt_idx" ON "BackupArtifact"("organizationId", "createdAt");
CREATE INDEX "BackupArtifact_organizationId_idx" ON "BackupArtifact"("organizationId");
CREATE INDEX "BackupArtifact_scope_createdAt_idx" ON "BackupArtifact"("scope", "createdAt");
CREATE INDEX "BackupArtifact_status_idx" ON "BackupArtifact"("status");

CREATE TABLE "OrganizationRestoreRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "emergencyBackupId" TEXT,
    "actorUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stage" TEXT,
    "failureCode" TEXT,
    "targetFingerprint" TEXT,
    "reportFingerprint" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizationRestoreRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrganizationRestoreRun_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrganizationRestoreRun_artifactId_fkey"
      FOREIGN KEY ("artifactId") REFERENCES "BackupArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrganizationRestoreRun_emergencyBackupId_fkey"
      FOREIGN KEY ("emergencyBackupId") REFERENCES "BackupArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "OrganizationRestoreRun_organizationId_createdAt_idx" ON "OrganizationRestoreRun"("organizationId", "createdAt");
CREATE INDEX "OrganizationRestoreRun_organizationId_idx" ON "OrganizationRestoreRun"("organizationId");
CREATE INDEX "OrganizationRestoreRun_artifactId_idx" ON "OrganizationRestoreRun"("artifactId");
CREATE INDEX "OrganizationRestoreRun_status_idx" ON "OrganizationRestoreRun"("status");
