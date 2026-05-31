-- Add readAt to Alert and supporting indexes for fast unread counting.
ALTER TABLE "Alert" ADD COLUMN "readAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Alert_readAt_idx" ON "Alert"("readAt");
CREATE INDEX IF NOT EXISTS "Alert_status_readAt_idx" ON "Alert"("status", "readAt");
