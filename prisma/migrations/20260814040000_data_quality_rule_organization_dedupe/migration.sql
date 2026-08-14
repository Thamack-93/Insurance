-- Data-quality suppressions are tenant policy. The same rule may exist in two
-- organizations, but duplicates inside one organization remain prohibited.
DROP INDEX "DataQualitySuppressionRule_category_issueCode_criteriaJson_key";

CREATE UNIQUE INDEX "DataQualitySuppressionRule_org_category_issue_criteria_key"
ON "DataQualitySuppressionRule"("organizationId", "category", "issueCode", "criteriaJson");

DROP INDEX "PolicyRenewalSuggestion_sourcePolicyId_targetPolicyId_key";

CREATE UNIQUE INDEX "PolicyRenewalSuggestion_org_source_target_key"
ON "PolicyRenewalSuggestion"("organizationId", "sourcePolicyId", "targetPolicyId");
