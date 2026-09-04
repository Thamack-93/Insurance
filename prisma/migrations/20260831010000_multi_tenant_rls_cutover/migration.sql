/*
  Final multi-tenant cutover.

  This migration is deliberately maintenance-gated.  The additive runtime
  migration can be deployed while the application is still singleton-safe;
  this migration may only run after the operator has set
  PlatformRuntimeState.writeMode = MAINTENANCE and archived the two-org
  certification evidence.  A normal `prisma migrate deploy` therefore cannot
  silently turn on RLS during an OPEN production window.
*/

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

/* The migration is allowed to proceed with the one-org production state. */
DO $preflight$
DECLARE
  protected text[] := ARRAY[
    'Client','Insurer','Policy','Receipt','PolicyEndorsement','Payment',
    'Commission','Task','WorkItem','Claim','ClaimChecklistItem','Quote',
    'Document','ActivityLog','AssistantActionDraft','NotificationPreference',
    'NotificationEvent','PolicyInsuredParty','PolicyInsuredAsset',
    'TelegramLinkToken','LedgerImportBatch','LedgerImportRow',
    'LedgerImportAction','LedgerImportIssue','TelegramDraft','MaintenanceRun',
    'ReceiptReconciliationIssue','PolicyRenewalSuggestion',
    'DataQualitySuppressionRule','AssistantReport','AssistantReportSignal',
    'AssistantAiRun','AssistantAiAttempt','KnowledgeSource','KnowledgeChunk',
    'Alert'
  ];
  table_name text;
  null_count bigint;
BEGIN
  FOREACH table_name IN ARRAY protected LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE "organizationId" IS NULL', table_name)
      INTO null_count;
    IF null_count > 0 THEN
      RAISE EXCEPTION 'POLICYDESK_TENANT_NULL:%:%', table_name, null_count;
    END IF;
  END LOOP;
END
$preflight$;

/* Final tenant relation guard and composite keys. */
CREATE OR REPLACE FUNCTION policydesk_guard_tenant_relation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  child_org text;
  parent_id text;
  parent_org text;
BEGIN
  child_org := to_jsonb(NEW)->>'organizationId';
  parent_id := to_jsonb(NEW)->>TG_ARGV[0];
  IF child_org IS NULL OR parent_id IS NULL THEN RETURN NEW; END IF;
  EXECUTE format(
    'SELECT "organizationId"::text FROM %I WHERE "id"::text = $1',
    TG_ARGV[1]
  ) INTO parent_org USING parent_id;
  IF parent_org IS NOT NULL AND parent_org <> child_org THEN
    RAISE EXCEPTION 'POLICYDESK_CROSS_ORGANIZATION_RELATION:%:%', TG_TABLE_NAME, TG_ARGV[0]
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$function$;

/* RLS intentionally makes an unscoped SELECT return zero rows.  Writes need
   a stronger fail-closed signal: UPDATE/DELETE with a false USING predicate
   can otherwise be reported as a successful zero-row mutation.  Every
   protected write therefore requires an explicit transaction-local tenant
   context before the row policy is evaluated. */
CREATE OR REPLACE FUNCTION policydesk_require_tenant_context()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF nullif(current_setting('app.organization_id', true), '') IS NULL THEN
    RAISE EXCEPTION 'POLICYDESK_TENANT_CONTEXT_REQUIRED'
      USING ERRCODE = '42501';
  END IF;
  /* This is a statement-level trigger.  Returning NULL is the required
     contract for BEFORE ... FOR EACH STATEMENT and avoids relying on a row
     surviving RLS to enforce the no-context write guard. */
  RETURN NULL;
END
$function$;

/* User references on tenant rows must resolve to a member of that tenant.
   The technical system actor is intentionally allowed for scheduled jobs;
   historical human actors remain valid even after their membership is
   deactivated, but never across organizations. */
CREATE OR REPLACE FUNCTION policydesk_guard_tenant_user_actor()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  child_org text;
  actor_id text;
  membership_exists boolean;
BEGIN
  child_org := to_jsonb(NEW)->>'organizationId';
  actor_id := to_jsonb(NEW)->>TG_ARGV[0];
  IF child_org IS NULL OR actor_id IS NULL OR actor_id = 'system-user-0000' THEN RETURN NEW; END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM "OrganizationMembership" WHERE "organizationId" = $1 AND "userId" = $2)'
    INTO membership_exists USING child_org, actor_id;
  IF NOT membership_exists THEN
    RAISE EXCEPTION 'POLICYDESK_TENANT_USER_ACTOR_MISMATCH:%:%', TG_TABLE_NAME, TG_ARGV[0]
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$function$;

