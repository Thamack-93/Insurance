import "dotenv/config";

import { Pool } from "pg";
import { PROTECTED_TENANT_TABLES, BOOTSTRAP_ORGANIZATION_ID } from "../src/lib/tenant-organization-foundation.ts";
import { assertDisposableCertificationTarget } from "./tenant-certification-target.mjs";

const ROLLBACK_LOCK = "policydesk-multi-org-rollback-v1";

function directDatabaseUrl() {
  const value = process.env.DATABASE_ADMIN_URL?.trim();
  if (!value) throw new Error("POLICYDESK_MULTI_ORG_DATABASE_REQUIRED");
  const url = new URL(value);
  if (/pooler/i.test(url.hostname) || url.searchParams.has("pgbouncer")) throw new Error("POLICYDESK_MULTI_ORG_DIRECT_DATABASE_REQUIRED");
  return value;
}

function ident(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function main() {
  if (process.env.ENABLE_TENANT_RLS_ROLLBACK !== "1") throw new Error("ENABLE_TENANT_RLS_ROLLBACK=1 es obligatorio.");
  const databaseUrl = directDatabaseUrl();
  if (process.env.TENANT_ISOLATION_TEST_DB === "1") assertDisposableCertificationTarget(databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: "policydesk-multi-org-rollback" });
  const client = await pool.connect();
  let lockHeld = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [ROLLBACK_LOCK]);
    lockHeld = true;
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL lock_timeout = '30s'");
    await client.query("SET LOCAL statement_timeout = '10min'");
    const state = await client.query<{ writeMode: string }>('SELECT "writeMode" FROM "PlatformRuntimeState" WHERE "id" = 1');
    if (state.rows[0]?.writeMode !== "MAINTENANCE") throw new Error("POLICYDESK_ROLLBACK_REQUIRES_MAINTENANCE");
    const current = await client.query<{ current_user: string }>("SELECT current_user");
    if (current.rows[0]?.current_user === (process.env.TENANT_RLS_APP_ROLE?.trim() || "policydesk_app")) {
      throw new Error("POLICYDESK_ROLLBACK_REQUIRES_ADMIN_CONNECTION");
    }
    const organizations = await client.query<{ id: string; kind: string }>('SELECT "id", "kind" FROM "Organization" ORDER BY "id"');
    if (organizations.rowCount !== 1 || organizations.rows[0]?.id !== BOOTSTRAP_ORGANIZATION_ID) {
      throw new Error("POLICYDESK_ROLLBACK_REQUIRES_EXACTLY_ONE_BOOTSTRAP_ORGANIZATION");
    }
    if (organizations.rows[0]?.kind === "DEMO") throw new Error("POLICYDESK_ROLLBACK_REJECTS_DEMO_ORGANIZATION");
    const ownerCount = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM "OrganizationMembership" WHERE "organizationId" = $1 AND "role" = \'OWNER\'',
      [BOOTSTRAP_ORGANIZATION_ID],
    );
    if (Number(ownerCount.rows[0]?.count ?? 0) > 1) {
      throw new Error("POLICYDESK_ROLLBACK_REQUIRES_ONE_OWNER_MEMBERSHIP");
    }

    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS "Organization_transition_singleton_idx" ON "Organization" ((1))');
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationMembership_transition_owner_idx" ON "OrganizationMembership" ((1)) WHERE "role" = \'OWNER\'');
    await client.query(`
      CREATE OR REPLACE FUNCTION policydesk_assign_singleton_organization()
      RETURNS trigger LANGUAGE plpgsql AS $function$
      DECLARE singleton_id text;
      BEGIN
        SELECT min("id") INTO singleton_id FROM "Organization";
        IF singleton_id IS NULL THEN RAISE EXCEPTION 'POLICYDESK_ORGANIZATION_NOT_BOOTSTRAPPED'; END IF;
        IF NEW."organizationId" IS NULL THEN NEW."organizationId" := singleton_id;
        ELSIF NEW."organizationId" IS DISTINCT FROM singleton_id THEN
          RAISE EXCEPTION 'POLICYDESK_ORGANIZATION_MISMATCH';
        END IF;
        IF TG_OP = 'UPDATE' AND OLD."organizationId" IS DISTINCT FROM NEW."organizationId" THEN
          RAISE EXCEPTION 'POLICYDESK_ORGANIZATION_IMMUTABLE';
        END IF;
        RETURN NEW;
      END;
      $function$;
      CREATE OR REPLACE FUNCTION policydesk_guard_singleton_membership()
      RETURNS trigger LANGUAGE plpgsql AS $function$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          IF OLD."role" = 'OWNER' AND OLD."active" THEN RAISE EXCEPTION 'POLICYDESK_OWNER_IMMUTABLE'; END IF;
          RETURN OLD;
        END IF;
        IF NEW."organizationId" <> '${BOOTSTRAP_ORGANIZATION_ID}' THEN RAISE EXCEPTION 'POLICYDESK_ORGANIZATION_MISMATCH'; END IF;
        IF NEW."role" NOT IN ('OWNER','ADMIN','AGENT') THEN RAISE EXCEPTION 'POLICYDESK_MEMBERSHIP_ROLE_INVALID'; END IF;
        RETURN NEW;
      END;
      $function$;
    `);
    // Restore the Cycle 1 organization and User guards. The functions remain
    // versioned by the additive migration; rollback only reattaches normal
    // triggers and never drops the additive schema.
    await client.query(`
      DROP TRIGGER IF EXISTS "Organization_transition_delete_guard" ON "Organization";
      DROP TRIGGER IF EXISTS "Organization_transition_truncate_guard" ON "Organization";
      DROP TRIGGER IF EXISTS "User_transition_membership_sync" ON "User";
      DROP TRIGGER IF EXISTS "User_transition_owner_delete_guard" ON "User";
      CREATE TRIGGER "Organization_transition_delete_guard"
        BEFORE DELETE OR UPDATE OF "id" ON "Organization"
        FOR EACH ROW EXECUTE FUNCTION policydesk_guard_organization_delete();
      CREATE TRIGGER "Organization_transition_truncate_guard"
        BEFORE TRUNCATE ON "Organization"
        FOR EACH STATEMENT EXECUTE FUNCTION policydesk_guard_organization_delete();
      CREATE TRIGGER "User_transition_membership_sync"
        AFTER INSERT OR UPDATE OF "role", "active" ON "User"
        FOR EACH ROW EXECUTE FUNCTION policydesk_sync_user_membership();
      CREATE TRIGGER "User_transition_owner_delete_guard"
        BEFORE DELETE ON "User"
        FOR EACH ROW EXECUTE FUNCTION policydesk_guard_user_owner_delete();
    `);
    for (const table of PROTECTED_TENANT_TABLES) {
      const trigger = `${table}_transition_singleton_organization`;
      await client.query(`ALTER TABLE ${ident(table)} NO FORCE ROW LEVEL SECURITY`);
      await client.query(`ALTER TABLE ${ident(table)} DISABLE ROW LEVEL SECURITY`);
      await client.query(`DROP POLICY IF EXISTS "policydesk_tenant_context" ON ${ident(table)}`);
      await client.query(`DROP TRIGGER IF EXISTS "policydesk_tenant_context_required" ON ${ident(table)}`);
      await client.query(`DROP TRIGGER IF EXISTS ${ident(trigger)} ON ${ident(table)}`);
      await client.query(`CREATE TRIGGER ${ident(trigger)} BEFORE INSERT OR UPDATE OF "organizationId" ON ${ident(table)} FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization()`);
    }
    await client.query('DROP TRIGGER IF EXISTS "OrganizationMembership_transition_guard" ON "OrganizationMembership"');
    await client.query('CREATE TRIGGER "OrganizationMembership_transition_guard" BEFORE INSERT OR UPDATE OR DELETE ON "OrganizationMembership" FOR EACH ROW EXECUTE FUNCTION policydesk_guard_singleton_membership()');
    await client.query('UPDATE "PlatformRuntimeState" SET "writeMode" = \'MAINTENANCE\', "reason" = \'break-glass singleton rollback\', "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = 1');
    await client.query("COMMIT");
    console.log(`Singleton rollback PASS: ${PROTECTED_TENANT_TABLES.length} tenant tables have RLS disabled and transition barriers restored.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(error instanceof Error ? error.message : "POLICYDESK_MULTI_ORG_ROLLBACK_FAILED");
    process.exitCode = 1;
  } finally {
    if (lockHeld) await client.query("SELECT pg_advisory_unlock(hashtext($1))", [ROLLBACK_LOCK]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

void main();
