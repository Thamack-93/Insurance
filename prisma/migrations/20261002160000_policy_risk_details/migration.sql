ALTER TABLE "Policy" ADD COLUMN "riskDetails" JSONB;
ALTER TABLE "Policy" ADD COLUMN "riskDetailsReviewRequired" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Policy_organizationId_riskDetailsReviewRequired_idx" ON "Policy"("organizationId", "riskDetailsReviewRequired");
