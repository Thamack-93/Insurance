-- Add columns for audit authorship
ALTER TABLE "Claim" ADD COLUMN "createdById" TEXT;
ALTER TABLE "Claim" ADD COLUMN "updatedById" TEXT;

ALTER TABLE "Client" ADD COLUMN "createdById" TEXT;
ALTER TABLE "Client" ADD COLUMN "updatedById" TEXT;

ALTER TABLE "Document" ADD COLUMN "createdById" TEXT;
ALTER TABLE "Document" ADD COLUMN "updatedById" TEXT;

ALTER TABLE "Payment" ADD COLUMN "createdById" TEXT;
ALTER TABLE "Payment" ADD COLUMN "updatedById" TEXT;

ALTER TABLE "Policy" ADD COLUMN "createdById" TEXT;
ALTER TABLE "Policy" ADD COLUMN "updatedById" TEXT;

ALTER TABLE "Quote" ADD COLUMN "createdById" TEXT;
ALTER TABLE "Quote" ADD COLUMN "updatedById" TEXT;

ALTER TABLE "Receipt" ADD COLUMN "createdById" TEXT;
ALTER TABLE "Receipt" ADD COLUMN "updatedById" TEXT;

ALTER TABLE "Task" ADD COLUMN "createdById" TEXT;
ALTER TABLE "Task" ADD COLUMN "updatedById" TEXT;

-- Foreign keys to User
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Client" ADD CONSTRAINT "Client_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Client" ADD CONSTRAINT "Client_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Document" ADD CONSTRAINT "Document_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Policy" ADD CONSTRAINT "Policy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Quote" ADD CONSTRAINT "Quote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes for audit authorship
CREATE INDEX "Claim_createdById_idx" ON "Claim"("createdById");
CREATE INDEX "Claim_updatedById_idx" ON "Claim"("updatedById");

CREATE INDEX "Client_createdById_idx" ON "Client"("createdById");
CREATE INDEX "Client_updatedById_idx" ON "Client"("updatedById");

CREATE INDEX "Document_createdById_idx" ON "Document"("createdById");
CREATE INDEX "Document_updatedById_idx" ON "Document"("updatedById");

CREATE INDEX "Payment_createdById_idx" ON "Payment"("createdById");
CREATE INDEX "Payment_updatedById_idx" ON "Payment"("updatedById");

CREATE INDEX "Policy_createdById_idx" ON "Policy"("createdById");
CREATE INDEX "Policy_updatedById_idx" ON "Policy"("updatedById");

CREATE INDEX "Quote_createdById_idx" ON "Quote"("createdById");
CREATE INDEX "Quote_updatedById_idx" ON "Quote"("updatedById");

CREATE INDEX "Receipt_createdById_idx" ON "Receipt"("createdById");
CREATE INDEX "Receipt_updatedById_idx" ON "Receipt"("updatedById");

CREATE INDEX "Task_createdById_idx" ON "Task"("createdById");
CREATE INDEX "Task_updatedById_idx" ON "Task"("updatedById");

CREATE INDEX "ActivityLog_entityType_entityId_createdAt_idx" ON "ActivityLog"("entityType", "entityId", "createdAt");
