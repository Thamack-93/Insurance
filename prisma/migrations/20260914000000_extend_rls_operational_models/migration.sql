/*
  Extend the tenant cutover to models introduced after the original RLS
  migration. This migration is intentionally maintenance-gated so the new
  tables cannot become tenant-visible while writes are open.
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

DO $barriers$
DECLARE
  item record;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('CommissionStatement','CommissionStatement_transition_singleton_organization'),
    ('CommissionStatementRow','CommissionStatementRow_transition_singleton_organization'),
    ('CommissionCorrection','CommissionCorrection_transition_singleton_organization'),
    ('QuoteComparison','QuoteComparison_transition_singleton_organization'),
    ('QuoteComparisonItem','QuoteComparisonItem_transition_singleton_organization')
  ) AS v(table_name, trigger_name)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', item.trigger_name, item.table_name);
  END LOOP;
END
$barriers$;

DO $rls$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'CommissionStatement','CommissionStatementRow','CommissionCorrection',
    'QuoteComparison','QuoteComparisonItem'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS policydesk_tenant_context ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY policydesk_tenant_context ON %I USING ("organizationId" = nullif(current_setting(''app.organization_id'', true), '''')) WITH CHECK ("organizationId" = nullif(current_setting(''app.organization_id'', true), ''''))',
      table_name
    );
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO policydesk_app', table_name);
    EXECUTE format('GRANT SELECT ON TABLE %I TO policydesk_readonly', table_name);
  END LOOP;
END
$rls$;