/* Keep exactly one active owner per organization. Owner transfer sets a
   transaction-local flag while it demotes the previous owner and promotes the
   replacement, then verifies the postcondition before returning. */
CREATE OR REPLACE FUNCTION policydesk_guard_owner_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  organization_id text := COALESCE(to_jsonb(NEW)->>'organizationId', to_jsonb(OLD)->>'organizationId');
  owner_count bigint;
BEGIN
  IF current_setting('app.owner_transfer', true) = '1' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  SELECT count(*) INTO owner_count
    FROM "OrganizationMembership" m
    JOIN "User" u ON u."id" = m."userId"
   WHERE m."organizationId" = organization_id
     AND m."role" = 'OWNER'
     AND m."active"
     AND u."active";
  IF owner_count <> 1 THEN
    RAISE EXCEPTION 'POLICYDESK_ORGANIZATION_OWNER_INVARIANT_FAILED:%:%', organization_id, owner_count
      USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END
$function$;

CREATE OR REPLACE FUNCTION policydesk_guard_owner_user()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  membership record;
  owner_count bigint;
BEGIN
  IF current_setting('app.owner_transfer', true) = '1' THEN RETURN NEW; END IF;
  FOR membership IN SELECT "organizationId" FROM "OrganizationMembership" WHERE "userId" = NEW."id" LOOP
    SELECT count(*) INTO owner_count
      FROM "OrganizationMembership" m
      JOIN "User" u ON u."id" = m."userId"
     WHERE m."organizationId" = membership."organizationId"
       AND m."role" = 'OWNER'
       AND m."active"
       AND u."active";
    IF owner_count <> 1 THEN
      RAISE EXCEPTION 'POLICYDESK_ORGANIZATION_OWNER_INVARIANT_FAILED:%:%', membership."organizationId", owner_count
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS policydesk_owner_membership_invariant ON "OrganizationMembership";
CREATE TRIGGER policydesk_owner_membership_invariant
  AFTER INSERT OR UPDATE OR DELETE ON "OrganizationMembership"
  FOR EACH ROW EXECUTE FUNCTION policydesk_guard_owner_membership();
DROP TRIGGER IF EXISTS policydesk_owner_user_invariant ON "User";
CREATE TRIGGER policydesk_owner_user_invariant
  AFTER INSERT OR UPDATE OF "active", "role", "platformRole" ON "User"
  FOR EACH ROW EXECUTE FUNCTION policydesk_guard_owner_user();

DO $relations$
DECLARE
  relation record;
  trigger_name text;
  constraint_name text;
