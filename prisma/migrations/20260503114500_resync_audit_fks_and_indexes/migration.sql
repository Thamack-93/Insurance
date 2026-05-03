
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Claim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "folio" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "insurerId" TEXT NOT NULL,
    "claimType" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "incidentDate" DATETIME NOT NULL,
    "reportedDate" DATETIME NOT NULL,
    "closedDate" DATETIME,
    "amountClaimed" DECIMAL,
    "amountPaid" DECIMAL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    CONSTRAINT "Claim_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Claim_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Claim_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "Insurer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Claim_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Claim_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Claim" ("amountClaimed", "amountPaid", "claimType", "clientId", "closedDate", "createdAt", "createdById", "description", "folio", "id", "incidentDate", "insurerId", "notes", "policyId", "reportedDate", "status", "updatedAt", "updatedById") SELECT "amountClaimed", "amountPaid", "claimType", "clientId", "closedDate", "createdAt", "createdById", "description", "folio", "id", "incidentDate", "insurerId", "notes", "policyId", "reportedDate", "status", "updatedAt", "updatedById" FROM "Claim";
DROP TABLE "Claim";
ALTER TABLE "new_Claim" RENAME TO "Claim";
CREATE INDEX "Claim_folio_idx" ON "Claim"("folio");
CREATE INDEX "Claim_clientId_idx" ON "Claim"("clientId");
CREATE INDEX "Claim_policyId_idx" ON "Claim"("policyId");
CREATE INDEX "Claim_insurerId_idx" ON "Claim"("insurerId");
CREATE INDEX "Claim_status_idx" ON "Claim"("status");
CREATE INDEX "Claim_createdById_idx" ON "Claim"("createdById");
CREATE INDEX "Claim_updatedById_idx" ON "Claim"("updatedById");
CREATE TABLE "new_Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fullName" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PERSON',
    "email" TEXT,
    "phone" TEXT,
    "secondaryPhone" TEXT,
    "rfc" TEXT,
    "address" TEXT,
    "preferredContactMethod" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    CONSTRAINT "Client_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Client_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Client" ("address", "createdAt", "createdById", "email", "fullName", "id", "notes", "phone", "preferredContactMethod", "rfc", "secondaryPhone", "status", "type", "updatedAt", "updatedById") SELECT "address", "createdAt", "createdById", "email", "fullName", "id", "notes", "phone", "preferredContactMethod", "rfc", "secondaryPhone", "status", "type", "updatedAt", "updatedById" FROM "Client";
DROP TABLE "Client";
ALTER TABLE "new_Client" RENAME TO "Client";
CREATE INDEX "Client_fullName_idx" ON "Client"("fullName");
CREATE INDEX "Client_status_idx" ON "Client"("status");
CREATE INDEX "Client_createdById_idx" ON "Client"("createdById");
CREATE INDEX "Client_updatedById_idx" ON "Client"("updatedById");
CREATE TABLE "new_Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT,
    "policyId" TEXT,
    "receiptId" TEXT,
    "taskId" TEXT,
    "claimId" TEXT,
    "quoteId" TEXT,
    "documentType" TEXT NOT NULL DEFAULT 'OTHER',
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    CONSTRAINT "Document_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Document_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Document_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Document_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Document_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Document_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Document_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Document_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Document" ("claimId", "clientId", "createdAt", "createdById", "documentType", "fileName", "filePath", "id", "mimeType", "notes", "policyId", "quoteId", "receiptId", "taskId", "updatedAt", "updatedById", "uploadedAt") SELECT "claimId", "clientId", "createdAt", "createdById", "documentType", "fileName", "filePath", "id", "mimeType", "notes", "policyId", "quoteId", "receiptId", "taskId", "updatedAt", "updatedById", "uploadedAt" FROM "Document";
DROP TABLE "Document";
ALTER TABLE "new_Document" RENAME TO "Document";
CREATE INDEX "Document_clientId_idx" ON "Document"("clientId");
CREATE INDEX "Document_policyId_idx" ON "Document"("policyId");
CREATE INDEX "Document_receiptId_idx" ON "Document"("receiptId");
CREATE INDEX "Document_taskId_idx" ON "Document"("taskId");
CREATE INDEX "Document_claimId_idx" ON "Document"("claimId");
CREATE INDEX "Document_quoteId_idx" ON "Document"("quoteId");
CREATE INDEX "Document_documentType_idx" ON "Document"("documentType");
CREATE INDEX "Document_uploadedAt_idx" ON "Document"("uploadedAt");
CREATE INDEX "Document_createdById_idx" ON "Document"("createdById");
CREATE INDEX "Document_updatedById_idx" ON "Document"("updatedById");
CREATE TABLE "new_Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "receiptId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "paidDate" DATETIME NOT NULL,
    "paymentMethod" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    CONSTRAINT "Payment_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payment_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Payment_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Payment" ("amount", "clientId", "createdAt", "createdById", "currency", "id", "notes", "paidDate", "paymentMethod", "policyId", "receiptId", "reference", "updatedAt", "updatedById") SELECT "amount", "clientId", "createdAt", "createdById", "currency", "id", "notes", "paidDate", "paymentMethod", "policyId", "receiptId", "reference", "updatedAt", "updatedById" FROM "Payment";
