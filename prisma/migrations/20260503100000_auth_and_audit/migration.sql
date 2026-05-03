-- CreateTable User
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_email_idx" ON "User"("email");

-- Seed System user (fixed id for backfill of historic rows)
INSERT INTO "User" ("id", "email", "name", "passwordHash", "createdAt", "updatedAt")
VALUES ('system-user-0000', 'system@policydesk.local', 'Sistema', '!disabled', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Add audit columns to Client
ALTER TABLE "Client" ADD COLUMN "createdById" TEXT REFERENCES "User"("id") ON DELETE SET NULL;
ALTER TABLE "Client" ADD COLUMN "updatedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL;
UPDATE "Client" SET "createdById" = 'system-user-0000', "updatedById" = 'system-user-0000';
CREATE INDEX "Client_createdById_idx" ON "Client"("createdById");
CREATE INDEX "Client_updatedById_idx" ON "Client"("updatedById");

-- Add audit columns to Policy
ALTER TABLE "Policy" ADD COLUMN "createdById" TEXT REFERENCES "User"("id") ON DELETE SET NULL;
ALTER TABLE "Policy" ADD COLUMN "updatedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL;
UPDATE "Policy" SET "createdById" = 'system-user-0000', "updatedById" = 'system-user-0000';
CREATE INDEX "Policy_createdById_idx" ON "Policy"("createdById");
CREATE INDEX "Policy_updatedById_idx" ON "Policy"("updatedById");

-- Add audit columns to Receipt
ALTER TABLE "Receipt" ADD COLUMN "createdById" TEXT REFERENCES "User"("id") ON DELETE SET NULL;
ALTER TABLE "Receipt" ADD COLUMN "updatedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL;
UPDATE "Receipt" SET "createdById" = 'system-user-0000', "updatedById" = 'system-user-0000';
CREATE INDEX "Receipt_createdById_idx" ON "Receipt"("createdById");
CREATE INDEX "Receipt_updatedById_idx" ON "Receipt"("updatedById");

-- Add audit columns to Payment
ALTER TABLE "Payment" ADD COLUMN "createdById" TEXT REFERENCES "User"("id") ON DELETE SET NULL;
ALTER TABLE "Payment" ADD COLUMN "updatedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL;
UPDATE "Payment" SET "createdById" = 'system-user-0000', "updatedById" = 'system-user-0000';
CREATE INDEX "Payment_createdById_idx" ON "Payment"("createdById");
CREATE INDEX "Payment_updatedById_idx" ON "Payment"("updatedById");

-- Add audit columns to Claim
ALTER TABLE "Claim" ADD COLUMN "createdById" TEXT REFERENCES "User"("id") ON DELETE SET NULL;
ALTER TABLE "Claim" ADD COLUMN "updatedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL;
UPDATE "Claim" SET "createdById" = 'system-user-0000', "updatedById" = 'system-user-0000';
CREATE INDEX "Claim_createdById_idx" ON "Claim"("createdById");
CREATE INDEX "Claim_updatedById_idx" ON "Claim"("updatedById");

-- Add audit columns to Quote
ALTER TABLE "Quote" ADD COLUMN "createdById" TEXT REFERENCES "User"("id") ON DELETE SET NULL;
ALTER TABLE "Quote" ADD COLUMN "updatedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL;
UPDATE "Quote" SET "createdById" = 'system-user-0000', "updatedById" = 'system-user-0000';
CREATE INDEX "Quote_createdById_idx" ON "Quote"("createdById");
CREATE INDEX "Quote_updatedById_idx" ON "Quote"("updatedById");

-- Add audit columns to Task
ALTER TABLE "Task" ADD COLUMN "createdById" TEXT REFERENCES "User"("id") ON DELETE SET NULL;
ALTER TABLE "Task" ADD COLUMN "updatedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL;
UPDATE "Task" SET "createdById" = 'system-user-0000', "updatedById" = 'system-user-0000';
CREATE INDEX "Task_createdById_idx" ON "Task"("createdById");
CREATE INDEX "Task_updatedById_idx" ON "Task"("updatedById");

-- Add audit columns to Document
ALTER TABLE "Document" ADD COLUMN "createdById" TEXT REFERENCES "User"("id") ON DELETE SET NULL;
ALTER TABLE "Document" ADD COLUMN "updatedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL;
UPDATE "Document" SET "createdById" = 'system-user-0000', "updatedById" = 'system-user-0000';
CREATE INDEX "Document_createdById_idx" ON "Document"("createdById");
CREATE INDEX "Document_updatedById_idx" ON "Document"("updatedById");

-- Recreate ActivityLog: rename performedBy -> userId and drop default
CREATE TABLE "new_ActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL
);
INSERT INTO "new_ActivityLog" ("id", "entityType", "entityId", "action", "oldValue", "newValue", "createdAt", "userId")
SELECT
    "id", "entityType", "entityId", "action", "oldValue", "newValue", "createdAt",
    CASE
        WHEN "performedBy" IS NULL OR "performedBy" = '' OR "performedBy" IN ('local-user', 'local-ui')
            THEN 'system-user-0000'
        ELSE "performedBy"
    END
FROM "ActivityLog";
DROP TABLE "ActivityLog";
ALTER TABLE "new_ActivityLog" RENAME TO "ActivityLog";
CREATE INDEX "ActivityLog_entityType_entityId_idx" ON "ActivityLog"("entityType", "entityId");
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");
CREATE INDEX "ActivityLog_action_idx" ON "ActivityLog"("action");
CREATE INDEX "ActivityLog_userId_idx" ON "ActivityLog"("userId");
