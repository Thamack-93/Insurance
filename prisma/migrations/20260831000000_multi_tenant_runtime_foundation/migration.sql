-- Additive multi-tenant runtime foundation. This migration intentionally does
-- not remove the Cycle 1 singleton barrier or enable RLS; the cutover is a
-- separate, audited migration after two-organization certification.

ALTER TABLE "Organization" ADD CONSTRAINT "Organization_status_runtime_check"
  CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'RESTORING', 'BOOTSTRAP', 'PROVISIONING', 'RESETTING'));
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_kind_runtime_check"
  CHECK ("kind" IN ('CUSTOMER', 'DEMO', 'LEGACY'));

CREATE TABLE "OrganizationCapability" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "limitValue" INTEGER,
  "source" TEXT NOT NULL DEFAULT 'PLAN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationCapability_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrganizationCapability_organizationId_key_key" ON "OrganizationCapability"("organizationId", "key");
CREATE INDEX "OrganizationCapability_organizationId_enabled_idx" ON "OrganizationCapability"("organizationId", "enabled");
CREATE INDEX "OrganizationCapability_organizationId_idx" ON "OrganizationCapability"("organizationId");
ALTER TABLE "OrganizationCapability" ADD CONSTRAINT "OrganizationCapability_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OrganizationSetting" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationSetting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrganizationSetting_organizationId_key_key" ON "OrganizationSetting"("organizationId", "key");
CREATE INDEX "OrganizationSetting_organizationId_idx" ON "OrganizationSetting"("organizationId");
ALTER TABLE "OrganizationSetting" ADD CONSTRAINT "OrganizationSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "UserPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserPreference_userId_key_key" ON "UserPreference"("userId", "key");
CREATE INDEX "UserPreference_userId_idx" ON "UserPreference"("userId");
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idleExpiresAt" TIMESTAMP(3) NOT NULL,
  "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "fingerprint" TEXT,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");
CREATE INDEX "Session_idleExpiresAt_idx" ON "Session"("idleExpiresAt");
CREATE INDEX "Session_absoluteExpiresAt_idx" ON "Session"("absoluteExpiresAt");
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DemoOrganizationState" (
  "organizationId" TEXT NOT NULL,
  "seedVersion" TEXT NOT NULL,
  "trialEndsAt" TIMESTAMP(3) NOT NULL,
  "realDataResetAt" TIMESTAMP(3),
  "lastResetAt" TIMESTAMP(3),
  "resetStatus" TEXT NOT NULL DEFAULT 'IDLE',
  "resetFailure" TEXT,
  "dataVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DemoOrganizationState_pkey" PRIMARY KEY ("organizationId")
);
ALTER TABLE "DemoOrganizationState" ADD CONSTRAINT "DemoOrganizationState_reset_status_check"
  CHECK ("resetStatus" IN ('IDLE', 'RESETTING', 'FAILED'));
CREATE INDEX "DemoOrganizationState_trialEndsAt_resetStatus_idx" ON "DemoOrganizationState"("trialEndsAt", "resetStatus");
CREATE INDEX "DemoOrganizationState_realDataResetAt_idx" ON "DemoOrganizationState"("realDataResetAt");
CREATE INDEX "DemoOrganizationState_organizationId_idx" ON "DemoOrganizationState"("organizationId");
ALTER TABLE "DemoOrganizationState" ADD CONSTRAINT "DemoOrganizationState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DemoUploadArtifact" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "blobPath" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'POLICY_DOCUMENT',
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT "DemoUploadArtifact_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "DemoUploadArtifact" ADD CONSTRAINT "DemoUploadArtifact_status_check"
  CHECK ("status" IN ('ACTIVE', 'PURGED', 'FAILED'));
ALTER TABLE "DemoUploadArtifact" ADD CONSTRAINT "DemoUploadArtifact_expiry_check"
  CHECK ("expiresAt" > "uploadedAt");
CREATE UNIQUE INDEX "DemoUploadArtifact_blobPath_key" ON "DemoUploadArtifact"("blobPath");
CREATE INDEX "DemoUploadArtifact_organizationId_expiresAt_status_idx" ON "DemoUploadArtifact"("organizationId", "expiresAt", "status");
CREATE INDEX "DemoUploadArtifact_userId_uploadedAt_idx" ON "DemoUploadArtifact"("userId", "uploadedAt");
CREATE INDEX "DemoUploadArtifact_organizationId_idx" ON "DemoUploadArtifact"("organizationId");
ALTER TABLE "DemoUploadArtifact" ADD CONSTRAINT "DemoUploadArtifact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DemoUploadArtifact" ADD CONSTRAINT "DemoUploadArtifact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PlatformRuntimeState" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "writeMode" TEXT NOT NULL DEFAULT 'OPEN',
  "reason" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformRuntimeState_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "PlatformRuntimeState" ADD CONSTRAINT "PlatformRuntimeState_write_mode_check"
  CHECK ("writeMode" IN ('OPEN', 'MAINTENANCE', 'READ_ONLY'));
INSERT INTO "PlatformRuntimeState" ("id", "writeMode") VALUES (1, 'OPEN') ON CONFLICT ("id") DO NOTHING;

/* The restricted runtime role is prepared by the direct operator preflight.
   CREATE ROLE/ALTER ROLE cannot run inside Prisma's transactional migration;
   keeping role DDL out of this additive migration also lets singleton
   deployments apply the schema before the runtime credential exists. */
