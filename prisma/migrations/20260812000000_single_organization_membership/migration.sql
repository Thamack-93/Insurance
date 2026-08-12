-- Cycle 2A establishes one tenant membership per user. Keep the composite
-- unique because the temporary Cycle 1 synchronization trigger targets it.
DO $$
DECLARE
  duplicate_user_id text;
BEGIN
  SELECT "userId"
  INTO duplicate_user_id
  FROM "OrganizationMembership"
  GROUP BY "userId"
  HAVING count(*) > 1
  LIMIT 1;

  IF duplicate_user_id IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'POLICYDESK_MULTIPLE_ORGANIZATION_MEMBERSHIPS';
  END IF;
END
$$;

DROP INDEX IF EXISTS "OrganizationMembership_userId_idx";

CREATE UNIQUE INDEX "OrganizationMembership_userId_key"
ON "OrganizationMembership" ("userId");

COMMENT ON INDEX "OrganizationMembership_userId_key" IS
'Cycle 2A invariant: a PolicyDesk user belongs to at most one organization; SUPERADMIN users may have none.';
