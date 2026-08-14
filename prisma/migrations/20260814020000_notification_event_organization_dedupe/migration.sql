-- Notification deduplication is tenant-local. Identical logical events in two
-- organizations must not suppress one another.
DROP INDEX IF EXISTS "NotificationEvent_dedupeKey_key";

CREATE UNIQUE INDEX "NotificationEvent_organizationId_dedupeKey_key"
ON "NotificationEvent" ("organizationId", "dedupeKey");

COMMENT ON INDEX "NotificationEvent_organizationId_dedupeKey_key" IS
'Tenant-scoped notification idempotency key; organizationId becomes NOT NULL during Cycle 3 hardening.';