BEGIN
  FOR relation IN
    SELECT * FROM (VALUES
      ('Client','referidorId','Client'),
      ('Policy','familyRootId','Policy'),('Policy','renewedFromPolicyId','Policy'),
      ('Policy','clientId','Client'),('Policy','insurerId','Insurer'),
      ('Receipt','policyId','Policy'),('Receipt','clientId','Client'),
      ('Receipt','insurerId','Insurer'),('Receipt','endorsementId','PolicyEndorsement'),
      ('Receipt','documentId','Document'),('PolicyEndorsement','policyId','Policy'),
      ('PolicyEndorsement','documentId','Document'),('Payment','receiptId','Receipt'),
      ('Payment','policyId','Policy'),('Payment','clientId','Client'),
      ('Commission','policyId','Policy'),('Commission','receiptId','Receipt'),
      ('Commission','clientId','Client'),('Commission','insurerId','Insurer'),
      ('Task','clientId','Client'),('Task','policyId','Policy'),
      ('Task','insurerId','Insurer'),('Task','receiptId','Receipt'),
      ('WorkItem','clientId','Client'),('WorkItem','policyId','Policy'),
      ('WorkItem','insurerId','Insurer'),('WorkItem','receiptId','Receipt'),
      ('Claim','clientId','Client'),('Claim','policyId','Policy'),
      ('Claim','insurerId','Insurer'),('ClaimChecklistItem','claimId','Claim'),
      ('ClaimChecklistItem','documentId','Document'),('KnowledgeChunk','sourceId','KnowledgeSource'),
      ('Quote','clientId','Client'),('Quote','insurerId','Insurer'),
      ('Document','clientId','Client'),('Document','policyId','Policy'),
      ('Document','endorsementId','PolicyEndorsement'),('Document','receiptId','Receipt'),
      ('Document','taskId','Task'),('Document','claimId','Claim'),('Document','quoteId','Quote'),
      ('PolicyInsuredParty','policyId','Policy'),('PolicyInsuredAsset','policyId','Policy'),
      ('NotificationEvent','workItemId','WorkItem'),('NotificationEvent','clientId','Client'),
      ('NotificationEvent','policyId','Policy'),('NotificationEvent','receiptId','Receipt'),
      ('LedgerImportRow','batchId','LedgerImportBatch'),('LedgerImportRow','policyId','Policy'),
      ('LedgerImportRow','receiptId','Receipt'),('LedgerImportRow','paymentId','Payment'),
      ('LedgerImportAction','batchId','LedgerImportBatch'),('LedgerImportAction','rowId','LedgerImportRow'),
      ('LedgerImportIssue','batchId','LedgerImportBatch'),('LedgerImportIssue','rowId','LedgerImportRow'),
      ('LedgerImportIssue','suppressedByRuleId','DataQualitySuppressionRule'),
      ('ReceiptReconciliationIssue','maintenanceRunId','MaintenanceRun'),
      ('ReceiptReconciliationIssue','receiptId','Receipt'),('ReceiptReconciliationIssue','policyId','Policy'),
      ('ReceiptReconciliationIssue','suppressedByRuleId','DataQualitySuppressionRule'),
      ('PolicyRenewalSuggestion','maintenanceRunId','MaintenanceRun'),
      ('PolicyRenewalSuggestion','sourcePolicyId','Policy'),('PolicyRenewalSuggestion','targetPolicyId','Policy'),
      ('PolicyRenewalSuggestion','suppressedByRuleId','DataQualitySuppressionRule'),
      ('AssistantReport','parentReportId','AssistantReport'),
      ('AssistantReportSignal','reportId','AssistantReport'),
      ('AssistantAiRun','reportId','AssistantReport'),('AssistantAiAttempt','runId','AssistantAiRun')
    ) AS v(child, column_name, parent)
  LOOP
    trigger_name := left(format('policydesk_tenant_relation_%s_%s', relation.child, relation.column_name), 63);
    constraint_name := left(format('policydesk_%s_%s_tenant_fkey', relation.child, relation.column_name), 63);
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I ("organizationId", "id")',
      left(format('policydesk_%s_organization_id_unique', relation.parent), 63), relation.parent);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', trigger_name, relation.child);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF "organizationId", %I ON %I FOR EACH ROW EXECUTE FUNCTION policydesk_guard_tenant_relation(%L, %L)',
      trigger_name, relation.column_name, relation.child, relation.column_name, relation.parent
    );
    EXECUTE format($sql$
      DO $block$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = %L) THEN
          ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("organizationId", %I)
            REFERENCES %I ("organizationId", "id") NOT VALID;
        END IF;
      END
      $block$
    $sql$, constraint_name, relation.child, constraint_name, relation.column_name, relation.parent);
    EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', relation.child, constraint_name);
  END LOOP;

  FOR relation IN SELECT * FROM (VALUES ('Client','portfolioOwnerId'),('WorkItem','assignedToId')) AS v(child, column_name)
  LOOP
    constraint_name := left(format('policydesk_%s_%s_tenant_fkey', relation.child, relation.column_name), 63);
    EXECUTE format($sql$
      DO $block$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = %L) THEN
          ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("organizationId", %I)
            REFERENCES "OrganizationMembership" ("organizationId", "userId") NOT VALID;
        END IF;
      END
      $block$
    $sql$, constraint_name, relation.child, constraint_name, relation.column_name);
    EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', relation.child, constraint_name);
  END LOOP;
END
$relations$;

DO $context_guards$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'Client','Insurer','Policy','Receipt','PolicyEndorsement','Payment',
    'Commission','Task','WorkItem','Claim','ClaimChecklistItem','Quote',
    'Document','ActivityLog','AssistantActionDraft','NotificationPreference',
    'NotificationEvent','PolicyInsuredParty','PolicyInsuredAsset',
    'TelegramLinkToken','LedgerImportBatch','LedgerImportRow',
    'LedgerImportAction','LedgerImportIssue','TelegramDraft','MaintenanceRun',
    'ReceiptReconciliationIssue','PolicyRenewalSuggestion',
    'DataQualitySuppressionRule','AssistantReport','AssistantReportSignal',
    'AssistantAiRun','AssistantAiAttempt','KnowledgeSource','KnowledgeChunk',
    'Alert'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'policydesk_tenant_context_required', table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION policydesk_require_tenant_context()',
      'policydesk_tenant_context_required', table_name
    );
  END LOOP;
