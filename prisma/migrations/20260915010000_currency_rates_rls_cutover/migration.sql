/*
  Harden CurrencyRate during the maintenance-gated multi-tenant cutover.
  The preceding migration intentionally leaves the new table singleton-safe
  so the current production runtime can receive the additive schema first.
*/
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "PlatformRuntimeState"
     WHERE "id" = 1 AND "writeMode" = 'MAINTENANCE'
  ) THEN
    RAISE EXCEPTION 'POLICYDESK_CURRENCY_RATE_RLS_REQUIRES_MAINTENANCE';
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS "CurrencyRate_transition_singleton_organization" ON "CurrencyRate";

ALTER TABLE "CurrencyRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CurrencyRate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "policydesk_tenant_context" ON "CurrencyRate";
CREATE POLICY "policydesk_tenant_context" ON "CurrencyRate"
  USING ("organizationId" = nullif(current_setting('app.organization_id', true), ''))
  WITH CHECK ("organizationId" = nullif(current_setting('app.organization_id', true), ''));
REVOKE ALL ON TABLE "CurrencyRate" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "CurrencyRate" TO policydesk_app;
GRANT SELECT ON TABLE "CurrencyRate" TO policydesk_readonly;
