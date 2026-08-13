ALTER TABLE "Organization"
ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'CUSTOMER';

UPDATE "Organization"
SET "kind" = 'LEGACY'
WHERE "id" = 'org_legacy_singleton_0001';

ALTER TABLE "Organization"
ADD CONSTRAINT "Organization_kind_check"
CHECK ("kind" IN ('LEGACY', 'CUSTOMER', 'DEMO'));

CREATE INDEX "Organization_kind_idx" ON "Organization"("kind");

COMMENT ON COLUMN "Organization"."kind" IS
  'Commercial classification only: LEGACY, CUSTOMER, or DEMO. It never grants authorization.';