END
$context_guards$;

DO $actors$
DECLARE
  actor record;
  trigger_name text;
BEGIN
  FOR actor IN SELECT * FROM (VALUES
    ('Client','createdById'),('Client','updatedById'),
    ('Policy','createdById'),('Policy','updatedById'),('Policy','renewalStageById'),
    ('Receipt','createdById'),('Receipt','updatedById'),
    ('PolicyEndorsement','createdById'),('PolicyEndorsement','updatedById'),
    ('Payment','createdById'),('Payment','updatedById'),('Payment','reversedById'),
    ('Task','createdById'),('Task','updatedById'),('WorkItem','createdById'),('WorkItem','updatedById'),
    ('Claim','createdById'),('Claim','updatedById'),('Quote','createdById'),('Quote','updatedById'),
    ('Document','createdById'),('Document','updatedById'),('KnowledgeSource','createdById'),
    ('LedgerImportBatch','createdById'),('LedgerImportBatch','approvedById'),('LedgerImportAction','performedById'),
    ('LedgerImportIssue','mergedById'),('LedgerImportIssue','reviewedById'),
    ('TelegramLinkToken','userId'),('TelegramDraft','userId'),('MaintenanceRun','createdById'),
    ('ReceiptReconciliationIssue','mergedById'),('ReceiptReconciliationIssue','reviewedById'),
    ('PolicyRenewalSuggestion','mergedById'),('PolicyRenewalSuggestion','reviewedById'),
    ('DataQualitySuppressionRule','createdById'),('DataQualitySuppressionRule','reviewedById'),
    ('ActivityLog','userId'),('AssistantActionDraft','userId'),('NotificationPreference','userId'),
    ('NotificationEvent','userId'),('AssistantAiRun','userId')
  ) AS v(table_name, column_name)
  LOOP
    trigger_name := left(format('policydesk_tenant_actor_%s_%s', actor.table_name, actor.column_name), 63);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', trigger_name, actor.table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF "organizationId", %I ON %I FOR EACH ROW EXECUTE FUNCTION policydesk_guard_tenant_user_actor(%L)',
      trigger_name, actor.column_name, actor.table_name, actor.column_name
    );
  END LOOP;
END
$actors$;

/* Remove Cycle 1 singleton indexes, assignment triggers and owner immutability. */
DROP INDEX IF EXISTS "Organization_transition_singleton_idx";
DROP INDEX IF EXISTS "OrganizationMembership_transition_owner_idx";
DROP INDEX IF EXISTS "OrganizationMembership_active_owner_per_org_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationMembership_active_owner_per_org_idx"
  ON "OrganizationMembership" ("organizationId") WHERE "role" = 'OWNER' AND "active";

DO $barriers$
DECLARE
  item record;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('Organization','Organization_transition_delete_guard'),
    ('Organization','Organization_transition_truncate_guard'),
    ('OrganizationMembership','OrganizationMembership_transition_guard'),
    ('User','User_transition_membership_sync'),
    ('User','User_transition_owner_delete_guard'),
    ('OrganizationMembership','OrganizationMembership_owner_guard'),
    ('Client','Client_transition_singleton_organization'),('Insurer','Insurer_transition_singleton_organization'),
    ('Policy','Policy_transition_singleton_organization'),('Receipt','Receipt_transition_singleton_organization'),
    ('PolicyEndorsement','PolicyEndorsement_transition_singleton_organization'),('Payment','Payment_transition_singleton_organization'),
    ('Commission','Commission_transition_singleton_organization'),('Task','Task_transition_singleton_organization'),
    ('WorkItem','WorkItem_transition_singleton_organization'),('Claim','Claim_transition_singleton_organization'),
    ('Quote','Quote_transition_singleton_organization'),('Document','Document_transition_singleton_organization'),
    ('ActivityLog','ActivityLog_transition_singleton_organization'),('AssistantActionDraft','AssistantActionDraft_transition_singleton_organization'),
    ('NotificationPreference','NotificationPreference_transition_singleton_organization'),('NotificationEvent','NotificationEvent_transition_singleton_organization'),
    ('PolicyInsuredParty','PolicyInsuredParty_transition_singleton_organization'),('PolicyInsuredAsset','PolicyInsuredAsset_transition_singleton_organization'),
    ('TelegramLinkToken','TelegramLinkToken_transition_singleton_organization'),('LedgerImportBatch','LedgerImportBatch_transition_singleton_organization'),
    ('LedgerImportRow','LedgerImportRow_transition_singleton_organization'),('LedgerImportAction','LedgerImportAction_transition_singleton_organization'),
    ('LedgerImportIssue','LedgerImportIssue_transition_singleton_organization'),('TelegramDraft','TelegramDraft_transition_singleton_organization'),
    ('MaintenanceRun','MaintenanceRun_transition_singleton_organization'),('ReceiptReconciliationIssue','ReceiptReconciliationIssue_transition_singleton_organization'),
    ('PolicyRenewalSuggestion','PolicyRenewalSuggestion_transition_singleton_organization'),('DataQualitySuppressionRule','DataQualitySuppressionRule_transition_singleton_organization'),
    ('AssistantReport','AssistantReport_transition_singleton_organization'),('AssistantReportSignal','AssistantReportSignal_transition_singleton_organization'),
    ('AssistantAiRun','AssistantAiRun_transition_singleton_organization'),('AssistantAiAttempt','AssistantAiAttempt_transition_singleton_organization'),
    ('Alert','Alert_transition_singleton_organization')
  ) AS v(table_name, trigger_name)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', item.trigger_name, item.table_name);
  END LOOP;
