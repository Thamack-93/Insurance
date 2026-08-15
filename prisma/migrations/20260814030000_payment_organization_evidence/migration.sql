-- Payment evidence belongs to one tenant. Two organizations may import the
-- same provider-local evidence key without suppressing one another.
DROP INDEX IF EXISTS "Payment_sourceEvidenceKey_key";

CREATE UNIQUE INDEX "Payment_organizationId_sourceEvidenceKey_key"
ON "Payment" ("organizationId", "sourceEvidenceKey");

COMMENT ON INDEX "Payment_organizationId_sourceEvidenceKey_key" IS
'Tenant-scoped payment evidence idempotency key; organizationId becomes NOT NULL during Cycle 3 hardening.';
