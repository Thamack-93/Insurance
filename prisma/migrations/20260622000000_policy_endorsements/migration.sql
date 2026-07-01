BEGIN;

CREATE TABLE "PolicyEndorsement" (
  "id" TEXT NOT NULL,
  "endorsementNumber" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(65,30) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'MXN',
  "reference" TEXT,
  "concept" TEXT,
  "notes" TEXT,
  "documentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT,
  "updatedById" TEXT,

  CONSTRAINT "PolicyEndorsement_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Receipt"
ADD COLUMN "endorsementId" TEXT;

ALTER TABLE "Document"
ADD COLUMN "endorsementId" TEXT;

CREATE UNIQUE INDEX "PolicyEndorsement_policyId_endorsementNumber_key"
ON "PolicyEndorsement"("policyId", "endorsementNumber");

CREATE UNIQUE INDEX "PolicyEndorsement_documentId_key"
ON "PolicyEndorsement"("documentId");

CREATE INDEX "PolicyEndorsement_policyId_idx"
ON "PolicyEndorsement"("policyId");

CREATE INDEX "PolicyEndorsement_status_idx"
ON "PolicyEndorsement"("status");

CREATE INDEX "PolicyEndorsement_startDate_idx"
ON "PolicyEndorsement"("startDate");

CREATE INDEX "PolicyEndorsement_endDate_idx"
ON "PolicyEndorsement"("endDate");

CREATE INDEX "PolicyEndorsement_createdById_idx"
ON "PolicyEndorsement"("createdById");

CREATE INDEX "PolicyEndorsement_updatedById_idx"
ON "PolicyEndorsement"("updatedById");

CREATE INDEX "Receipt_endorsementId_idx"
ON "Receipt"("endorsementId");

CREATE INDEX "Document_endorsementId_idx"
ON "Document"("endorsementId");

ALTER TABLE "PolicyEndorsement"
ADD CONSTRAINT "PolicyEndorsement_policyId_fkey"
FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PolicyEndorsement"
ADD CONSTRAINT "PolicyEndorsement_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PolicyEndorsement"
ADD CONSTRAINT "PolicyEndorsement_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PolicyEndorsement"
ADD CONSTRAINT "PolicyEndorsement_updatedById_fkey"
FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Receipt"
ADD CONSTRAINT "Receipt_endorsementId_fkey"
FOREIGN KEY ("endorsementId") REFERENCES "PolicyEndorsement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Document"
ADD CONSTRAINT "Document_endorsementId_fkey"
FOREIGN KEY ("endorsementId") REFERENCES "PolicyEndorsement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
