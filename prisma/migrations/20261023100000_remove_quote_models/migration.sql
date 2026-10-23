BEGIN;

-- Quote, QuoteComparison, and their related documents were cleared before
-- removing the feature. Remove the legacy document relation and tables.
DROP TRIGGER IF EXISTS "policydesk_tenant_relation_Document_quoteId" ON "Document";
ALTER TABLE "Document" DROP COLUMN IF EXISTS "quoteId";

DROP TABLE IF EXISTS "QuoteComparisonItem";
DROP TABLE IF EXISTS "QuoteComparison";
DROP TABLE IF EXISTS "Quote";

DROP TYPE IF EXISTS "QuoteStatus";

COMMIT;