END
$barriers$;

/* Required protected columns become non-null at the same atomic cutover. */
DO $columns$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'Client','Insurer','Policy','Receipt','PolicyEndorsement','Payment',
    'Commission','Task','WorkItem','Claim','ClaimChecklistItem','Quote',
    'Document','ActivityLog','AssistantActionDraft','NotificationPreference',
    'NotificationEvent','PolicyInsuredParty','PolicyInsuredAsset',
    'TelegramLinkToken','LedgerImportBatch','LedgerImportRow','LedgerImportAction',
    'LedgerImportIssue','TelegramDraft','MaintenanceRun','ReceiptReconciliationIssue',
    'PolicyRenewalSuggestion','DataQualitySuppressionRule','AssistantReport',
    'AssistantReportSignal','AssistantAiRun','AssistantAiAttempt','KnowledgeSource',
    'KnowledgeChunk','Alert'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "organizationId" SET NOT NULL', table_name);
  END LOOP;
END
$columns$;

/* Force RLS on every protected table.  Application code must establish the
   transaction-local setting and retain explicit organization predicates. */
DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'Client','Insurer','Policy','Receipt','PolicyEndorsement','Payment',
    'Commission','Task','WorkItem','Claim','ClaimChecklistItem','Quote',
    'Document','ActivityLog','AssistantActionDraft','NotificationPreference',
    'NotificationEvent','PolicyInsuredParty','PolicyInsuredAsset',
    'TelegramLinkToken','LedgerImportBatch','LedgerImportRow','LedgerImportAction',
    'LedgerImportIssue','TelegramDraft','MaintenanceRun','ReceiptReconciliationIssue',
    'PolicyRenewalSuggestion','DataQualitySuppressionRule','AssistantReport',
    'AssistantReportSignal','AssistantAiRun','AssistantAiAttempt','KnowledgeSource',
    'KnowledgeChunk','Alert'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS policydesk_tenant_context ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY policydesk_tenant_context ON %I USING ("organizationId" = nullif(current_setting(''app.organization_id'', true), '''')) WITH CHECK ("organizationId" = nullif(current_setting(''app.organization_id'', true), ''''))',
      table_name
    );
  END LOOP;
END
$rls$;

/* Explicit runtime role and grant matrix. The role is login-capable for the
   pooled runtime and exact-role certification, while remaining non-owner,
   non-superuser and non-BYPASSRLS. Operators provision its password/secret
   outside the migration; the administrative owner is never used at runtime. */
DO $roles$
BEGIN
  -- Roles are created/altered by the direct operator preflight. CREATE ROLE
  -- is not legal inside Prisma's transactional migration; fail with a clear
  -- message instead of attempting DDL here.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'policydesk_app') THEN
    RAISE EXCEPTION 'POLICYDESK_TENANT_APP_ROLE_MISSING';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'policydesk_platform_owner') THEN
    RAISE EXCEPTION 'POLICYDESK_TENANT_PLATFORM_OWNER_ROLE_MISSING';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'policydesk_readonly') THEN
    RAISE EXCEPTION 'POLICYDESK_TENANT_READONLY_ROLE_MISSING';
  END IF;
