-- Resync audit indexes after ActivityLog was recreated in auth_and_audit
CREATE INDEX IF NOT EXISTS "ActivityLog_entityType_entityId_createdAt_idx"
    ON "ActivityLog"("entityType", "entityId", "createdAt");
