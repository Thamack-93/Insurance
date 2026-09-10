import "dotenv/config";

import { Pool } from "pg";
import { assertDisposableCertificationTarget } from "./tenant-certification-target.mjs";

async function main() {
  const connectionString = process.env.DATABASE_ADMIN_URL?.trim() || process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required.");
  if (process.env.TENANT_ISOLATION_TEST_DB === "1") assertDisposableCertificationTarget(connectionString);

  const pool = new Pool({ connectionString, max: 1, application_name: "policydesk-maintenance-control" });
  const client = await pool.connect();
  try {
    const current = await client.query<{ current_user: string }>("SELECT current_user");
    const runtimeRole = process.env.TENANT_RLS_APP_ROLE?.trim() || "policydesk_app";
    if (current.rows[0]?.current_user === runtimeRole) throw new Error("MAINTENANCE_REQUIRES_ADMIN_CONNECTION");
    await client.query("BEGIN");
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ["policydesk-maintenance-control-v1"]);
    await client.query('UPDATE "PlatformRuntimeState" SET "writeMode" = \'MAINTENANCE\', "reason" = \'operator maintenance window\', "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = 1');
    await client.query("COMMIT");
    console.log(JSON.stringify({ ok: true, mode: "MAINTENANCE" }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "MAINTENANCE_ENABLE_FAILED");
  process.exitCode = 1;
});