END
$roles$;

DO $grants$
DECLARE table_name text;
BEGIN
  EXECUTE 'REVOKE ALL ON SCHEMA public FROM PUBLIC';
  EXECUTE 'GRANT USAGE ON SCHEMA public TO policydesk_app, policydesk_platform_owner, policydesk_readonly';
  FOREACH table_name IN ARRAY ARRAY[
    'Client','Insurer','Policy','Receipt','PolicyEndorsement','Payment',
    'Commission','Task','WorkItem','Claim','ClaimChecklistItem','Quote',
    'Document','ActivityLog','AssistantActionDraft','NotificationPreference',
    'NotificationEvent','PolicyInsuredParty','PolicyInsuredAsset',
    'TelegramLinkToken','LedgerImportBatch','LedgerImportRow','LedgerImportAction',
    'LedgerImportIssue','TelegramDraft','MaintenanceRun','ReceiptReconciliationIssue',
    'PolicyRenewalSuggestion','DataQualitySuppressionRule','AssistantReport',
    'AssistantReportSignal','AssistantAiRun','AssistantAiAttempt','KnowledgeSource',
    'KnowledgeChunk','Alert'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO policydesk_app', table_name);
    EXECUTE format('GRANT SELECT ON TABLE %I TO policydesk_readonly', table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY[
    'OrganizationCapability','OrganizationSetting','DemoOrganizationState','DemoUploadArtifact',
    'SecurityEventAggregate','BackupArtifact','OrganizationRestoreRun','OrganizationSubscription','BillingCharge'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO policydesk_app', table_name);
    EXECUTE format('GRANT SELECT ON TABLE %I TO policydesk_readonly', table_name);
  END LOOP;
  EXECUTE 'REVOKE ALL ON TABLE "User","Organization","OrganizationMembership","NotificationChannel","TelegramWebhookUpdate","SystemSetting","Session","UserPreference","PlatformRuntimeState" FROM PUBLIC';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "User","Organization","OrganizationMembership","NotificationChannel","TelegramWebhookUpdate","SystemSetting","Session","UserPreference" TO policydesk_app';
  -- Runtime code may observe maintenance state, but only the direct
  -- operational workflow may change it.
  EXECUTE 'GRANT SELECT ON TABLE "PlatformRuntimeState" TO policydesk_app';
  EXECUTE 'GRANT SELECT ON TABLE "Plan","GeneralKnowledgeSource","GeneralKnowledgeChunk" TO policydesk_app';
  EXECUTE 'GRANT SELECT, INSERT ON TABLE "PlatformAuditLog" TO policydesk_app';
  EXECUTE 'GRANT SELECT ON TABLE "User","Organization","OrganizationMembership","Plan","PlatformAuditLog","SystemSetting","NotificationChannel","TelegramWebhookUpdate","GeneralKnowledgeSource","GeneralKnowledgeChunk","Session","UserPreference","PlatformRuntimeState","_prisma_migrations" TO policydesk_readonly';
  -- The SECURITY DEFINER aggregate runs as this non-login owner. Grant only
  -- the three relations it reads; BYPASSRLS alone does not grant SELECT.
  EXECUTE 'GRANT SELECT ON TABLE "Organization","Client","Policy" TO policydesk_platform_owner';
END
$grants$;

CREATE OR REPLACE FUNCTION policydesk_platform_tenant_metrics(org_ids text[])
RETURNS TABLE("organizationId" text, "clientCount" bigint, "policyCount" bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT o.id,
    (SELECT count(*) FROM "Client" c WHERE c."organizationId" = o.id),
    (SELECT count(*) FROM "Policy" p WHERE p."organizationId" = o.id)
  FROM "Organization" o
  WHERE o.id = ANY(org_ids)
$function$;
ALTER FUNCTION policydesk_platform_tenant_metrics(text[]) OWNER TO policydesk_platform_owner;
REVOKE ALL ON FUNCTION policydesk_platform_tenant_metrics(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION policydesk_platform_tenant_metrics(text[]) TO policydesk_app;

/* Keep the application in maintenance until the cutover verifier explicitly
   reopens writes. */
UPDATE "PlatformRuntimeState"
   SET "writeMode" = 'MAINTENANCE', "reason" = 'multi-tenant RLS cutover applied', "updatedAt" = CURRENT_TIMESTAMP
 WHERE "id" = 1;
