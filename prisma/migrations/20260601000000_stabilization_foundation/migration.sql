BEGIN;

-- Normalize legacy enum-backed columns to TEXT. The actual migration history uses
-- TEXT for these business values, so validation remains an application concern.
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE TEXT USING "role"::TEXT;
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'AGENT';

ALTER TABLE "Client" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Client" ALTER COLUMN "type" TYPE TEXT USING "type"::TEXT;
ALTER TABLE "Client" ALTER COLUMN "type" SET DEFAULT 'PERSON';
ALTER TABLE "Client" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Client" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Client" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

ALTER TABLE "Insurer" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Insurer" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Insurer" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

ALTER TABLE "Policy" ALTER COLUMN "policyType" TYPE TEXT USING "policyType"::TEXT;
ALTER TABLE "Policy" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Policy" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Policy" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
ALTER TABLE "Policy" ALTER COLUMN "paymentFrequency" TYPE TEXT USING "paymentFrequency"::TEXT;

ALTER TABLE "Receipt" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Receipt" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Receipt" ALTER COLUMN "status" SET DEFAULT 'PENDING';

ALTER TABLE "Commission" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Commission" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Commission" ALTER COLUMN "status" SET DEFAULT 'EXPECTED';

ALTER TABLE "Task" ALTER COLUMN "taskType" DROP DEFAULT;
ALTER TABLE "Task" ALTER COLUMN "taskType" TYPE TEXT USING "taskType"::TEXT;
ALTER TABLE "Task" ALTER COLUMN "taskType" SET DEFAULT 'GENERAL';
ALTER TABLE "Task" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Task" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'OPEN';
ALTER TABLE "Task" ALTER COLUMN "priority" DROP DEFAULT;
ALTER TABLE "Task" ALTER COLUMN "priority" TYPE TEXT USING "priority"::TEXT;
ALTER TABLE "Task" ALTER COLUMN "priority" SET DEFAULT 'MEDIUM';

ALTER TABLE "WorkItem" ALTER COLUMN "priority" DROP DEFAULT;
ALTER TABLE "WorkItem" ALTER COLUMN "priority" TYPE TEXT USING "priority"::TEXT;
ALTER TABLE "WorkItem" ALTER COLUMN "priority" SET DEFAULT 'MEDIUM';
ALTER TABLE "WorkItem" ALTER COLUMN "severity" TYPE TEXT USING "severity"::TEXT;
ALTER TABLE "WorkItem" ALTER COLUMN "workItemType" DROP DEFAULT;
ALTER TABLE "WorkItem" ALTER COLUMN "workItemType" TYPE TEXT USING "workItemType"::TEXT;
ALTER TABLE "WorkItem" ALTER COLUMN "workItemType" SET DEFAULT 'TASK';
ALTER TABLE "WorkItem" ALTER COLUMN "taskType" TYPE TEXT USING "taskType"::TEXT;
ALTER TABLE "WorkItem" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "WorkItem" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "WorkItem" ALTER COLUMN "status" SET DEFAULT 'OPEN';

ALTER TABLE "Claim" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Claim" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Claim" ALTER COLUMN "status" SET DEFAULT 'OPEN';

ALTER TABLE "Quote" ALTER COLUMN "policyType" TYPE TEXT USING "policyType"::TEXT;
ALTER TABLE "Quote" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Quote" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Quote" ALTER COLUMN "status" SET DEFAULT 'REQUESTED';

ALTER TABLE "Document" ALTER COLUMN "documentType" DROP DEFAULT;
ALTER TABLE "Document" ALTER COLUMN "documentType" TYPE TEXT USING "documentType"::TEXT;
ALTER TABLE "Document" ALTER COLUMN "documentType" SET DEFAULT 'OTHER';

ALTER TABLE "Alert" ALTER COLUMN "severity" TYPE TEXT USING "severity"::TEXT;
ALTER TABLE "Alert" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Alert" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Alert" ALTER COLUMN "status" SET DEFAULT 'OPEN';

