BEGIN;

CREATE TABLE "DataQualitySuppressionRule" (
  "id" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "issueCode" TEXT NOT NULL,
  "criteriaJson" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "reason" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DataQualitySuppressionRule_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ReceiptReconciliationIssue"
ADD COLUMN "suppressedByRuleId" TEXT,
ADD COLUMN "duplicateOfId" TEXT,
ADD COLUMN "mergedAt" TIMESTAMP(3),
ADD COLUMN "mergedById" TEXT;

ALTER TABLE "PolicyRenewalSuggestion"
ADD COLUMN "suppressedByRuleId" TEXT,
ADD COLUMN "duplicateOfId" TEXT,
ADD COLUMN "mergedAt" TIMESTAMP(3),
ADD COLUMN "mergedById" TEXT;

ALTER TABLE "LedgerImportIssue"
ADD COLUMN "suppressedByRuleId" TEXT,
ADD COLUMN "duplicateOfId" TEXT,
ADD COLUMN "mergedAt" TIMESTAMP(3),
ADD COLUMN "mergedById" TEXT;

CREATE UNIQUE INDEX "DataQualitySuppressionRule_category_issueCode_criteriaJson_key"
ON "DataQualitySuppressionRule"("category", "issueCode", "criteriaJson");

CREATE INDEX "DataQualitySuppressionRule_category_idx"
ON "DataQualitySuppressionRule"("category");

CREATE INDEX "DataQualitySuppressionRule_issueCode_idx"
ON "DataQualitySuppressionRule"("issueCode");

CREATE INDEX "DataQualitySuppressionRule_active_idx"
ON "DataQualitySuppressionRule"("active");

CREATE INDEX "DataQualitySuppressionRule_createdById_idx"
ON "DataQualitySuppressionRule"("createdById");

CREATE INDEX "DataQualitySuppressionRule_reviewedById_idx"
ON "DataQualitySuppressionRule"("reviewedById");

CREATE INDEX "DataQualitySuppressionRule_createdAt_idx"
ON "DataQualitySuppressionRule"("createdAt");

CREATE INDEX "ReceiptReconciliationIssue_suppressedByRuleId_idx"
ON "ReceiptReconciliationIssue"("suppressedByRuleId");

CREATE INDEX "ReceiptReconciliationIssue_duplicateOfId_idx"
ON "ReceiptReconciliationIssue"("duplicateOfId");

CREATE INDEX "ReceiptReconciliationIssue_mergedById_idx"
ON "ReceiptReconciliationIssue"("mergedById");

CREATE INDEX "PolicyRenewalSuggestion_suppressedByRuleId_idx"
ON "PolicyRenewalSuggestion"("suppressedByRuleId");

CREATE INDEX "PolicyRenewalSuggestion_duplicateOfId_idx"
ON "PolicyRenewalSuggestion"("duplicateOfId");

CREATE INDEX "PolicyRenewalSuggestion_mergedById_idx"
ON "PolicyRenewalSuggestion"("mergedById");

CREATE INDEX "LedgerImportIssue_suppressedByRuleId_idx"
ON "LedgerImportIssue"("suppressedByRuleId");

CREATE INDEX "LedgerImportIssue_duplicateOfId_idx"
ON "LedgerImportIssue"("duplicateOfId");

CREATE INDEX "LedgerImportIssue_mergedById_idx"
ON "LedgerImportIssue"("mergedById");

ALTER TABLE "DataQualitySuppressionRule"
ADD CONSTRAINT "DataQualitySuppressionRule_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DataQualitySuppressionRule"
ADD CONSTRAINT "DataQualitySuppressionRule_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReceiptReconciliationIssue"
ADD CONSTRAINT "ReceiptReconciliationIssue_suppressedByRuleId_fkey"
FOREIGN KEY ("suppressedByRuleId") REFERENCES "DataQualitySuppressionRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReceiptReconciliationIssue"
ADD CONSTRAINT "ReceiptReconciliationIssue_mergedById_fkey"
FOREIGN KEY ("mergedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PolicyRenewalSuggestion"
ADD CONSTRAINT "PolicyRenewalSuggestion_suppressedByRuleId_fkey"
FOREIGN KEY ("suppressedByRuleId") REFERENCES "DataQualitySuppressionRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PolicyRenewalSuggestion"
ADD CONSTRAINT "PolicyRenewalSuggestion_mergedById_fkey"
FOREIGN KEY ("mergedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LedgerImportIssue"
ADD CONSTRAINT "LedgerImportIssue_suppressedByRuleId_fkey"
FOREIGN KEY ("suppressedByRuleId") REFERENCES "DataQualitySuppressionRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LedgerImportIssue"
ADD CONSTRAINT "LedgerImportIssue_mergedById_fkey"
FOREIGN KEY ("mergedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
