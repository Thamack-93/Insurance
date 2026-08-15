-- SUPERADMIN is a platform role and must never grant tenant access implicitly.
-- This remains compatible with the Cycle 1 singleton barrier for normal users.
DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "OrganizationMembership" m
    JOIN "User" u ON u."id" = m."userId"
    WHERE u."platformRole" = 'SUPERADMIN' AND m."role" = 'OWNER'
  ) THEN
    RAISE EXCEPTION 'POLICYDESK_SUPERADMIN_OWNER_CONFLICT' USING ERRCODE = 'P0001';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION policydesk_sync_user_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  existing_role TEXT;
BEGIN
  IF NEW."id" = 'system-user-0000' THEN
    RETURN NEW;
  END IF;

  IF NEW."platformRole" = 'SUPERADMIN' THEN
    IF EXISTS (
      SELECT 1 FROM "OrganizationMembership"
      WHERE "userId" = NEW."id" AND "role" = 'OWNER'
    ) THEN
      RAISE EXCEPTION 'POLICYDESK_SUPERADMIN_OWNER_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    DELETE FROM "OrganizationMembership" WHERE "userId" = NEW."id";
    RETURN NEW;
  END IF;

  IF NEW."role" NOT IN ('ADMIN','AGENT') THEN
    RAISE EXCEPTION 'POLICYDESK_LEGACY_USER_ROLE_UNSUPPORTED' USING ERRCODE = 'P0001';
  END IF;

  SELECT "role" INTO existing_role
  FROM "OrganizationMembership"
  WHERE "organizationId" = 'org_legacy_singleton_0001' AND "userId" = NEW."id";

  IF existing_role = 'OWNER' THEN
    IF NEW."role" <> 'ADMIN' OR NOT NEW."active" THEN
      RAISE EXCEPTION 'POLICYDESK_OWNER_IMMUTABLE' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  INSERT INTO "OrganizationMembership" ("id","organizationId","userId","role","active")
  VALUES (concat('om_', NEW."id"), 'org_legacy_singleton_0001', NEW."id",
          CASE WHEN NEW."role" = 'ADMIN' THEN 'ADMIN' ELSE 'AGENT' END, NEW."active")
  ON CONFLICT ("organizationId","userId") DO UPDATE
    SET "role" = EXCLUDED."role", "active" = EXCLUDED."active", "updatedAt" = CURRENT_TIMESTAMP;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION policydesk_sync_user_membership() IS
  'Cycle 1 temporary User-to-singleton membership synchronization; excludes system users and global SUPERADMIN accounts.';

DROP TRIGGER IF EXISTS "User_transition_membership_sync" ON "User";
CREATE TRIGGER "User_transition_membership_sync"
AFTER INSERT OR UPDATE OF "role","active","platformRole" ON "User"
FOR EACH ROW EXECUTE FUNCTION policydesk_sync_user_membership();

COMMENT ON TRIGGER "User_transition_membership_sync" ON "User" IS
  'Cycle 1 temporary legacy role/active synchronization; SUPERADMIN remains platform-only without membership.';

DELETE FROM "OrganizationMembership" m
USING "User" u
WHERE u."id" = m."userId" AND u."platformRole" = 'SUPERADMIN';
