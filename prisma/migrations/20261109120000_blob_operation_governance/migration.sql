-- Nora temporary-object ledger and app-side Blob operation budget/telemetry.
-- Both tables are operational metadata and are excluded from tenant restores.

CREATE TABLE "NoraTemporaryBlob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT,
    "pathname" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NoraTemporaryBlob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NoraTemporaryBlob_kind_check" CHECK ("kind" IN ('POLICY_PDF', 'CAPTURE_HANDOFF')),
    CONSTRAINT "NoraTemporaryBlob_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "NoraTemporaryBlob_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "NoraTemporaryBlob_pathname_key" ON "NoraTemporaryBlob"("pathname");
CREATE INDEX "NoraTemporaryBlob_organizationId_idx" ON "NoraTemporaryBlob"("organizationId");
CREATE INDEX "NoraTemporaryBlob_organizationId_expiresAt_idx" ON "NoraTemporaryBlob"("organizationId", "expiresAt");
CREATE INDEX "NoraTemporaryBlob_userId_expiresAt_idx" ON "NoraTemporaryBlob"("userId", "expiresAt");

CREATE TABLE "BlobOperationUsage" (
    "id" TEXT NOT NULL,
    "periodKind" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "advancedOperations" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BlobOperationUsage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BlobOperationUsage_periodKind_check" CHECK ("periodKind" IN ('DAY', 'MONTH')),
    CONSTRAINT "BlobOperationUsage_category_check" CHECK ("category" IN ('INTERACTIVE', 'CRITICAL', 'MAINTENANCE')),
    CONSTRAINT "BlobOperationUsage_advancedOperations_check" CHECK ("advancedOperations" >= 0)
);

CREATE UNIQUE INDEX "BlobOperationUsage_period_category_source_operation_key"
  ON "BlobOperationUsage"("periodKind", "periodStart", "category", "source", "operation");
CREATE INDEX "BlobOperationUsage_periodStart_source_idx" ON "BlobOperationUsage"("periodStart", "source");
CREATE INDEX "BlobOperationUsage_periodKind_periodStart_category_idx" ON "BlobOperationUsage"("periodKind", "periodStart", "category");
