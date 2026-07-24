ALTER TABLE "Policy"
  ADD COLUMN "cancellationReason" TEXT,
  ADD COLUMN "cancellationBatchId" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMP(3);

ALTER TABLE "Receipt"
  ADD COLUMN "cancellationReason" TEXT,
  ADD COLUMN "cancellationBatchId" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMP(3);

CREATE INDEX "Policy_cancellationBatchId_idx" ON "Policy"("cancellationBatchId");
CREATE INDEX "Receipt_cancellationBatchId_idx" ON "Receipt"("cancellationBatchId");

ALTER TABLE "Payment"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'POSTED',
  ADD COLUMN "reversedById" TEXT,
  ADD COLUMN "reversedAt" TIMESTAMP(3),
  ADD COLUMN "reversalReason" TEXT;

CREATE INDEX "Payment_status_idx" ON "Payment"("status");
CREATE INDEX "Payment_reversedById_idx" ON "Payment"("reversedById");

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_reversedById_fkey"
  FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
