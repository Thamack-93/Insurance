import { Pool, type PoolClient } from "pg";

export type RestoreApplicationReadCheck = {
  name: string;
  ok: boolean;
  count?: number;
  detail?: "connection_failed" | "query_failed" | "missing_user" | "missing_active_user";
};

export type RestoreApplicationReadResult = {
  ok: boolean;
  checks: RestoreApplicationReadCheck[];
  counts: Record<string, number>;
};

export function evaluateRestoreApplicationReadChecks(checks: RestoreApplicationReadCheck[], counts: Record<string, number> = {}): RestoreApplicationReadResult {
  return { ok: checks.length > 0 && checks.every((check) => check.ok), checks, counts };
}

const TABLE_CHECKS = [
  ["client_table_readable", "Client"],
  ["policy_table_readable", "Policy"],
  ["receipt_table_readable", "Receipt"],
  ["payment_table_readable", "Payment"],
  ["workitem_table_readable", "WorkItem"],
  ["claim_table_readable", "Claim"],
  ["commission_table_readable", "Commission"],
  ["activitylog_table_readable", "ActivityLog"],
  ["notificationchannel_table_readable", "NotificationChannel"],
  ["notificationpreference_table_readable", "NotificationPreference"],
  ["notificationevent_table_readable", "NotificationEvent"],
] as const;

function requiredCheckNames() {
  return [
    "database_connection",
    "user_exists",
    "active_user_exists",
    ...TABLE_CHECKS.map(([name]) => name),
    "latest_activity_log",
    "notification_configuration",
  ];
}

export async function runRestoreApplicationReads(targetDatabaseUrl: string): Promise<RestoreApplicationReadResult> {
  const checks = new Map<string, RestoreApplicationReadCheck>(
    requiredCheckNames().map((name) => [name, { name, ok: false, detail: "connection_failed" }]),
  );
  const counts: Record<string, number> = {};
  const pool = new Pool({
    connectionString: targetDatabaseUrl,
    max: 1,
    application_name: "policydesk-restore-drill-smoke",
  });

  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("SELECT 1");
    checks.set("database_connection", { name: "database_connection", ok: true });

    const countTable = async (table: string) => {
      const result = await client!.query<{ count: string }>(`SELECT count(*)::text AS count FROM "${table}"`);
      const value = Number(result.rows[0]?.count ?? "0");
      if (!Number.isSafeInteger(value)) throw new Error("invalid_count");
      counts[table] = value;
      return value;
    };

    try {
      const users = await countTable("User");
      checks.set("user_exists", { name: "user_exists", ok: users > 0, count: users, ...(users > 0 ? {} : { detail: "missing_user" }) });
      const activeUsers = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "User" WHERE active = true`);
      const activeCount = Number(activeUsers.rows[0]?.count ?? "0");
      counts.activeUser = activeCount;
      checks.set("active_user_exists", { name: "active_user_exists", ok: activeCount > 0, count: activeCount, ...(activeCount > 0 ? {} : { detail: "missing_active_user" }) });
    } catch {
      checks.set("user_exists", { name: "user_exists", ok: false, detail: "query_failed" });
      checks.set("active_user_exists", { name: "active_user_exists", ok: false, detail: "query_failed" });
    }

    for (const [name, table] of TABLE_CHECKS) {
      try {
        const value = await countTable(table);
        checks.set(name, { name, ok: true, count: value });
      } catch {
        checks.set(name, { name, ok: false, detail: "query_failed" });
      }
    }

    try {
      const latestActivity = await client.query(`SELECT id FROM "ActivityLog" ORDER BY "createdAt" DESC LIMIT 1`);
      counts.latestActivityLog = latestActivity.rowCount ?? 0;
      checks.set("latest_activity_log", { name: "latest_activity_log", ok: true, count: counts.latestActivityLog });
    } catch {
      checks.set("latest_activity_log", { name: "latest_activity_log", ok: false, detail: "query_failed" });
    }

    try {
      const notificationConfiguration = await client.query<{ count: string }>(`
        SELECT (
          (SELECT count(*) FROM "NotificationChannel") +
          (SELECT count(*) FROM "NotificationPreference") +
          (SELECT count(*) FROM "NotificationEvent")
        )::text AS count`);
      counts.notificationConfiguration = Number(notificationConfiguration.rows[0]?.count ?? "0");
      checks.set("notification_configuration", {
        name: "notification_configuration",
        ok: Number.isSafeInteger(counts.notificationConfiguration),
        count: counts.notificationConfiguration,
      });
    } catch {
      checks.set("notification_configuration", { name: "notification_configuration", ok: false, detail: "query_failed" });
    }
  } catch {
    checks.set("database_connection", { name: "database_connection", ok: false, detail: "connection_failed" });
  } finally {
    client?.release();
    await pool.end().catch(() => undefined);
  }

  return evaluateRestoreApplicationReadChecks([...checks.values()], counts);
}
