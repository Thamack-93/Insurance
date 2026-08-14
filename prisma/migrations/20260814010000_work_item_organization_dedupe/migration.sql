-- WorkItem source identities are tenant-local. A source in one organization
-- must neither update nor suppress the corresponding source in another.
DROP INDEX IF EXISTS "WorkItem_sourceType_sourceId_key";

CREATE UNIQUE INDEX "WorkItem_organizationId_sourceType_sourceId_key"
ON "WorkItem" ("organizationId", "sourceType", "sourceId");

COMMENT ON INDEX "WorkItem_organizationId_sourceType_sourceId_key" IS
'Tenant-scoped idempotency key for WorkItems; organizationId becomes NOT NULL during Cycle 3 hardening.';
