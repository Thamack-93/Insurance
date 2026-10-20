DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "PlatformRuntimeState"
     WHERE "id" = 1 AND "writeMode" = 'MAINTENANCE'
  ) THEN
    RAISE EXCEPTION 'POLICYDESK_BONUS_RLS_REQUIRES_MAINTENANCE';
  END IF;
END
$guard$;

DO $rls$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['BonusRuleSet','BonusRun','BonusRunItem'] LOOP
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
