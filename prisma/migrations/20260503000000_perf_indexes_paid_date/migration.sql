-- Performance: speed up "recent paid receipts" lookups in /due-payments and /commissions.
CREATE INDEX IF NOT EXISTS "Receipt_paidDate_idx" ON "Receipt"("paidDate");
