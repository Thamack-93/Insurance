import "dotenv/config";

import { Pool } from "pg";
import { assertMaintenanceOrCutoverTarget } from "./cutover-target.mjs";
import { MULTI_ORG_TRANSITION_LOCK } from "../src/lib/tenant-cutover-lock.ts";

const ACTIVE_TRANSACTION_DRAIN_TIMEOUT_MS = 90_000;
const ACTIVE_TRANSACTION_DRAIN_POLL_MS = 250;

async function main() {
  const connectionString = process.env.DATABASE_ADMIN_URL?.trim() || process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required.");
  assertMaintenanceOrCutoverTarget(connectionString, process.env);

  const pool = new Pool({ connectionString, max: 1, application_name: "policydesk-maintenance-control" });
  const client = await pool.connect();
  let drainLockHeld = false;
  try {
    const current = await client.query<{ current_user: string }>("SELECT current_user");
    const runtimeRole = process.env.TENANT_RLS_APP_ROLE?.trim() || "policydesk_app";
    if (current.rows[0]?.current_user === runtimeRole) throw new Error("MAINTENANCE_REQUIRES_ADMIN_CONNECTION");
    // Cron routes take the shared form of this lock before reading write mode
    // and hold it until their side effects finish. The exclusive lock waits
    // for all admitted cron work to drain and blocks new jobs through the
    // maintenance-state update.
    const lockWaitStartedAt = Date.now();
    let lockAcquired = false;
    while (Date.now() - lockWaitStartedAt < ACTIVE_TRANSACTION_DRAIN_TIMEOUT_MS) {
      const lock = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
        [MULTI_ORG_TRANSITION_LOCK],
      );
      if (lock.rows[0]?.acquired === true) {
        lockAcquired = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, ACTIVE_TRANSACTION_DRAIN_POLL_MS));
    }
    if (!lockAcquired) throw new Error("MAINTENANCE_CRON_ADMISSION_LOCK_TIMEOUT");
    drainLockHeld = true;
    await client.query("BEGIN");
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ["policydesk-maintenance-control-v1"]);
    const updated = await client.query('UPDATE "PlatformRuntimeState" SET "writeMode" = \'MAINTENANCE\', "reason" = \'operator maintenance window\', "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = 1');
    if (updated.rowCount !== 1) throw new Error("PLATFORM_RUNTIME_STATE_MISSING");
    await client.query("COMMIT");
    const drainStartedAt = Date.now();
    let idleChecks = 0;
    while (Date.now() - drainStartedAt < ACTIVE_TRANSACTION_DRAIN_TIMEOUT_MS) {
      const active = await client.query<{ count: number }>(`
        SELECT count(*)::int AS count
          FROM pg_stat_activity
         WHERE datname = current_database()
           AND pid <> pg_backend_pid()
           AND xact_start IS NOT NULL
      `);
      if (Number(active.rows[0]?.count ?? 0) === 0) {
        idleChecks += 1;
        if (idleChecks >= 3) break;
      } else {
        idleChecks = 0;
      }
      await new Promise((resolve) => setTimeout(resolve, ACTIVE_TRANSACTION_DRAIN_POLL_MS));
    }
    if (idleChecks < 3) throw new Error("MAINTENANCE_ACTIVE_TRANSACTIONS_DID_NOT_DRAIN");
    console.log(JSON.stringify({
      ok: true,
      mode: "MAINTENANCE",
      scheduledJobsDrained: true,
      activeTransactionsDrained: true,
      drainWaitMs: Date.now() - drainStartedAt,
    }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (drainLockHeld) {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [MULTI_ORG_TRANSITION_LOCK]).catch(() => undefined);
    }
    client.release();
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "MAINTENANCE_ENABLE_FAILED");
  process.exitCode = 1;
});