DROP TABLE "Payment";
ALTER TABLE "new_Payment" RENAME TO "Payment";
CREATE INDEX "Payment_receiptId_idx" ON "Payment"("receiptId");
CREATE INDEX "Payment_policyId_idx" ON "Payment"("policyId");
CREATE INDEX "Payment_clientId_idx" ON "Payment"("clientId");
CREATE INDEX "Payment_paidDate_idx" ON "Payment"("paidDate");
CREATE INDEX "Payment_createdById_idx" ON "Payment"("createdById");
CREATE INDEX "Payment_updatedById_idx" ON "Payment"("updatedById");
CREATE TABLE "new_Policy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "policyNumber" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "insurerId" TEXT NOT NULL,
    "policyType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "renewalDate" DATETIME,
    "premiumAmount" DECIMAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "paymentFrequency" TEXT NOT NULL,
    "paymentPlan" TEXT,
    "insuredObject" TEXT,
    "beneficiaryInfo" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    CONSTRAINT "Policy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Policy_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "Insurer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Policy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Policy_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Policy" ("beneficiaryInfo", "clientId", "createdAt", "createdById", "currency", "endDate", "id", "insuredObject", "insurerId", "notes", "paymentFrequency", "paymentPlan", "policyNumber", "policyType", "premiumAmount", "renewalDate", "startDate", "status", "updatedAt", "updatedById") SELECT "beneficiaryInfo", "clientId", "createdAt", "createdById", "currency", "endDate", "id", "insuredObject", "insurerId", "notes", "paymentFrequency", "paymentPlan", "policyNumber", "policyType", "premiumAmount", "renewalDate", "startDate", "status", "updatedAt", "updatedById" FROM "Policy";
DROP TABLE "Policy";
ALTER TABLE "new_Policy" RENAME TO "Policy";
CREATE INDEX "Policy_policyNumber_idx" ON "Policy"("policyNumber");
CREATE INDEX "Policy_clientId_idx" ON "Policy"("clientId");
CREATE INDEX "Policy_insurerId_idx" ON "Policy"("insurerId");
CREATE INDEX "Policy_policyType_idx" ON "Policy"("policyType");
CREATE INDEX "Policy_status_idx" ON "Policy"("status");
CREATE INDEX "Policy_renewalDate_idx" ON "Policy"("renewalDate");
CREATE INDEX "Policy_endDate_idx" ON "Policy"("endDate");
CREATE INDEX "Policy_createdById_idx" ON "Policy"("createdById");
CREATE INDEX "Policy_updatedById_idx" ON "Policy"("updatedById");
CREATE TABLE "new_Quote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "insurerId" TEXT,
    "policyType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requestedDate" DATETIME NOT NULL,
    "sentDate" DATETIME,
    "validUntil" DATETIME,
    "quotedAmount" DECIMAL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    CONSTRAINT "Quote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Quote_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "Insurer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Quote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Quote_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Quote" ("clientId", "createdAt", "createdById", "id", "insurerId", "notes", "policyType", "quotedAmount", "requestedDate", "sentDate", "status", "updatedAt", "updatedById", "validUntil") SELECT "clientId", "createdAt", "createdById", "id", "insurerId", "notes", "policyType", "quotedAmount", "requestedDate", "sentDate", "status", "updatedAt", "updatedById", "validUntil" FROM "Quote";
