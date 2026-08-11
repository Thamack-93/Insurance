import { Pool } from "pg";
import { hasFlag, parseCliArgs } from "./_shared.ts";
import {
  DEPLOYMENT_IDENTITY_ID,
  canonicalNeonEndpointId,
  evaluateDeploymentDatabaseSafety,
} from "../src/lib/deployment-db-safety.ts";
import { validateDeploymentInfrastructure } from "./deployment-db-infrastructure.ts";
import { RUNTIME_DATABASE_TABLES } from "../src/lib/database-runtime-access.ts";

type StoredIdentity = { environment: string; fingerprint: string } | null;
type InfrastructureState = {
  identity: StoredIdentity;
  databaseName: string;
  roleName: string;
  runtimePrivilegesValid: boolean;
  triggersValid: boolean;
  functionValid: boolean;
  constraintsValid: boolean;
};

const args = parseCliArgs();
const runtimeOnly = hasFlag(args, "runtime-only");
const adminMode = hasFlag(args, "admin");
if (runtimeOnly && adminMode) throw new Error("Usa solo --runtime-only o --admin.");

async function readState(connectionString: string, applicationName: string): Promise<InfrastructureState> {
  const pool = new Pool({ connectionString, max: 1, application_name: applicationName });
  try {
    const [identityResult, metadataResult, runtimeTableResult, sequenceResult, triggerResult, functionResult, constraintResult] = await Promise.all([
      pool.query<{ environment: string; fingerprint: string }>(
        `SELECT "environment"::text AS environment, "fingerprint" FROM "DeploymentIdentity" WHERE "id" = $1`,
        [DEPLOYMENT_IDENTITY_ID],
      ),
      pool.query<{
        database_name: string;
        role_name: string;
        elevated: boolean;
        identity_select: boolean;
        identity_insert: boolean;
        identity_update: boolean;
        identity_delete: boolean;
        identity_truncate: boolean;
        migrations_access: boolean;
        schema_create: boolean;
        database_create: boolean;
        privileged_membership: boolean;
        owns_database_or_schema: boolean;
      }>(
        `SELECT current_database() AS database_name,
                current_user AS role_name,
                (role_definition.rolsuper OR role_definition.rolcreaterole OR role_definition.rolcreatedb
                 OR role_definition.rolreplication OR role_definition.rolbypassrls) AS elevated,
                has_table_privilege(current_user, '"DeploymentIdentity"', 'SELECT') AS identity_select,
                has_table_privilege(current_user, '"DeploymentIdentity"', 'INSERT') AS identity_insert,
                has_table_privilege(current_user, '"DeploymentIdentity"', 'UPDATE') AS identity_update,
                has_table_privilege(current_user, '"DeploymentIdentity"', 'DELETE') AS identity_delete,
                has_table_privilege(current_user, '"DeploymentIdentity"', 'TRUNCATE') AS identity_truncate,
                has_table_privilege(current_user, '"_prisma_migrations"', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS migrations_access,
                has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
                has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
                EXISTS (
                  SELECT 1 FROM pg_auth_members membership
                  JOIN pg_roles parent_role ON parent_role.oid = membership.roleid
                  WHERE membership.member = role_definition.oid
                    AND (parent_role.rolname = 'neon_superuser' OR parent_role.rolname LIKE '%\_owner' ESCAPE '\\')
                ) AS privileged_membership,
                (EXISTS (SELECT 1 FROM pg_database WHERE datname = current_database() AND datdba = role_definition.oid)
                 OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public' AND nspowner = role_definition.oid)
                 OR EXISTS (SELECT 1 FROM pg_class relation JOIN pg_namespace namespace_definition ON namespace_definition.oid = relation.relnamespace WHERE namespace_definition.nspname = 'public' AND relation.relowner = role_definition.oid)
                 OR EXISTS (SELECT 1 FROM pg_proc function_definition JOIN pg_namespace namespace_definition ON namespace_definition.oid = function_definition.pronamespace WHERE namespace_definition.nspname = 'public' AND function_definition.proowner = role_definition.oid)
                 OR EXISTS (SELECT 1 FROM pg_type type_definition JOIN pg_namespace namespace_definition ON namespace_definition.oid = type_definition.typnamespace WHERE namespace_definition.nspname = 'public' AND type_definition.typowner = role_definition.oid)) AS owns_database_or_schema
           FROM pg_roles role_definition
          WHERE role_definition.rolname = current_user`,
      ),
      pool.query<{ valid: boolean }>(
        `SELECT coalesce(bool_and(
                  has_table_privilege(current_user, format('%I.%I', 'public', table_name), 'SELECT')
                  AND has_table_privilege(current_user, format('%I.%I', 'public', table_name), 'INSERT')
                  AND has_table_privilege(current_user, format('%I.%I', 'public', table_name), 'UPDATE')
                  AND has_table_privilege(current_user, format('%I.%I', 'public', table_name), 'DELETE')
                  AND NOT has_table_privilege(current_user, format('%I.%I', 'public', table_name), 'TRUNCATE')
                ), false) AS valid
           FROM unnest($1::text[]) AS classified(table_name)`,
        [RUNTIME_DATABASE_TABLES],
      ),
      pool.query<{ valid: boolean }>(
        `SELECT coalesce(bool_and(
                  has_sequence_privilege(current_user, format('%I.%I', sequence_schema, sequence_name), 'USAGE')
                  AND has_sequence_privilege(current_user, format('%I.%I', sequence_schema, sequence_name), 'SELECT')
                  AND has_sequence_privilege(current_user, format('%I.%I', sequence_schema, sequence_name), 'UPDATE')
                ), true) AS valid
           FROM information_schema.sequences
          WHERE sequence_schema = 'public'`,
      ),
      pool.query<{ name: string; enabled: string; definition: string; function_name: string }>(
        `SELECT trigger_definition.tgname AS name,
                trigger_definition.tgenabled AS enabled,
                pg_get_triggerdef(trigger_definition.oid, true) AS definition,
                function_definition.proname AS function_name
           FROM pg_trigger trigger_definition
           JOIN pg_class table_definition ON table_definition.oid = trigger_definition.tgrelid
           JOIN pg_namespace namespace_definition ON namespace_definition.oid = table_definition.relnamespace
           JOIN pg_proc function_definition ON function_definition.oid = trigger_definition.tgfoid
          WHERE namespace_definition.nspname = 'public'
            AND table_definition.relname = 'DeploymentIdentity'
            AND NOT trigger_definition.tgisinternal`,
      ),
      pool.query<{ definition: string }>(
        `SELECT pg_get_functiondef(function_definition.oid) AS definition
           FROM pg_proc function_definition
           JOIN pg_namespace namespace_definition ON namespace_definition.oid = function_definition.pronamespace
          WHERE namespace_definition.nspname = 'public'
            AND function_definition.proname = 'policydesk_guard_deployment_identity'`,
      ),
      pool.query<{ name: string; definition: string }>(
        `SELECT constraint_definition.conname AS name,
                pg_get_constraintdef(constraint_definition.oid, true) AS definition
           FROM pg_constraint constraint_definition
           JOIN pg_class table_definition ON table_definition.oid = constraint_definition.conrelid
           JOIN pg_namespace namespace_definition ON namespace_definition.oid = table_definition.relnamespace
          WHERE namespace_definition.nspname = 'public'
            AND table_definition.relname = 'DeploymentIdentity'`,
      ),
    ]);
    const validation = validateDeploymentInfrastructure({
      triggers: triggerResult.rows.map((row) => ({ ...row, functionName: row.function_name })),
      functionDefinition: functionResult.rows[0]?.definition ?? "",
      constraints: constraintResult.rows,
    });
    const metadata = metadataResult.rows[0];
    return {
      identity: identityResult.rows.length === 1 ? identityResult.rows[0]! : null,
      databaseName: metadata?.database_name ?? "",
      roleName: metadata?.role_name ?? "",
      runtimePrivilegesValid: Boolean(metadata?.identity_select
        && !metadata.elevated
        && !metadata.identity_insert
        && !metadata.identity_update
        && !metadata.identity_delete
        && !metadata.identity_truncate
        && !metadata.migrations_access
        && !metadata.schema_create
        && !metadata.database_create
        && !metadata.privileged_membership
        && !metadata.owns_database_or_schema
        && runtimeTableResult.rows[0]?.valid
        && sequenceResult.rows[0]?.valid),
      ...validation,
    };
  } finally {
    await pool.end();
  }
}

