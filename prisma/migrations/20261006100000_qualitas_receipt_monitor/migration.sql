ALTER TABLE "Policy"
ADD COLUMN "qualitasReceiptMonitorEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Policy_organizationId_qualitasReceiptMonitorEnabled_status_idx"
ON "Policy"("organizationId", "qualitasReceiptMonitorEnabled", status);
