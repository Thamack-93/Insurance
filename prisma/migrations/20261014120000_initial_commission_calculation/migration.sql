ALTER TABLE "Insurer"
  ADD COLUMN "commissionRules" JSONB,
  ADD COLUMN "commissionRulesVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "PolicyInsuredAsset"
  ADD COLUMN "unitClass" TEXT;

ALTER TABLE "Receipt"
  ADD COLUMN "premiumBreakdownByUnit" JSONB,
  ADD COLUMN "commissionCalculationStatus" TEXT NOT NULL DEFAULT 'NOT_CALCULATED',
  ADD COLUMN "commissionReviewReason" TEXT;

ALTER TABLE "Commission"
  ADD COLUMN "calculationBreakdownJson" TEXT;

-- Existing receipts have no captured shared premium breakdown. Flag them for
-- operator review without inferring components or changing saved commissions.
UPDATE "Receipt"
SET "commissionCalculationStatus" = 'REVIEW',
    "commissionReviewReason" = 'Falta capturar IVA, gastos de expedición, recargo fraccionado y descuentos visibles.';