async function main() {
  const pooledUrl = process.env.DATABASE_URL?.trim();
  if (!pooledUrl) throw new Error("DATABASE_URL es obligatoria.");
  const directUrl = process.env.DATABASE_URL_UNPOOLED?.trim();
  if (adminMode && !directUrl) throw new Error("--admin requiere DATABASE_URL_UNPOOLED.");
  const pooled = await readState(pooledUrl, "policydesk-deployment-safety-runtime");
  const direct = adminMode && directUrl
    ? await readState(directUrl, "policydesk-deployment-safety-admin")
    : null;
  const safety = evaluateDeploymentDatabaseSafety({
    expectedEnvironment: process.env.EXPECTED_DATABASE_ENV,
    expectedFingerprint: process.env.EXPECTED_DATABASE_FINGERPRINT,
    vercel: process.env.VERCEL,
    vercelEnvironment: process.env.VERCEL_ENV,
    actualEnvironment: pooled.identity?.environment,
    actualFingerprint: pooled.identity?.fingerprint,
  });
  const identitiesMatch = !direct || Boolean(
    pooled.identity && direct.identity
    && pooled.identity.environment === direct.identity.environment
    && pooled.identity.fingerprint === direct.identity.fingerprint,
  );
  const endpointsMatch = !directUrl || canonicalNeonEndpointId(pooledUrl) === canonicalNeonEndpointId(directUrl);
  const databasesMatch = !direct || pooled.databaseName === direct.databaseName;
  const expectedRole = process.env.EXPECTED_DATABASE_ROLE?.trim();
  const runtimeRoleMatches = !expectedRole || pooled.roleName === expectedRole;
  const runtimePrivilegesValid = !expectedRole || pooled.runtimePrivilegesValid;
  const adminRoleSeparated = !direct || direct.roleName !== pooled.roleName;
  const administrativeCredentialsAbsent = !runtimeOnly || ![
    process.env.DATABASE_URL_UNPOOLED,
    process.env.DATABASE_RUNTIME_URL,
    process.env.PRODUCTION_DATABASE_URL_UNPOOLED,
    process.env.NEON_API_KEY,
  ].some((value) => value?.trim());
  const infrastructureValid = pooled.triggersValid && pooled.functionValid && pooled.constraintsValid
    && (!direct || (direct.triggersValid && direct.functionValid && direct.constraintsValid));
  const pass = safety.safe && identitiesMatch && endpointsMatch && databasesMatch
    && runtimeRoleMatches && runtimePrivilegesValid && adminRoleSeparated && administrativeCredentialsAbsent && infrastructureValid;
  console.log(JSON.stringify({
    status: pass ? "PASS" : "FAIL",
    mode: adminMode ? "admin" : "runtime-only",
    expectedEnvironment: safety.expectedEnvironment,
    actualEnvironment: safety.actualEnvironment,
    runtimeEnvironmentMatches: safety.runtimeEnvironmentMatches,
    fingerprintMatches: safety.fingerprintMatches,
    pooledAndDirectIdentityMatch: identitiesMatch,
    pooledAndDirectEndpointMatch: endpointsMatch,
    pooledAndDirectDatabaseMatch: databasesMatch,
    runtimeRoleMatches,
    runtimePrivilegesValid,
    adminRoleSeparated,
    administrativeCredentialsAbsent,
    identityTriggersValid: pooled.triggersValid && (!direct || direct.triggersValid),
    identityFunctionValid: pooled.functionValid && (!direct || direct.functionValid),
    identityConstraintsValid: pooled.constraintsValid && (!direct || direct.constraintsValid),
  }));
  if (!pass) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "FAIL", error: error instanceof Error ? error.message : "Safety check failed." }));
  process.exitCode = 1;
});
