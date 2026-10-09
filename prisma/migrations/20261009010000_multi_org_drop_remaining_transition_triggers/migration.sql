-- Cycle 1 registered these assignment triggers before the final protected
-- tables were added to the inventory. Remove the remaining three now that the
-- multi-organization migration has validated non-null tenant ownership.
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "PlatformRuntimeState"
     WHERE "id" = 1 AND "writeMode" = 'MAINTENANCE'
  ) THEN
    RAISE EXCEPTION 'POLICYDESK_TENANT_CUTOVER_REQUIRES_MAINTENANCE';
  END IF;
END
$guard$;

DO $preflight$
DECLARE
  table_name text;
  null_count bigint;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['ClaimChecklistItem', 'KnowledgeSource', 'KnowledgeChunk'] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE "organizationId" IS NULL', table_name)
      INTO null_count;
    IF null_count > 0 THEN
      RAISE EXCEPTION 'POLICYDESK_TENANT_NULL:%:%', table_name, null_count;
    END IF;
  END LOOP;
END
$preflight$;

DROP TRIGGER IF EXISTS "ClaimChecklistItem_transition_singleton_organization" ON "ClaimChecklistItem";
DROP TRIGGER IF EXISTS "KnowledgeSource_transition_singleton_organization" ON "KnowledgeSource";
DROP TRIGGER IF EXISTS "KnowledgeChunk_transition_singleton_organization" ON "KnowledgeChunk";
