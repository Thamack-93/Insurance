ALTER TABLE "Task" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "WorkItem" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "WorkItem" ADD COLUMN "metadataJson" TEXT;
ALTER TABLE "Claim" ADD COLUMN "assignedToId" TEXT;
ALTER TABLE "Claim" ADD COLUMN "dueDate" TIMESTAMP(3);
ALTER TABLE "Claim" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ClaimChecklistItem" ADD COLUMN "assignedToId" TEXT;
ALTER TABLE "ClaimChecklistItem" ADD COLUMN "dueDate" TIMESTAMP(3);
ALTER TABLE "ClaimChecklistItem" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Quote" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Document" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Document" ADD COLUMN "metadataJson" TEXT;
ALTER TABLE "Commission" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "Claim_assignedToId_dueDate_idx" ON "Claim"("assignedToId", "dueDate");
CREATE INDEX "ClaimChecklistItem_assignedToId_dueDate_idx" ON "ClaimChecklistItem"("assignedToId", "dueDate");

ALTER TABLE "Claim" ADD CONSTRAINT "Claim_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClaimChecklistItem" ADD CONSTRAINT "ClaimChecklistItem_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CommissionStatement" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "sourceFileName" TEXT NOT NULL,
  "sourceFilePath" TEXT,
  "mimeType" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'REVIEW',
  "summaryJson" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdById" TEXT,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommissionStatement_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CommissionStatementRow" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "statementId" TEXT NOT NULL,
  "sourceRowKey" TEXT NOT NULL,
  "sourcePage" INTEGER,
  "rawJson" TEXT NOT NULL,
  "normalizedJson" TEXT,
  "policyNumber" TEXT,
  "receiptNumber" TEXT,
  "currency" TEXT,
  "amount" DECIMAL(65,30),
  "paymentDate" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'REVIEW',
  "matchReason" TEXT,
  "discrepancyReason" TEXT,
  "commissionId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommissionStatementRow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommissionStatement_organizationId_sourceHash_key" ON "CommissionStatement"("organizationId", "sourceHash");
CREATE UNIQUE INDEX "CommissionStatementRow_statementId_sourceRowKey_key" ON "CommissionStatementRow"("statementId", "sourceRowKey");
CREATE INDEX "CommissionStatement_organizationId_status_idx" ON "CommissionStatement"("organizationId", "status");
CREATE INDEX "CommissionStatement_organizationId_idx" ON "CommissionStatement"("organizationId");
CREATE INDEX "CommissionStatement_createdAt_idx" ON "CommissionStatement"("createdAt");
CREATE INDEX "CommissionStatementRow_organizationId_status_idx" ON "CommissionStatementRow"("organizationId", "status");
CREATE INDEX "CommissionStatementRow_organizationId_idx" ON "CommissionStatementRow"("organizationId");
CREATE INDEX "CommissionStatementRow_commissionId_idx" ON "CommissionStatementRow"("commissionId");
CREATE INDEX "CommissionStatementRow_policyNumber_idx" ON "CommissionStatementRow"("policyNumber");
CREATE INDEX "CommissionStatementRow_receiptNumber_idx" ON "CommissionStatementRow"("receiptNumber");
ALTER TABLE "CommissionStatement" ADD CONSTRAINT "CommissionStatement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionStatement" ADD CONSTRAINT "CommissionStatement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommissionStatement" ADD CONSTRAINT "CommissionStatement_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommissionStatementRow" ADD CONSTRAINT "CommissionStatementRow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionStatementRow" ADD CONSTRAINT "CommissionStatementRow_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "CommissionStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommissionStatementRow" ADD CONSTRAINT "CommissionStatementRow_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "Commission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "QuoteComparison" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "policyType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "selectedQuoteId" TEXT,
  "selectedAt" TIMESTAMP(3),
  "selectionReason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QuoteComparison_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "QuoteComparisonItem" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "comparisonId" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "termsJson" TEXT,
  "sourceDocumentId" TEXT,
  "reviewStatus" TEXT NOT NULL DEFAULT 'REVIEW',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QuoteComparisonItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "QuoteComparisonItem_comparisonId_quoteId_key" ON "QuoteComparisonItem"("comparisonId", "quoteId");
CREATE INDEX "QuoteComparison_organizationId_clientId_idx" ON "QuoteComparison"("organizationId", "clientId");
CREATE INDEX "QuoteComparison_organizationId_idx" ON "QuoteComparison"("organizationId");
CREATE INDEX "QuoteComparison_status_idx" ON "QuoteComparison"("status");
CREATE INDEX "QuoteComparisonItem_organizationId_idx" ON "QuoteComparisonItem"("organizationId");
CREATE INDEX "QuoteComparisonItem_quoteId_idx" ON "QuoteComparisonItem"("quoteId");
ALTER TABLE "QuoteComparison" ADD CONSTRAINT "QuoteComparison_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuoteComparison" ADD CONSTRAINT "QuoteComparison_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuoteComparison" ADD CONSTRAINT "QuoteComparison_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QuoteComparisonItem" ADD CONSTRAINT "QuoteComparisonItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuoteComparisonItem" ADD CONSTRAINT "QuoteComparisonItem_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "QuoteComparison"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuoteComparisonItem" ADD CONSTRAINT "QuoteComparisonItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TRIGGER "CommissionStatement_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "CommissionStatement"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();
CREATE TRIGGER "CommissionStatementRow_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "CommissionStatementRow"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();
CREATE TRIGGER "QuoteComparison_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "QuoteComparison"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();
CREATE TRIGGER "QuoteComparisonItem_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "QuoteComparisonItem"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

CREATE TABLE "CommissionCorrection" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "commissionId" TEXT NOT NULL,
  "statementRowId" TEXT,
  "actorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "priorValuesJson" TEXT NOT NULL,
  "currentValuesJson" TEXT NOT NULL,
  "evidenceJson" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommissionCorrection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CommissionCorrection_organizationId_commissionId_idx" ON "CommissionCorrection"("organizationId", "commissionId");
CREATE INDEX "CommissionCorrection_organizationId_idx" ON "CommissionCorrection"("organizationId");
CREATE INDEX "CommissionCorrection_organizationId_createdAt_idx" ON "CommissionCorrection"("organizationId", "createdAt");
CREATE INDEX "CommissionCorrection_statementRowId_idx" ON "CommissionCorrection"("statementRowId");
ALTER TABLE "CommissionCorrection" ADD CONSTRAINT "CommissionCorrection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionCorrection" ADD CONSTRAINT "CommissionCorrection_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "Commission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionCorrection" ADD CONSTRAINT "CommissionCorrection_statementRowId_fkey" FOREIGN KEY ("statementRowId") REFERENCES "CommissionStatementRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommissionCorrection" ADD CONSTRAINT "CommissionCorrection_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER "CommissionCorrection_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "CommissionCorrection"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();
