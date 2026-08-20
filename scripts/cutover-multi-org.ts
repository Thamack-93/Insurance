import "dotenv/config";

import { Pool, type PoolClient } from "pg";
import {
  EXPECTED_TENANT_TRIGGERS,
  PROTECTED_TENANT_TABLES,
  TENANT_RELATION_CHECKS,
} from "../src/lib/tenant-organization-foundation.ts";

const CUTOVER_LOCK = "policydesk-multi-org-cutover-v1";

function identifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function literal(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function relationConstraintName(child: string, column: string) {
  return `policydesk_${child}_${column}_tenant_fkey`.slice(0, 63);
}

function connectionString() {
  const value = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("POLICYDESK_MULTI_ORG_DATABASE_REQUIRED");
  const url = new URL(value);
  if (/pooler/i.test(url.hostname)) throw new Error("POLICYDESK_MULTI_ORG_DIRECT_DATABASE_REQUIRED");
  return value;
}

async function count(client: PoolClient, sql: string, values: unknown[] = []) {
  const result = await client.query<{ count: string }>(sql, values);
  return Number(result.rows[0]?.count ?? 0);
}

async function preflight(client: PoolClient, appRole: string) {
  const organizationCount = await count(client, `SELECT count(*)::text AS count FROM "Organization"`);
  if (organizationCount < 2) throw new Error("POLICYDESK_MULTI_ORG_REQUIRES_TWO_ORGANIZATIONS");

  const role = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`, [appRole]);
  if (!role.rows[0]) throw new Error("POLICYDESK_TENANT_APP_ROLE_MISSING");
  if (role.rows[0].rolsuper || role.rows[0].rolbypassrls) throw new Error("POLICYDESK_TENANT_APP_ROLE_BYPASSES_RLS");

  for (const table of PROTECTED_TENANT_TABLES) {
    const nulls = await count(client, `SELECT count(*)::text AS count FROM ${identifier(table)} WHERE "organizationId" IS NULL`);
    if (nulls > 0) throw new Error(`POLICYDESK_TENANT_NULL:${table}:${nulls}`);
    const dangling = await count(client, `SELECT count(*)::text AS count FROM ${identifier(table)} t LEFT JOIN "Organization" o ON o."id" = t."organizationId" WHERE o."id" IS NULL`);
    if (dangling > 0) throw new Error(`POLICYDESK_TENANT_DANGLING:${table}:${dangling}`);
  }
  for (const [child, column, parent] of TENANT_RELATION_CHECKS) {
    const crossed = await count(client, `SELECT count(*)::text AS count FROM ${identifier(child)} c JOIN ${identifier(parent)} p ON p."id"::text = c.${identifier(column)}::text WHERE c."organizationId" <> p."organizationId"`);
    if (crossed > 0) throw new Error(`POLICYDESK_CROSS_ORG_RELATION:${child}.${column}:${crossed}`);
  }
  const invalidOwners = await count(client, `SELECT count(*)::text AS count FROM (SELECT o."id" FROM "Organization" o LEFT JOIN "OrganizationMembership" m ON m."organizationId" = o."id" AND m."role" = 'OWNER' AND m."active" LEFT JOIN "User" u ON u."id" = m."userId" AND u."active" GROUP BY o."id" HAVING count(m."id") <> 1) invalid`);
  if (invalidOwners > 0) throw new Error("POLICYDESK_ORGANIZATION_OWNER_INVARIANT_FAILED");
}

async function installTenantRelationGuard(client: PoolClient, child: string, column: string, parent: string) {
  const trigger = `policydesk_tenant_relation_${child}_${column}`;
  await client.query(`DROP TRIGGER IF EXISTS ${identifier(trigger)} ON ${identifier(child)}`);
  await client.query(`CREATE TRIGGER ${identifier(trigger)} BEFORE INSERT OR UPDATE OF "organizationId", ${identifier(column)} ON ${identifier(child)} FOR EACH ROW EXECUTE FUNCTION policydesk_guard_tenant_relation(${literal(column)}, ${literal(parent)})`);
}

async function main() {
  if (process.env.ENABLE_TENANT_RLS_CUTOVER !== "1") throw new Error("ENABLE_TENANT_RLS_CUTOVER=1 es obligatorio.");
  const appRole = process.env.TENANT_RLS_APP_ROLE?.trim();
  if (!appRole) throw new Error("TENANT_RLS_APP_ROLE es obligatorio.");
  const pool = new Pool({ connectionString: connectionString(), max: 1, application_name: "policydesk-multi-org-cutover" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL lock_timeout = '30s'");
    await client.query("SET LOCAL statement_timeout = '10min'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [CUTOVER_LOCK]);
    await preflight(client, appRole);

    await client.query(`DROP INDEX IF EXISTS "Organization_transition_singleton_idx"`);
    await client.query(`DROP INDEX IF EXISTS "OrganizationMembership_transition_owner_idx"`);
    await client.query(`DROP INDEX IF EXISTS "OrganizationMembership_active_owner_per_org_idx"`);
    await client.query(`CREATE UNIQUE INDEX "OrganizationMembership_active_owner_per_org_idx" ON "OrganizationMembership" ("organizationId") WHERE "role" = 'OWNER'`);
    for (const trigger of [
      "Organization_transition_truncate_guard",
      "OrganizationMembership_transition_guard",
      "User_transition_membership_sync",
      "User_transition_owner_delete_guard",
      ...Object.values(EXPECTED_TENANT_TRIGGERS),
    ]) {
      const table = trigger === "Organization_transition_truncate_guard" ? "Organization"
        : trigger === "OrganizationMembership_transition_guard" ? "OrganizationMembership"
          : trigger.startsWith("User_") ? "User"
            : trigger.slice(0, trigger.indexOf("_transition"));
      await client.query(`DROP TRIGGER IF EXISTS ${identifier(trigger)} ON ${identifier(table)}`);
    }

    await client.query(`
      CREATE OR REPLACE FUNCTION policydesk_guard_tenant_relation()
      RETURNS trigger LANGUAGE plpgsql AS $function$
      DECLARE child_org text; parent_id text; parent_org text;
      BEGIN
        child_org := to_jsonb(NEW)->>'organizationId';
        parent_id := to_jsonb(NEW)->>TG_ARGV[0];
        IF child_org IS NULL OR parent_id IS NULL THEN RETURN NEW; END IF;
        EXECUTE format('SELECT "organizationId"::text FROM %I WHERE "id"::text = $1', TG_ARGV[1]) INTO parent_org USING parent_id;
        IF parent_org IS NOT NULL AND parent_org <> child_org THEN
          RAISE EXCEPTION 'POLICYDESK_CROSS_ORGANIZATION_RELATION:%:%', TG_TABLE_NAME, TG_ARGV[0] USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END;
      $function$;
    `);
    for (const [child, column, parent] of TENANT_RELATION_CHECKS) await installTenantRelationGuard(client, child, column, parent);

    await client.query(`
      CREATE OR REPLACE FUNCTION policydesk_guard_owner_membership()
      RETURNS trigger LANGUAGE plpgsql AS $function$
      BEGIN
        IF TG_OP = 'DELETE' AND OLD."role" = 'OWNER' THEN
          RAISE EXCEPTION 'POLICYDESK_OWNER_IMMUTABLE' USING ERRCODE = 'P0001';
        END IF;
        IF TG_OP = 'UPDATE' AND OLD."role" = 'OWNER' AND (NEW."role" <> 'OWNER' OR NOT NEW."active" OR NEW."organizationId" <> OLD."organizationId") THEN
          RAISE EXCEPTION 'POLICYDESK_OWNER_IMMUTABLE' USING ERRCODE = 'P0001';
        END IF;
        RETURN COALESCE(NEW, OLD);
      END;
      $function$;
      DROP TRIGGER IF EXISTS "OrganizationMembership_owner_guard" ON "OrganizationMembership";
      CREATE TRIGGER "OrganizationMembership_owner_guard" BEFORE UPDATE OR DELETE ON "OrganizationMembership" FOR EACH ROW EXECUTE FUNCTION policydesk_guard_owner_membership();
    `);

    for (const table of PROTECTED_TENANT_TABLES) {
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${identifier(`policydesk_${table}_organization_id_unique`.slice(0, 63))} ON ${identifier(table)} ("organizationId", "id")`);
    }
    for (const [child, column, parent] of TENANT_RELATION_CHECKS) {
      const constraint = relationConstraintName(child, column);
      await client.query(`DO $block$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ${literal(constraint)}) THEN
          ALTER TABLE ${identifier(child)} ADD CONSTRAINT ${identifier(constraint)} FOREIGN KEY ("organizationId", ${identifier(column)}) REFERENCES ${identifier(parent)} ("organizationId", "id") NOT VALID;
        END IF;
      END $block$;`);
      await client.query(`ALTER TABLE ${identifier(child)} VALIDATE CONSTRAINT ${identifier(constraint)}`);
    }
    for (const table of PROTECTED_TENANT_TABLES) {
      await client.query(`ALTER TABLE ${identifier(table)} ALTER COLUMN "organizationId" SET NOT NULL`);
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${identifier(table)} TO ${identifier(appRole)}`);
      await client.query(`DROP POLICY IF EXISTS "policydesk_tenant_context" ON ${identifier(table)}`);
      await client.query(`ALTER TABLE ${identifier(table)} ENABLE ROW LEVEL SECURITY`);
      await client.query(`ALTER TABLE ${identifier(table)} FORCE ROW LEVEL SECURITY`);
      await client.query(`CREATE POLICY "policydesk_tenant_context" ON ${identifier(table)} USING ("organizationId" = nullif(current_setting('app.organization_id', true), '')) WITH CHECK ("organizationId" = nullif(current_setting('app.organization_id', true), ''))`);
    }
    // The platform panel receives only aggregate counts. The function is
    // SECURITY DEFINER and exposes no tenant rows; the application role gets
    // EXECUTE but never receives a RLS bypass or table ownership.
    await client.query(`
      CREATE OR REPLACE FUNCTION policydesk_platform_tenant_metrics(org_ids text[])
      RETURNS TABLE("organizationId" text, "clientCount" bigint, "policyCount" bigint)
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = public
      AS $function$
        SELECT o.id,
          (SELECT count(*) FROM "Client" c WHERE c."organizationId" = o.id),
          (SELECT count(*) FROM "Policy" p WHERE p."organizationId" = o.id)
        FROM "Organization" o
        WHERE o.id = ANY(org_ids)
      $function$;
      REVOKE ALL ON FUNCTION policydesk_platform_tenant_metrics(text[]) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION policydesk_platform_tenant_metrics(text[]) TO ${identifier(appRole)};
    `);
    await client.query(`GRANT SELECT, INSERT, UPDATE ON TABLE "User", "Organization", "OrganizationMembership", "PlatformAuditLog" TO ${identifier(appRole)}`);
    await client.query("COMMIT");
    console.log(`Multi-org cutover PASS: ${PROTECTED_TENANT_TABLES.length} tenant tables, RLS FORCE and relation guards installed.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(error instanceof Error ? error.message : "POLICYDESK_MULTI_ORG_CUTOVER_FAILED");
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
