-- Environment-local deployment identity. The application compares this row
-- with explicit runtime configuration before authenticated reads or writes.
CREATE TYPE "DeploymentEnvironment" AS ENUM ('PRODUCTION', 'PREVIEW', 'DEVELOPMENT', 'TEST');

CREATE TABLE "DeploymentIdentity" (
    "id" VARCHAR(64) NOT NULL,
    "environment" "DeploymentEnvironment" NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeploymentIdentity_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DeploymentIdentity_singleton_id_check"
      CHECK ("id" = 'policydesk_deployment_identity_v1'),
    CONSTRAINT "DeploymentIdentity_fingerprint_check"
      CHECK ("fingerprint" ~ '^[a-f0-9]{64}$')
);

COMMENT ON TABLE "DeploymentIdentity" IS
  'PolicyDesk environment-local deployment identity; excluded from business backup and restore.';

CREATE OR REPLACE FUNCTION policydesk_guard_deployment_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('policydesk.deployment_identity_admin', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'POLICYDESK_DEPLOYMENT_IDENTITY_IMMUTABLE'
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'TRUNCATE' THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION policydesk_guard_deployment_identity() IS
  'Rejects DeploymentIdentity mutations outside the explicit direct-connection admin transaction.';

CREATE TRIGGER "DeploymentIdentity_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "DeploymentIdentity"
FOR EACH ROW
EXECUTE FUNCTION policydesk_guard_deployment_identity();

COMMENT ON TRIGGER "DeploymentIdentity_guard" ON "DeploymentIdentity" IS
  'Environment-local identity guard; use init:deployment-db-identity for authorized changes.';

CREATE TRIGGER "DeploymentIdentity_truncate_guard"
BEFORE TRUNCATE ON "DeploymentIdentity"
FOR EACH STATEMENT
EXECUTE FUNCTION policydesk_guard_deployment_identity();

COMMENT ON TRIGGER "DeploymentIdentity_truncate_guard" ON "DeploymentIdentity" IS
  'Prevents removal of the environment-local identity through TRUNCATE.';

-- The restricted runtime role is provisioned administratively before the
-- production cutover. Keep identity mutation unavailable in the same migration
-- transaction when that role already exists. Local/CI databases may omit it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'policydesk_runtime') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "DeploymentIdentity" FROM policydesk_runtime;
    GRANT SELECT ON TABLE "DeploymentIdentity" TO policydesk_runtime;
  END IF;
END;
$$;