ALTER TABLE "NotificationPreference" ALTER COLUMN "minPriority" DROP DEFAULT;
ALTER TABLE "NotificationPreference" ALTER COLUMN "minPriority" TYPE TEXT USING "minPriority"::TEXT;
ALTER TABLE "NotificationPreference" ALTER COLUMN "minPriority" SET DEFAULT 'MEDIUM';
ALTER TABLE "NotificationChannel" ALTER COLUMN "type" TYPE TEXT USING "type"::TEXT;
ALTER TABLE "NotificationPreference" ALTER COLUMN "channelType" TYPE TEXT USING "channelType"::TEXT;

ALTER TABLE "NotificationEvent" ALTER COLUMN "priority" DROP DEFAULT;
ALTER TABLE "NotificationEvent" ALTER COLUMN "priority" TYPE TEXT USING "priority"::TEXT;
ALTER TABLE "NotificationEvent" ALTER COLUMN "priority" SET DEFAULT 'MEDIUM';
ALTER TABLE "NotificationEvent" ALTER COLUMN "channelType" TYPE TEXT USING "channelType"::TEXT;
ALTER TABLE "NotificationEvent" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "NotificationEvent" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "NotificationEvent" ALTER COLUMN "status" SET DEFAULT 'PENDING';

DROP TYPE IF EXISTS "AlertSeverity";
DROP TYPE IF EXISTS "AlertStatus";
DROP TYPE IF EXISTS "ClaimStatus";
DROP TYPE IF EXISTS "ClientType";
DROP TYPE IF EXISTS "CommissionStatus";
DROP TYPE IF EXISTS "DocumentType";
DROP TYPE IF EXISTS "EntityStatus";
DROP TYPE IF EXISTS "PaymentFrequency";
DROP TYPE IF EXISTS "PolicyStatus";
DROP TYPE IF EXISTS "PolicyType";
DROP TYPE IF EXISTS "Priority";
DROP TYPE IF EXISTS "QuoteStatus";
DROP TYPE IF EXISTS "ReceiptStatus";
DROP TYPE IF EXISTS "TaskStatus";
DROP TYPE IF EXISTS "TaskType";
DROP TYPE IF EXISTS "UserRole";
DROP TYPE IF EXISTS "ReminderStatus";
DROP TYPE IF EXISTS "WorkItemType";
DROP TYPE IF EXISTS "WorkItemStatus";
DROP TYPE IF EXISTS "NotificationChannelType";
DROP TYPE IF EXISTS "NotificationEventStatus";

-- Normalize legacy decimal precision and audit constraint metadata so the
-- database created by migrations matches the Prisma contract exactly.
ALTER TABLE "Policy" ALTER COLUMN "premiumAmount" TYPE DECIMAL(65,30) USING "premiumAmount"::DECIMAL(65,30);
ALTER TABLE "Receipt" ALTER COLUMN "amount" TYPE DECIMAL(65,30) USING "amount"::DECIMAL(65,30);
ALTER TABLE "Payment" ALTER COLUMN "amount" TYPE DECIMAL(65,30) USING "amount"::DECIMAL(65,30);
ALTER TABLE "Commission" ALTER COLUMN "expectedAmount" TYPE DECIMAL(65,30) USING "expectedAmount"::DECIMAL(65,30);
ALTER TABLE "Commission" ALTER COLUMN "actualAmount" TYPE DECIMAL(65,30) USING "actualAmount"::DECIMAL(65,30);
ALTER TABLE "Commission" ALTER COLUMN "percentage" TYPE DECIMAL(65,30) USING "percentage"::DECIMAL(65,30);
ALTER TABLE "Claim" ALTER COLUMN "amountClaimed" TYPE DECIMAL(65,30) USING "amountClaimed"::DECIMAL(65,30);
ALTER TABLE "Claim" ALTER COLUMN "amountPaid" TYPE DECIMAL(65,30) USING "amountPaid"::DECIMAL(65,30);
ALTER TABLE "Quote" ALTER COLUMN "quotedAmount" TYPE DECIMAL(65,30) USING "quotedAmount"::DECIMAL(65,30);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = '"ActivityLog"'::regclass
          AND conname = 'new_ActivityLog_pkey'
    ) THEN
        ALTER TABLE "ActivityLog" RENAME CONSTRAINT "new_ActivityLog_pkey" TO "ActivityLog_pkey";
    END IF;
