-- Stage 3 DEMO upload provenance and platform safety metadata.
-- This migration is additive and remains safe while Production is singleton.

ALTER TABLE "DemoUploadArtifact"
  ADD COLUMN IF NOT EXISTS "sizeBytes" INTEGER,
  ADD COLUMN IF NOT EXISTS "sha256" TEXT,
  ADD COLUMN IF NOT EXISTS "detectedMimeType" TEXT,
  ADD COLUMN IF NOT EXISTS "validationStatus" TEXT NOT NULL DEFAULT 'ACCEPTED',
  ADD COLUMN IF NOT EXISTS "validatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "purgeAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastPurgeFailureCode" TEXT;

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "activatedAt" TIMESTAMP(3);

-- Existing usable organizations are already activated. Provisioning/bootstrap
-- rows remain NULL until their first transition to ACTIVE.
UPDATE "Organization"
   SET "activatedAt" = COALESCE("activatedAt", "updatedAt")
 WHERE "status" NOT IN ('PROVISIONING', 'BOOTSTRAP')
   AND "activatedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "DemoUploadArtifact_organizationId_validationStatus_status_idx"
  ON "DemoUploadArtifact"("organizationId", "validationStatus", "status");

ALTER TABLE "DemoUploadArtifact"
  DROP CONSTRAINT IF EXISTS "DemoUploadArtifact_validation_status_check";
ALTER TABLE "DemoUploadArtifact"
  ADD CONSTRAINT "DemoUploadArtifact_validation_status_check"
  CHECK ("validationStatus" IN ('PENDING_VALIDATION', 'ACCEPTED', 'REJECTED', 'PURGED', 'FAILED'));

-- The DEMO plan must exist before a restricted app-role provisioning request.
-- Keep this idempotent and deterministic; provisioning only updates this row.
INSERT INTO "Plan" ("id", "requestId", "code", "name", "monthlyAmountMinor", "currency", "active", "createdAt", "updatedAt")
VALUES ('plan_demo_v1', 'plan:demo:v1', 'DEMO', 'PolicyDesk Demo', 0, 'USD', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "active" = true, "name" = EXCLUDED."name", "monthlyAmountMinor" = 0, "currency" = 'USD', "updatedAt" = CURRENT_TIMESTAMP;

-- Runtime credentials can provision organizations, but cannot mutate plan
-- definitions or the platform write-mode control. Role creation is an
-- operator preflight (CREATE ROLE is not legal inside Prisma's transactional
-- migration), so keep this additive migration safe on singleton databases
-- where the role has not been prepared yet.
DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'policydesk_app') THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON TABLE "Plan" FROM policydesk_app';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON TABLE "PlatformRuntimeState" FROM policydesk_app';
  END IF;
END
$roles$;

-- Once an organization is active its commercial kind is immutable. A DEMO is
-- converted by creating a new CUSTOMER organization and importing approved
-- data, never by changing this row in place.
CREATE OR REPLACE FUNCTION policydesk_guard_active_organization_kind()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'ACTIVE' AND NEW."activatedAt" IS NULL THEN
      NEW."activatedAt" := CURRENT_TIMESTAMP;
    END IF;
    RETURN NEW;
  END IF;
  -- Keep the activation marker monotonic. This prevents an ACTIVE org from
  -- first changing status back to PROVISIONING and then changing kind.
  IF OLD."activatedAt" IS NOT NULL AND NEW."activatedAt" IS DISTINCT FROM OLD."activatedAt" THEN
    RAISE EXCEPTION 'ORGANIZATION_ACTIVATION_IMMUTABLE';
  END IF;
  IF (OLD.status NOT IN ('PROVISIONING', 'BOOTSTRAP') OR OLD."activatedAt" IS NOT NULL)
     AND NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'ORGANIZATION_KIND_IMMUTABLE';
  END IF;
  IF NEW.status = 'ACTIVE' AND NEW."activatedAt" IS NULL THEN
    NEW."activatedAt" := CURRENT_TIMESTAMP;
  ELSIF OLD."activatedAt" IS NOT NULL AND NEW."activatedAt" IS NULL THEN
    NEW."activatedAt" := OLD."activatedAt";
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organization_active_kind_immutable ON "Organization";
CREATE TRIGGER organization_active_kind_immutable
BEFORE INSERT OR UPDATE OF "status", "kind", "activatedAt" ON "Organization"
FOR EACH ROW
EXECUTE FUNCTION policydesk_guard_active_organization_kind();
