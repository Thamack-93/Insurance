-- Remove the duplicated policy renewal date and rely on endDate only.
DROP INDEX IF EXISTS "Policy_renewalDate_idx";
ALTER TABLE "Policy" DROP COLUMN IF EXISTS "renewalDate";
