import "server-only";

import { Pool, type PoolClient } from "pg";
import { logError } from "@/lib/logger";
import { getDirectDatabaseUrl } from "@/lib/db";

export type PostgresAdvisoryLock = {
  acquired: boolean;
  backend: "postgres" | "unavailable";
  release: () => Promise<void>;
};

function getPostgresConnectionString() {
  try {
    const connectionString = getDirectDatabaseUrl();
    return /^postgres(ql)?:\/\//i.test(connectionString) ? connectionString : null;
  } catch {
    return null;
  }
}

export async function acquirePostgresAdvisoryLock(key: string): Promise<PostgresAdvisoryLock> {
  const connectionString = getPostgresConnectionString();
  if (!connectionString) {
    return { acquired: false, backend: "unavailable", release: async () => {} };
  }

  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000 });
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
      [key],
    );
    if (result.rows[0]?.acquired !== true) {
      client.release();
      client = null;
      await pool.end();
      return { acquired: false, backend: "postgres", release: async () => {} };
    }

    let released = false;
    return {
      acquired: true,
      backend: "postgres",
      release: async () => {
        if (released) return;
        released = true;
        try {
          await client?.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [key]);
        } catch (error) {
          logError("postgres-advisory-lock.release", error, { key });
        } finally {
          client?.release();
          client = null;
          await pool.end().catch((error) => logError("postgres-advisory-lock.close", error, { key }));
        }
      },
    };
  } catch (error) {
    logError("postgres-advisory-lock.acquire", error, { key });
    client?.release();
    await pool.end().catch(() => undefined);
    return { acquired: false, backend: "unavailable", release: async () => {} };
  }
}
