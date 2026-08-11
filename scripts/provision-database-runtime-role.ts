import { Pool, type PoolClient } from "pg";
import { getFlag, hasFlag, parseCliArgs } from "./_shared.ts";
import { RUNTIME_DATABASE_ROLE, RUNTIME_DATABASE_TABLES } from "../src/lib/database-runtime-access.ts";

const args = parseCliArgs();
const apply = hasFlag(args, "apply");
const rotatePassword = hasFlag(args, "rotate-password");
const json = hasFlag(args, "json");
const LOCK_KEY = "policydesk-runtime-role-v1";

type RoleState = {
  exists: boolean;
  canLogin: boolean;
  elevated: boolean;
  privilegedMemberships: string[];
};

async function hasForbiddenPrivileges(client: PoolClient, name: string) {
  const result = await client.query<{ forbidden: boolean }>(
    `SELECT
       has_schema_privilege($1, 'public', 'CREATE')
       OR has_database_privilege($1, current_database(), 'CREATE')
       OR EXISTS (
         SELECT 1 FROM pg_roles runtime_definition
         WHERE runtime_definition.rolname = $1 AND (
           EXISTS (SELECT 1 FROM pg_database WHERE datname = current_database() AND datdba = runtime_definition.oid)
           OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public' AND nspowner = runtime_definition.oid)
           OR EXISTS (SELECT 1 FROM pg_class relation JOIN pg_namespace namespace_definition ON namespace_definition.oid = relation.relnamespace WHERE namespace_definition.nspname = 'public' AND relation.relowner = runtime_definition.oid)
           OR EXISTS (SELECT 1 FROM pg_proc function_definition JOIN pg_namespace namespace_definition ON namespace_definition.oid = function_definition.pronamespace WHERE namespace_definition.nspname = 'public' AND function_definition.proowner = runtime_definition.oid)
           OR EXISTS (SELECT 1 FROM pg_type type_definition JOIN pg_namespace namespace_definition ON namespace_definition.oid = type_definition.typnamespace WHERE namespace_definition.nspname = 'public' AND type_definition.typowner = runtime_definition.oid)
         )
       )
       OR EXISTS (
         SELECT 1 FROM unnest($2::text[]) AS classified(table_name)
         WHERE has_table_privilege($1, format('%I.%I', 'public', table_name), 'TRUNCATE')
       )
       OR CASE WHEN to_regclass('public."DeploymentIdentity"') IS NULL THEN false ELSE
         has_table_privilege($1, 'public."DeploymentIdentity"', 'INSERT')
         OR has_table_privilege($1, 'public."DeploymentIdentity"', 'UPDATE')
         OR has_table_privilege($1, 'public."DeploymentIdentity"', 'DELETE')
         OR has_table_privilege($1, 'public."DeploymentIdentity"', 'TRUNCATE')
       END
       OR CASE WHEN to_regclass('public."_prisma_migrations"') IS NULL THEN false ELSE
         has_table_privilege($1, 'public."_prisma_migrations"', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       END
       AS forbidden`,
    [name, RUNTIME_DATABASE_TABLES],
  );
  return result.rows[0]?.forbidden === true;
}

function print(value: Record<string, unknown>) {
  if (json) console.log(JSON.stringify(value));
  else Object.entries(value).forEach(([key, entry]) => console.log(`${key}: ${String(entry)}`));
}

function runtimeRoleName(adminUrl: string) {
  const requested = getFlag(args, "role-name")?.trim() || RUNTIME_DATABASE_ROLE;
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(requested)) throw new Error("El nombre del rol runtime no es válido.");
  if (requested !== RUNTIME_DATABASE_ROLE) {
    const host = new URL(adminUrl).hostname.toLowerCase();
    const local = ["127.0.0.1", "localhost", "::1"].includes(host);
    if (!local || process.env.NODE_ENV !== "test") throw new Error("Un role-name alternativo solo se permite en tests locales.");
  }
  return requested;
}

async function readRole(client: PoolClient, name: string): Promise<RoleState> {
  const result = await client.query<{
    rolcanlogin: boolean;
    elevated: boolean;
    memberships: string[] | null;
  }>(
    `SELECT role_definition.rolcanlogin,
            (role_definition.rolsuper OR role_definition.rolcreaterole OR role_definition.rolcreatedb
             OR role_definition.rolreplication OR role_definition.rolbypassrls) AS elevated,
            array_remove(array_agg(parent_role.rolname), NULL) AS memberships
       FROM pg_roles role_definition
       LEFT JOIN pg_auth_members membership ON membership.member = role_definition.oid
       LEFT JOIN pg_roles parent_role ON parent_role.oid = membership.roleid
      WHERE role_definition.rolname = $1
      GROUP BY role_definition.oid`,
    [name],
  );
  const row = result.rows[0];
  if (!row) return { exists: false, canLogin: false, elevated: false, privilegedMemberships: [] };
  return {
    exists: true,
    canLogin: row.rolcanlogin,
    elevated: row.elevated,
    privilegedMemberships: (row.memberships ?? []).filter((membership) => membership === "neon_superuser" || membership.endsWith("_owner")),
  };
}

