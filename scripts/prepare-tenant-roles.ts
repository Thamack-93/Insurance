import "dotenv/config";

import { Pool } from "pg";

/**
 * Prepare the roles used by the multi-tenant runtime. This is intentionally a
 * direct, operator-only step: PostgreSQL does not allow CREATE ROLE/ALTER ROLE
 * inside Prisma's transactional migrations. It changes no application schema
 * and never runs with the pooled runtime credential.
 */

function directDatabaseUrl() {
  const value = process.env.DATABASE_ADMIN_URL?.trim();
  if (!value) throw new Error("DATABASE_ADMIN_URL_REQUIRED");
  const url = new URL(value);
  if (/pooler/i.test(url.hostname) || url.searchParams.has("pgbouncer")) {
    throw new Error("DATABASE_ADMIN_URL_MUST_BE_DIRECT");
  }
  const runtimeRole = process.env.TENANT_RLS_APP_ROLE?.trim() || "policydesk_app";
  if (decodeURIComponent(url.username) === runtimeRole) {
    throw new Error("TENANT_ROLE_PREP_REQUIRES_ADMIN_CONNECTION");
  }
  return value;
}

function roleName(value: string | undefined, fallback: string) {
  const role = value?.trim() || fallback;
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(role)) {
    throw new Error("TENANT_ROLE_NAME_INVALID");
  }
  return role;
}

function identifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function main() {
  const databaseUrl = directDatabaseUrl();
  const appRole = roleName(process.env.TENANT_RLS_APP_ROLE, "policydesk_app");
  const ownerRole = roleName(process.env.TENANT_RLS_PLATFORM_OWNER_ROLE, "policydesk_platform_owner");
  const readOnlyRole = roleName(process.env.PRODUCTION_READONLY_ROLE, "policydesk_readonly");
  if (appRole !== "policydesk_app" || ownerRole !== "policydesk_platform_owner" || readOnlyRole !== "policydesk_readonly") {
    throw new Error("TENANT_ROLE_PREP_REQUIRES_CANONICAL_ROLE_NAMES");
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: "policydesk-tenant-role-preflight" });
  const client = await pool.connect();
  try {
    const current = await client.query<{ current_user: string }>("SELECT current_user");
    const administrativeRole = current.rows[0]?.current_user;
    if (!administrativeRole || administrativeRole === appRole || administrativeRole === ownerRole || administrativeRole === readOnlyRole) {
      throw new Error("TENANT_ROLE_PREP_REQUIRES_ADMIN_CONNECTION");
    }

    const appState = await client.query<{ rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean; rolinherit: boolean }>(
      "SELECT rolsuper, rolbypassrls, rolcanlogin, rolinherit FROM pg_roles WHERE rolname = $1", [appRole],
    );
    if (!appState.rowCount) {
      await client.query(`CREATE ROLE ${identifier(appRole)} LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`);
    } else if (appState.rows[0].rolsuper || appState.rows[0].rolbypassrls || !appState.rows[0].rolcanlogin || appState.rows[0].rolinherit) {
      await client.query(`ALTER ROLE ${identifier(appRole)} LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`);
    }

    const ownerState = await client.query<{ rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean; rolinherit: boolean }>(
      "SELECT rolsuper, rolbypassrls, rolcanlogin, rolinherit FROM pg_roles WHERE rolname = $1", [ownerRole],
    );
    if (!ownerState.rowCount) {
      await client.query(`CREATE ROLE ${identifier(ownerRole)} NOLOGIN NOSUPERUSER BYPASSRLS NOINHERIT`);
    } else if (ownerState.rows[0].rolsuper || !ownerState.rows[0].rolbypassrls || ownerState.rows[0].rolcanlogin || ownerState.rows[0].rolinherit) {
      await client.query(`ALTER ROLE ${identifier(ownerRole)} NOLOGIN NOSUPERUSER BYPASSRLS NOINHERIT`);
    }
    // Managed Neon owners are intentionally not superusers. Explicit SET-role
    // membership is required so the direct administrative connection can
    // transfer ownership of the narrowly scoped SECURITY DEFINER function.
    await client.query(`GRANT ${identifier(ownerRole)} TO ${identifier(administrativeRole)}`);

    const readOnlyState = await client.query<{ rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean; rolinherit: boolean }>(
      "SELECT rolsuper, rolbypassrls, rolcanlogin, rolinherit FROM pg_roles WHERE rolname = $1", [readOnlyRole],
    );
    if (!readOnlyState.rowCount) {
      await client.query(`CREATE ROLE ${identifier(readOnlyRole)} LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`);
    } else if (readOnlyState.rows[0].rolsuper || readOnlyState.rows[0].rolbypassrls || !readOnlyState.rows[0].rolcanlogin || readOnlyState.rows[0].rolinherit) {
      await client.query(`ALTER ROLE ${identifier(readOnlyRole)} LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`);
    }

    const roles = await client.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean; rolinherit: boolean }>(
      "SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolinherit FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname",
      [[appRole, ownerRole, readOnlyRole]],
    );
    const app = roles.rows.find((role) => role.rolname === appRole);
    const owner = roles.rows.find((role) => role.rolname === ownerRole);
    const readOnly = roles.rows.find((role) => role.rolname === readOnlyRole);
    if (!app || app.rolsuper || app.rolbypassrls || !app.rolcanlogin || app.rolinherit) throw new Error("TENANT_APP_ROLE_CONFIGURATION_FAILED");
    if (!owner || owner.rolsuper || !owner.rolbypassrls || owner.rolcanlogin || owner.rolinherit) throw new Error("TENANT_PLATFORM_OWNER_ROLE_CONFIGURATION_FAILED");
    if (!readOnly || readOnly.rolsuper || readOnly.rolbypassrls || !readOnly.rolcanlogin || readOnly.rolinherit) throw new Error("TENANT_READONLY_ROLE_CONFIGURATION_FAILED");
    console.log(JSON.stringify({ ok: true, appRole, platformOwnerRole: ownerRole, readOnlyRole, passwordProvisioned: false }));
  } finally {
    client.release();
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "TENANT_ROLE_PREPARATION_FAILED");
  process.exitCode = 1;
});
