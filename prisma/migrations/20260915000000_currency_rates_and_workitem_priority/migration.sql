/*
  Manual historical FX rates and database-side WorkItem priority ordering.

  This migration is additive and remains compatible with the current
  singleton runtime. The maintenance-gated RLS hardening for CurrencyRate is
  applied by the following migration during the multi-tenant cutover.
*/

ALTER TABLE "WorkItem" ADD COLUMN "priorityRank" INTEGER NOT NULL DEFAULT 20;

UPDATE "WorkItem"
SET "priorityRank" = CASE "priority"
  WHEN 'URGENT' THEN 40
  WHEN 'HIGH' THEN 30
  WHEN 'MEDIUM' THEN 20
  WHEN 'LOW' THEN 10
  ELSE 20
END;

CREATE OR REPLACE FUNCTION "policydesk_sync_workitem_priority_rank"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW."priorityRank" := CASE NEW."priority"
    WHEN 'URGENT' THEN 40
    WHEN 'HIGH' THEN 30
    WHEN 'MEDIUM' THEN 20
    WHEN 'LOW' THEN 10
    ELSE 20
  END;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS "WorkItem_priority_rank_sync" ON "WorkItem";
CREATE TRIGGER "WorkItem_priority_rank_sync"
BEFORE INSERT OR UPDATE OF "priority" ON "WorkItem"
FOR EACH ROW EXECUTE FUNCTION "policydesk_sync_workitem_priority_rank"();

CREATE INDEX "WorkItem_organizationId_status_priorityRank_dueDate_createdAt_id_idx"
  ON "WorkItem"("organizationId", "status", "priorityRank", "dueDate", "createdAt", "id");

CREATE TABLE "CurrencyRate" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "fromCurrency" VARCHAR(3) NOT NULL,
  "toCurrency" VARCHAR(3) NOT NULL DEFAULT 'MXN',
  "effectiveDate" DATE NOT NULL,
  "rateToMxn" DECIMAL(18,8) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CurrencyRate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CurrencyRate_rate_positive_check" CHECK ("rateToMxn" > 0),
  CONSTRAINT "CurrencyRate_currency_code_check" CHECK ("fromCurrency" ~ '^[A-Z]{3}$' AND "toCurrency" = 'MXN')
);

CREATE UNIQUE INDEX "CurrencyRate_org_from_to_effectiveDate_key"
  ON "CurrencyRate"("organizationId", "fromCurrency", "toCurrency", "effectiveDate");
CREATE INDEX "CurrencyRate_org_from_to_effectiveDate_idx"
  ON "CurrencyRate"("organizationId", "fromCurrency", "toCurrency", "effectiveDate");
CREATE INDEX "CurrencyRate_organizationId_idx" ON "CurrencyRate"("organizationId");

CREATE INDEX "Policy_organizationId_status_endDate_idx" ON "Policy"("organizationId", "status", "endDate");
CREATE INDEX "Policy_organizationId_status_insurerId_idx" ON "Policy"("organizationId", "status", "insurerId");
CREATE INDEX "Receipt_organizationId_status_dueDate_idx" ON "Receipt"("organizationId", "status", "dueDate");
CREATE INDEX "Commission_organizationId_status_expectedDate_idx" ON "Commission"("organizationId", "status", "expectedDate");
ALTER TABLE "CurrencyRate" ADD CONSTRAINT "CurrencyRate_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TRIGGER "CurrencyRate_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "CurrencyRate"
FOR EACH ROW EXECUTE FUNCTION "policydesk_assign_singleton_organization"();