function assertCompatible(state: RoleState) {
  if (!state.exists) return;
  if (!state.canLogin || state.elevated || state.privilegedMemberships.length > 0) {
    throw new Error("El rol runtime existente tiene privilegios incompatibles; requiere revisión manual.");
  }
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function main() {
  const adminUrl = process.env.DATABASE_URL_UNPOOLED?.trim();
  const runtimeUrl = process.env.DATABASE_RUNTIME_URL?.trim();
  if (!adminUrl || !runtimeUrl) throw new Error("DATABASE_URL_UNPOOLED y DATABASE_RUNTIME_URL son obligatorias.");
  const admin = new URL(adminUrl);
  const runtime = new URL(runtimeUrl);
  const name = runtimeRoleName(adminUrl);
  if (decodeURIComponent(runtime.username) !== name) throw new Error("DATABASE_RUNTIME_URL no usa el rol runtime esperado.");
  if (!runtime.password) throw new Error("DATABASE_RUNTIME_URL debe incluir un password runtime.");
  if (admin.hostname.replace(/-pooler(?=\.)/, "") !== runtime.hostname.replace(/-pooler(?=\.)/, "") || admin.pathname !== runtime.pathname) {
    throw new Error("Las conexiones admin y runtime no apuntan al mismo endpoint/database.");
  }
  if (!runtime.hostname.split(".")[0]?.endsWith("-pooler") && !["127.0.0.1", "localhost", "::1"].includes(runtime.hostname)) {
    throw new Error("DATABASE_RUNTIME_URL debe usar el endpoint pooled.");
  }
  if (rotatePassword && (!apply || process.env.ALLOW_DATABASE_RUNTIME_ROLE_ROTATION !== "1")) {
    throw new Error("La rotación requiere --apply y ALLOW_DATABASE_RUNTIME_ROLE_ROTATION=1.");
  }

  const pool = new Pool({ connectionString: adminUrl, max: 1, application_name: "policydesk-runtime-role-admin" });
  const client = await pool.connect();
  try {
    const before = await readRole(client, name);
    assertCompatible(before);
    if (before.exists && await hasForbiddenPrivileges(client, name)) {
      throw new Error("El rol runtime existente tiene grants incompatibles; requiere revisión manual.");
    }
    const tablesResult = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const actualTables = new Set(tablesResult.rows.map((row) => row.table_name));
    const missingTables = RUNTIME_DATABASE_TABLES.filter((table) => !actualTables.has(table));
    if (missingTables.length > 0) throw new Error(`Faltan tablas runtime clasificadas: ${missingTables.join(", ")}.`);
    print({
      mode: apply ? "apply" : "preview",
      runtimeRole: name,
      roleExists: before.exists,
      createRequired: !before.exists,
      passwordRotationRequired: before.exists && rotatePassword,
      adminAndRuntimeTargetsMatch: true,
      classifiedRuntimeTables: RUNTIME_DATABASE_TABLES.length,
    });
    if (!apply) return;

    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL lock_timeout = '30s'`);
      await client.query(`SET LOCAL statement_timeout = '5min'`);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [LOCK_KEY]);
      const lockedState = await readRole(client, name);
      assertCompatible(lockedState);
      const quotedPassword = (await client.query<{ quoted: string }>("SELECT quote_literal($1) AS quoted", [decodeURIComponent(runtime.password)])).rows[0]?.quoted;
      if (!quotedPassword) throw new Error("No se pudo preparar el password runtime.");
      if (!lockedState.exists) {
        await client.query(`CREATE ROLE ${quoteIdentifier(name)} LOGIN PASSWORD ${quotedPassword} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
      } else if (rotatePassword) {
        await client.query(`ALTER ROLE ${quoteIdentifier(name)} PASSWORD ${quotedPassword}`);
      }
      const databaseIdentifier = (await client.query<{ quoted: string }>("SELECT quote_ident(current_database()) AS quoted")).rows[0]?.quoted;
      if (!databaseIdentifier) throw new Error("No se pudo resolver la base administrativa.");
      const roleIdentifier = quoteIdentifier(name);
      const tableList = RUNTIME_DATABASE_TABLES.map(quoteIdentifier).join(", ");
      await client.query(`GRANT CONNECT ON DATABASE ${databaseIdentifier} TO ${roleIdentifier}`);
      await client.query(`REVOKE CREATE, TEMPORARY ON DATABASE ${databaseIdentifier} FROM ${roleIdentifier}`);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${roleIdentifier}`);
      await client.query(`REVOKE CREATE ON SCHEMA public FROM ${roleIdentifier}`);
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${tableList} TO ${roleIdentifier}`);
      await client.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${roleIdentifier}`);
      await client.query(`REVOKE ALL ON TABLE "_prisma_migrations" FROM ${roleIdentifier}`);
      const identityExists = await client.query<{ exists: boolean }>(`SELECT to_regclass('public."DeploymentIdentity"') IS NOT NULL AS exists`);
      if (identityExists.rows[0]?.exists) {
        await client.query(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "DeploymentIdentity" FROM ${roleIdentifier}`);
        await client.query(`GRANT SELECT ON TABLE "DeploymentIdentity" TO ${roleIdentifier}`);
      }
      const after = await readRole(client, name);
      assertCompatible(after);
      if (await hasForbiddenPrivileges(client, name)) throw new Error("El rol runtime conserva privilegios prohibidos.");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Falló el provisionamiento del rol runtime.");
  process.exitCode = 1;
});