END
$$;

ALTER TABLE "Client" DROP CONSTRAINT IF EXISTS "Client_createdById_fkey";
ALTER TABLE "Client" DROP CONSTRAINT IF EXISTS "Client_updatedById_fkey";
ALTER TABLE "Policy" DROP CONSTRAINT IF EXISTS "Policy_createdById_fkey";
ALTER TABLE "Policy" DROP CONSTRAINT IF EXISTS "Policy_updatedById_fkey";
ALTER TABLE "Receipt" DROP CONSTRAINT IF EXISTS "Receipt_createdById_fkey";
ALTER TABLE "Receipt" DROP CONSTRAINT IF EXISTS "Receipt_updatedById_fkey";
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_createdById_fkey";
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_updatedById_fkey";
ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_createdById_fkey";
ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_updatedById_fkey";
ALTER TABLE "Claim" DROP CONSTRAINT IF EXISTS "Claim_createdById_fkey";
ALTER TABLE "Claim" DROP CONSTRAINT IF EXISTS "Claim_updatedById_fkey";
ALTER TABLE "Quote" DROP CONSTRAINT IF EXISTS "Quote_createdById_fkey";
ALTER TABLE "Quote" DROP CONSTRAINT IF EXISTS "Quote_updatedById_fkey";
ALTER TABLE "Document" DROP CONSTRAINT IF EXISTS "Document_createdById_fkey";
ALTER TABLE "Document" DROP CONSTRAINT IF EXISTS "Document_updatedById_fkey";

ALTER TABLE "Client" ADD CONSTRAINT "Client_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Client" ADD CONSTRAINT "Client_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Agent portfolio ownership and delegated operational work.
ALTER TABLE "User" ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'America/Mexico_City';
ALTER TABLE "Client" ADD COLUMN "portfolioOwnerId" TEXT;
ALTER TABLE "WorkItem" ADD COLUMN "assignedToId" TEXT;

