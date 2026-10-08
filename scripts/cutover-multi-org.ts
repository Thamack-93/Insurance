import "dotenv/config";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Pool } from "pg";
import { assertMaintenanceOrCutoverTarget } from "./cutover-target.mjs";

const execFileAsync = promisify(execFile);
export const MULTI_ORG_TRANSITION_LOCK = "policydesk-multi-org-transition-v3";
const CUTOVER_LOCK = MULTI_ORG_TRANSITION_LOCK;

function directDatabaseUrl() {
  const value = process.env.DATABASE_ADMIN_URL?.trim();
  if (!value) throw new Error("POLICYDESK_MULTI_ORG_DATABASE_REQUIRED");
  const url = new URL(value);
  if (/pooler/i.test(url.hostname) || url.searchParams.has("pgbouncer")) {
    throw new Error("POLICYDESK_MULTI_ORG_DIRECT_DATABASE_REQUIRED");
  }
  return value;
}

async function main() {
  if (process.env.ENABLE_TENANT_RLS_CUTOVER !== "1") {
    throw new Error("ENABLE_TENANT_RLS_CUTOVER=1 es obligatorio.");
  }
  const appRole = process.env.TENANT_RLS_APP_ROLE?.trim() || "policydesk_app";
  const platformOwnerRole = process.env.TENANT_RLS_PLATFORM_OWNER_ROLE?.trim() || "policydesk_platform_owner";
  if (appRole !== "policydesk_app" || platformOwnerRole !== "policydesk_platform_owner") {
    throw new Error("POLICYDESK_TENANT_CUTOVER_REQUIRES_CANONICAL_ROLE_NAMES");
  }
  const databaseUrl = directDatabaseUrl();
  assertMaintenanceOrCutoverTarget(databaseUrl, process.env);
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    application_name: "policydesk-multi-org-cutover-wrapper",
  });
  const client = await pool.connect();
  let lockHeld = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [CUTOVER_LOCK]);
    lockHeld = true;
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL lock_timeout = '30s'");
    await client.query("SET LOCAL statement_timeout = '10min'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [CUTOVER_LOCK]);

    const state = await client.query<{ writeMode: string }>(
      'SELECT "writeMode" FROM "PlatformRuntimeState" WHERE "id" = 1',
    );
    if (state.rows[0]?.writeMode !== "MAINTENANCE") {
      throw new Error("POLICYDESK_TENANT_CUTOVER_REQUIRES_MAINTENANCE");
    }
    const current = await client.query<{ current_user: string }>("SELECT current_user");
    if (current.rows[0]?.current_user === appRole) throw new Error("POLICYDESK_CUTOVER_REQUIRES_ADMIN_CONNECTION");
    const organizations = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM "Organization"',
    );
    if (Number(organizations.rows[0]?.count ?? 0) < 1) {
      throw new Error("POLICYDESK_MULTI_ORG_REQUIRES_ONE_ORGANIZATION");
    }
    await client.query("COMMIT");

    // PostgreSQL role DDL cannot run inside Prisma's transactional
    // migration. Prepare the restricted runtime and non-login
    // SECURITY DEFINER owner after maintenance preflight, before the
    // versioned migration starts.
    const rolePreparation = await execFileAsync("npm", ["run", "prepare:tenant-roles"], {
      env: { ...process.env, DATABASE_ADMIN_URL: databaseUrl },
      maxBuffer: 2 * 1024 * 1024,
    });
    if (rolePreparation.stdout.trim()) console.log(rolePreparation.stdout.trim());
    if (rolePreparation.stderr.trim()) console.error(rolePreparation.stderr.trim());
    const roles = await client.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean; rolinherit: boolean }>(
      "SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolinherit FROM pg_roles WHERE rolname = ANY($1::text[])",
      [[appRole, platformOwnerRole]],
    );
    const app = roles.rows.find((role) => role.rolname === appRole);
    const owner = roles.rows.find((role) => role.rolname !== appRole);
    if (!app || app.rolsuper || app.rolbypassrls || !app.rolcanlogin || app.rolinherit) {
      throw new Error("POLICYDESK_TENANT_APP_ROLE_INVALID");
    }
    if (!owner || owner.rolsuper || !owner.rolbypassrls || owner.rolcanlogin || owner.rolinherit) {
      throw new Error("POLICYDESK_TENANT_PLATFORM_OWNER_ROLE_INVALID");
    }

    // The migration is the sole schema executor. This wrapper deliberately
    // contains no DDL; it only performs preflight, lock and reporting.
    const migration = await execFileAsync("npx", ["prisma", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_ADMIN_URL: databaseUrl },
      maxBuffer: 4 * 1024 * 1024,
    });
    console.log(migration.stdout.trim());
    if (migration.stderr.trim()) console.error(migration.stderr.trim());
    console.log("Multi-org cutover wrapper PASS: versioned Prisma migrations applied under maintenance.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(error instanceof Error ? error.message : "POLICYDESK_MULTI_ORG_CUTOVER_FAILED");
    process.exitCode = 1;
  } finally {
    if (lockHeld) await client.query("SELECT pg_advisory_unlock(hashtext($1))", [CUTOVER_LOCK]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

void main();
