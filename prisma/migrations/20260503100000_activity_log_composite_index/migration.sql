-- Composite index to back getActivityForEntity (entityType, entityId, createdAt desc)
CREATE INDEX IF NOT EXISTS "ActivityLog_entityType_entityId_createdAt_idx"
  ON "ActivityLog"("entityType", "entityId", "createdAt");