ALTER TABLE "Client"
ADD CONSTRAINT "Client_portfolioOwnerId_fkey"
FOREIGN KEY ("portfolioOwnerId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkItem"
ADD CONSTRAINT "WorkItem_assignedToId_fkey"
FOREIGN KEY ("assignedToId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Client_portfolioOwnerId_idx" ON "Client"("portfolioOwnerId");
CREATE INDEX "WorkItem_assignedToId_idx" ON "WorkItem"("assignedToId");

-- A Policy remains one vigencia. These fields express renewal chains without
-- collapsing historical receipts or payments into the current term.
ALTER TABLE "Policy" ADD COLUMN "renewedFromPolicyId" TEXT;
ALTER TABLE "Policy" ADD COLUMN "isMultiYearContract" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "Policy"
ADD CONSTRAINT "Policy_renewedFromPolicyId_fkey"
FOREIGN KEY ("renewedFromPolicyId") REFERENCES "Policy"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Policy_renewedFromPolicyId_idx" ON "Policy"("renewedFromPolicyId");

-- Payment evidence and receipt reconciliation metadata.
ALTER TABLE "Payment" ADD COLUMN "sourceEvidenceKey" TEXT;
ALTER TABLE "Receipt" ADD COLUMN "reconciliationAdjustment" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "Receipt" ADD COLUMN "reconciliationNote" TEXT;

CREATE UNIQUE INDEX "Payment_sourceEvidenceKey_key" ON "Payment"("sourceEvidenceKey");

-- Maintenance runs capture auditable data-repair batches.
CREATE TABLE "MaintenanceRun" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "summaryJson" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MaintenanceRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "MaintenanceRun_type_idx" ON "MaintenanceRun"("type");
CREATE INDEX "MaintenanceRun_status_idx" ON "MaintenanceRun"("status");
CREATE INDEX "MaintenanceRun_startedAt_idx" ON "MaintenanceRun"("startedAt");
CREATE INDEX "MaintenanceRun_createdById_idx" ON "MaintenanceRun"("createdById");

CREATE TABLE "ReceiptReconciliationIssue" (
    "id" TEXT NOT NULL,
    "maintenanceRunId" TEXT,
    "receiptId" TEXT,
    "policyId" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "detailsJson" TEXT,
    "expectedAmount" DECIMAL(65,30),
    "paidAmount" DECIMAL(65,30),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptReconciliationIssue_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReceiptReconciliationIssue_maintenanceRunId_fkey" FOREIGN KEY ("maintenanceRunId") REFERENCES "MaintenanceRun"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReceiptReconciliationIssue_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReceiptReconciliationIssue_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReceiptReconciliationIssue_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ReceiptReconciliationIssue_maintenanceRunId_idx" ON "ReceiptReconciliationIssue"("maintenanceRunId");
CREATE INDEX "ReceiptReconciliationIssue_receiptId_idx" ON "ReceiptReconciliationIssue"("receiptId");
CREATE INDEX "ReceiptReconciliationIssue_policyId_idx" ON "ReceiptReconciliationIssue"("policyId");
CREATE INDEX "ReceiptReconciliationIssue_reason_idx" ON "ReceiptReconciliationIssue"("reason");
CREATE INDEX "ReceiptReconciliationIssue_status_idx" ON "ReceiptReconciliationIssue"("status");
CREATE INDEX "ReceiptReconciliationIssue_reviewedById_idx" ON "ReceiptReconciliationIssue"("reviewedById");
CREATE INDEX "ReceiptReconciliationIssue_createdAt_idx" ON "ReceiptReconciliationIssue"("createdAt");

CREATE TABLE "PolicyRenewalSuggestion" (
    "id" TEXT NOT NULL,
    "maintenanceRunId" TEXT,
    "sourcePolicyId" TEXT NOT NULL,
    "targetPolicyId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "confidence" DECIMAL(65,30),
    "reason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyRenewalSuggestion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PolicyRenewalSuggestion_maintenanceRunId_fkey" FOREIGN KEY ("maintenanceRunId") REFERENCES "MaintenanceRun"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PolicyRenewalSuggestion_sourcePolicyId_fkey" FOREIGN KEY ("sourcePolicyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PolicyRenewalSuggestion_targetPolicyId_fkey" FOREIGN KEY ("targetPolicyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PolicyRenewalSuggestion_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PolicyRenewalSuggestion_sourcePolicyId_targetPolicyId_key" ON "PolicyRenewalSuggestion"("sourcePolicyId", "targetPolicyId");
CREATE INDEX "PolicyRenewalSuggestion_maintenanceRunId_idx" ON "PolicyRenewalSuggestion"("maintenanceRunId");
CREATE INDEX "PolicyRenewalSuggestion_sourcePolicyId_idx" ON "PolicyRenewalSuggestion"("sourcePolicyId");
CREATE INDEX "PolicyRenewalSuggestion_targetPolicyId_idx" ON "PolicyRenewalSuggestion"("targetPolicyId");
CREATE INDEX "PolicyRenewalSuggestion_status_idx" ON "PolicyRenewalSuggestion"("status");
CREATE INDEX "PolicyRenewalSuggestion_reviewedById_idx" ON "PolicyRenewalSuggestion"("reviewedById");
CREATE INDEX "PolicyRenewalSuggestion_createdAt_idx" ON "PolicyRenewalSuggestion"("createdAt");

-- Telegram drafts are temporary, auditable input buffers. Confirming a draft is
-- intentionally separate from creating a financial record.
CREATE TABLE "TelegramDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COLLECTING',
    "payloadJson" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramDraft_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TelegramDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TelegramDraft_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "NotificationChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "TelegramDraft_userId_idx" ON "TelegramDraft"("userId");
CREATE INDEX "TelegramDraft_channelId_idx" ON "TelegramDraft"("channelId");
CREATE INDEX "TelegramDraft_type_idx" ON "TelegramDraft"("type");
CREATE INDEX "TelegramDraft_status_idx" ON "TelegramDraft"("status");
CREATE INDEX "TelegramDraft_expiresAt_idx" ON "TelegramDraft"("expiresAt");
CREATE INDEX "TelegramDraft_userId_status_idx" ON "TelegramDraft"("userId", "status");

COMMIT;
