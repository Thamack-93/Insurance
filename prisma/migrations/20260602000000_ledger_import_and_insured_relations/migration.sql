BEGIN;

-- Separate insured parties and insured assets from the policy contractor.
CREATE TABLE "PolicyInsuredParty" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT FALSE,
    "sourceLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyInsuredParty_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PolicyInsuredAsset" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "serialNumber" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyInsuredAsset_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PolicyInsuredParty"
ADD CONSTRAINT "PolicyInsuredParty_policyId_fkey"
FOREIGN KEY ("policyId") REFERENCES "Policy"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PolicyInsuredAsset"
ADD CONSTRAINT "PolicyInsuredAsset_policyId_fkey"
FOREIGN KEY ("policyId") REFERENCES "Policy"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "PolicyInsuredParty_policyId_idx" ON "PolicyInsuredParty"("policyId");
CREATE INDEX "PolicyInsuredParty_fullName_idx" ON "PolicyInsuredParty"("fullName");
CREATE INDEX "PolicyInsuredParty_isPrimary_idx" ON "PolicyInsuredParty"("isPrimary");
CREATE UNIQUE INDEX "PolicyInsuredParty_policyId_fullName_key" ON "PolicyInsuredParty"("policyId", "fullName");

CREATE INDEX "PolicyInsuredAsset_policyId_idx" ON "PolicyInsuredAsset"("policyId");
CREATE INDEX "PolicyInsuredAsset_assetType_idx" ON "PolicyInsuredAsset"("assetType");
CREATE INDEX "PolicyInsuredAsset_serialNumber_idx" ON "PolicyInsuredAsset"("serialNumber");
CREATE INDEX "PolicyInsuredAsset_isPrimary_idx" ON "PolicyInsuredAsset"("isPrimary");
CREATE UNIQUE INDEX "PolicyInsuredAsset_policyId_assetType_description_serialNumber_key"
ON "PolicyInsuredAsset"("policyId", "assetType", "description", "serialNumber");

-- Audit-friendly ledger import batches with row-level issues and actions.
CREATE TABLE "LedgerImportBatch" (
    "id" TEXT NOT NULL,
    "sourceCsvName" TEXT NOT NULL,
    "sourceCsvHash" TEXT NOT NULL,
    "sourcePaidName" TEXT NOT NULL,
    "sourcePaidHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "summaryJson" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LedgerImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "rawJson" TEXT NOT NULL,
    "normalizedJson" TEXT,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "policyId" TEXT,
    "receiptId" TEXT,
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerImportRow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LedgerImportAction" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowId" TEXT,
    "actionType" TEXT NOT NULL,
    "payloadJson" TEXT,
    "performedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerImportAction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LedgerImportIssue" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowId" TEXT,
    "issueType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "detailsJson" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerImportIssue_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "LedgerImportBatch"
ADD CONSTRAINT "LedgerImportBatch_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LedgerImportBatch"
ADD CONSTRAINT "LedgerImportBatch_approvedById_fkey"
FOREIGN KEY ("approvedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LedgerImportRow"
ADD CONSTRAINT "LedgerImportRow_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "LedgerImportBatch"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LedgerImportAction"
ADD CONSTRAINT "LedgerImportAction_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "LedgerImportBatch"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LedgerImportAction"
ADD CONSTRAINT "LedgerImportAction_rowId_fkey"
FOREIGN KEY ("rowId") REFERENCES "LedgerImportRow"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LedgerImportAction"
ADD CONSTRAINT "LedgerImportAction_performedById_fkey"
FOREIGN KEY ("performedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LedgerImportIssue"
ADD CONSTRAINT "LedgerImportIssue_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "LedgerImportBatch"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LedgerImportIssue"
ADD CONSTRAINT "LedgerImportIssue_rowId_fkey"
FOREIGN KEY ("rowId") REFERENCES "LedgerImportRow"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LedgerImportIssue"
ADD CONSTRAINT "LedgerImportIssue_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "LedgerImportBatch_status_idx" ON "LedgerImportBatch"("status");
CREATE INDEX "LedgerImportBatch_createdById_idx" ON "LedgerImportBatch"("createdById");
CREATE INDEX "LedgerImportBatch_approvedById_idx" ON "LedgerImportBatch"("approvedById");
CREATE INDEX "LedgerImportBatch_createdAt_idx" ON "LedgerImportBatch"("createdAt");

CREATE INDEX "LedgerImportRow_batchId_idx" ON "LedgerImportRow"("batchId");
CREATE INDEX "LedgerImportRow_sourceType_idx" ON "LedgerImportRow"("sourceType");
CREATE INDEX "LedgerImportRow_sourceKey_idx" ON "LedgerImportRow"("sourceKey");
CREATE INDEX "LedgerImportRow_status_idx" ON "LedgerImportRow"("status");
CREATE INDEX "LedgerImportRow_policyId_idx" ON "LedgerImportRow"("policyId");
CREATE INDEX "LedgerImportRow_receiptId_idx" ON "LedgerImportRow"("receiptId");
CREATE INDEX "LedgerImportRow_paymentId_idx" ON "LedgerImportRow"("paymentId");

CREATE INDEX "LedgerImportAction_batchId_idx" ON "LedgerImportAction"("batchId");
CREATE INDEX "LedgerImportAction_rowId_idx" ON "LedgerImportAction"("rowId");
CREATE INDEX "LedgerImportAction_actionType_idx" ON "LedgerImportAction"("actionType");
CREATE INDEX "LedgerImportAction_performedById_idx" ON "LedgerImportAction"("performedById");
CREATE INDEX "LedgerImportAction_createdAt_idx" ON "LedgerImportAction"("createdAt");

CREATE INDEX "LedgerImportIssue_batchId_idx" ON "LedgerImportIssue"("batchId");
CREATE INDEX "LedgerImportIssue_rowId_idx" ON "LedgerImportIssue"("rowId");
CREATE INDEX "LedgerImportIssue_issueType_idx" ON "LedgerImportIssue"("issueType");
CREATE INDEX "LedgerImportIssue_severity_idx" ON "LedgerImportIssue"("severity");
CREATE INDEX "LedgerImportIssue_status_idx" ON "LedgerImportIssue"("status");
CREATE INDEX "LedgerImportIssue_reviewedById_idx" ON "LedgerImportIssue"("reviewedById");
CREATE INDEX "LedgerImportIssue_createdAt_idx" ON "LedgerImportIssue"("createdAt");

COMMIT;