DROP TABLE "Quote";
ALTER TABLE "new_Quote" RENAME TO "Quote";
CREATE INDEX "Quote_clientId_idx" ON "Quote"("clientId");
CREATE INDEX "Quote_insurerId_idx" ON "Quote"("insurerId");
CREATE INDEX "Quote_policyType_idx" ON "Quote"("policyType");
CREATE INDEX "Quote_status_idx" ON "Quote"("status");
CREATE INDEX "Quote_validUntil_idx" ON "Quote"("validUntil");
CREATE INDEX "Quote_createdById_idx" ON "Quote"("createdById");
CREATE INDEX "Quote_updatedById_idx" ON "Quote"("updatedById");
CREATE TABLE "new_Receipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "receiptNumber" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "insurerId" TEXT NOT NULL,
    "periodStartDate" DATETIME NOT NULL,
    "periodEndDate" DATETIME NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "amount" DECIMAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidDate" DATETIME,
    "paymentMethod" TEXT,
    "documentId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    CONSTRAINT "Receipt_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Receipt_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Receipt_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "Insurer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Receipt_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Receipt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Receipt_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Receipt" ("amount", "clientId", "createdAt", "createdById", "currency", "documentId", "dueDate", "id", "insurerId", "notes", "paidDate", "paymentMethod", "periodEndDate", "periodStartDate", "policyId", "receiptNumber", "status", "updatedAt", "updatedById") SELECT "amount", "clientId", "createdAt", "createdById", "currency", "documentId", "dueDate", "id", "insurerId", "notes", "paidDate", "paymentMethod", "periodEndDate", "periodStartDate", "policyId", "receiptNumber", "status", "updatedAt", "updatedById" FROM "Receipt";
DROP TABLE "Receipt";
ALTER TABLE "new_Receipt" RENAME TO "Receipt";
CREATE UNIQUE INDEX "Receipt_documentId_key" ON "Receipt"("documentId");
CREATE INDEX "Receipt_receiptNumber_idx" ON "Receipt"("receiptNumber");
CREATE INDEX "Receipt_policyId_idx" ON "Receipt"("policyId");
CREATE INDEX "Receipt_clientId_idx" ON "Receipt"("clientId");
CREATE INDEX "Receipt_insurerId_idx" ON "Receipt"("insurerId");
CREATE INDEX "Receipt_status_idx" ON "Receipt"("status");
CREATE INDEX "Receipt_dueDate_idx" ON "Receipt"("dueDate");
CREATE INDEX "Receipt_paidDate_idx" ON "Receipt"("paidDate");
CREATE INDEX "Receipt_policyId_receiptNumber_idx" ON "Receipt"("policyId", "receiptNumber");
CREATE INDEX "Receipt_createdById_idx" ON "Receipt"("createdById");
CREATE INDEX "Receipt_updatedById_idx" ON "Receipt"("updatedById");
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "folio" TEXT NOT NULL,
    "clientId" TEXT,
    "policyId" TEXT,
    "insurerId" TEXT,
    "receiptId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "taskType" TEXT NOT NULL DEFAULT 'GENERAL',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "startDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" DATETIME,
    "closedDate" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    CONSTRAINT "Task_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "Insurer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("clientId", "closedDate", "createdAt", "createdById", "description", "dueDate", "folio", "id", "insurerId", "notes", "policyId", "priority", "receiptId", "startDate", "status", "taskType", "title", "updatedAt", "updatedById") SELECT "clientId", "closedDate", "createdAt", "createdById", "description", "dueDate", "folio", "id", "insurerId", "notes", "policyId", "priority", "receiptId", "startDate", "status", "taskType", "title", "updatedAt", "updatedById" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
CREATE INDEX "Task_folio_idx" ON "Task"("folio");
CREATE INDEX "Task_clientId_idx" ON "Task"("clientId");
CREATE INDEX "Task_policyId_idx" ON "Task"("policyId");
CREATE INDEX "Task_insurerId_idx" ON "Task"("insurerId");
CREATE INDEX "Task_receiptId_idx" ON "Task"("receiptId");
CREATE INDEX "Task_status_idx" ON "Task"("status");
CREATE INDEX "Task_priority_idx" ON "Task"("priority");
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");
CREATE INDEX "Task_createdById_idx" ON "Task"("createdById");
CREATE INDEX "Task_updatedById_idx" ON "Task"("updatedById");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ActivityLog_entityType_entityId_createdAt_idx" ON "ActivityLog"("entityType", "entityId", "createdAt");

