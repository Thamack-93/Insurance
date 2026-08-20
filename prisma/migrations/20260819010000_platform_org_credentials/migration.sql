-- Platform organization provisioning and one-time credential lifecycle.
ALTER TABLE "User"
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "temporaryPasswordExpiresAt" TIMESTAMP(3),
  ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "PlatformAuditLog" (
  "id" TEXT NOT NULL,
  "requestId" TEXT,
  "actorUserId" TEXT,
  "targetOrganizationId" TEXT,
  "targetUserId" TEXT,
  "action" TEXT NOT NULL,
  "reason" TEXT,
  "metadataJson" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformAuditLog_requestId_key" ON "PlatformAuditLog"("requestId");
CREATE INDEX "PlatformAuditLog_actorUserId_createdAt_idx" ON "PlatformAuditLog"("actorUserId", "createdAt");
CREATE INDEX "PlatformAuditLog_targetOrganizationId_createdAt_idx" ON "PlatformAuditLog"("targetOrganizationId", "createdAt");
CREATE INDEX "PlatformAuditLog_targetUserId_createdAt_idx" ON "PlatformAuditLog"("targetUserId", "createdAt");
CREATE INDEX "PlatformAuditLog_action_createdAt_idx" ON "PlatformAuditLog"("action", "createdAt");

ALTER TABLE "PlatformAuditLog"
  ADD CONSTRAINT "PlatformAuditLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "PlatformAuditLog_targetOrganizationId_fkey"
  FOREIGN KEY ("targetOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
