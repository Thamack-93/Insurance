ALTER TABLE "DemoOrganizationState"
  ADD COLUMN IF NOT EXISTS "resetPhase" TEXT NOT NULL DEFAULT 'IDLE',
  ADD COLUMN IF NOT EXISTS "resetAttemptId" TEXT,
  ADD COLUMN IF NOT EXISTS "resetRequestId" TEXT,
  ADD COLUMN IF NOT EXISTS "resetStartedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resetHeartbeatAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resetLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resetAttempts" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "DemoUploadArtifact"
  ADD COLUMN IF NOT EXISTS "purgeAfterAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastPurgeAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "blobDeleteConfirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "purgeBreachAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dataVersion" INTEGER NOT NULL DEFAULT 1;

UPDATE "DemoUploadArtifact"
SET "purgeAfterAt" = "uploadedAt" + INTERVAL '47 hours'
WHERE "purgeAfterAt" IS NULL;

ALTER TABLE "DemoUploadArtifact"
  ALTER COLUMN "purgeAfterAt" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "DemoOrganizationState_resetAttemptId_key"
  ON "DemoOrganizationState"("resetAttemptId");

CREATE INDEX IF NOT EXISTS "DemoOrganizationState_resetStatus_resetLeaseExpiresAt_idx"
  ON "DemoOrganizationState"("resetStatus", "resetLeaseExpiresAt");

CREATE INDEX IF NOT EXISTS "DemoUploadArtifact_organizationId_purgeAfterAt_status_idx"
  ON "DemoUploadArtifact"("organizationId", "purgeAfterAt", "status");

ALTER TABLE "DemoOrganizationState"
  DROP CONSTRAINT IF EXISTS "DemoOrganizationState_reset_phase_check";

ALTER TABLE "DemoOrganizationState"
  ADD CONSTRAINT "DemoOrganizationState_reset_phase_check"
  CHECK ("resetPhase" IN ('IDLE', 'PREPARING', 'PURGING', 'RESEEDING', 'VERIFYING', 'RECOVERING'));
