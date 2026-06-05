BEGIN;

ALTER TABLE "PolicyRenewalSuggestion"
ALTER COLUMN "targetPolicyId" DROP NOT NULL;

CREATE INDEX "PolicyRenewalSuggestion_sourcePolicyId_status_idx"
ON "PolicyRenewalSuggestion"("sourcePolicyId", "status");

COMMIT;
