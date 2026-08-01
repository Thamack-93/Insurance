import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Pool, type PoolClient } from "pg";
import type { BackupManifest } from "@/lib/backup-logic";
import type { RestoreFailureCode } from "@/lib/backup-restore-errors";
import {
  parseBackupRecords,
  quoteIdentifier,
  RESTORE_SKIPPED_TABLES,
  RestoreIntegrityError,
  synchronizeSequences,
  tableReference,
  validateDomainInvariants,
  validateForeignKeys,
  validateRestoreSchema,
  validateTableCounts,
  type SequenceSyncResult,
  type BackupTableRecord,
} from "@/lib/backup-restore-validation";

const execFileAsync = promisify(execFile);

export type RestoreStage = "preflight" | "backup-verification" | "insertion" | "integrity" | "post-commit-smoke";

export class RestoreStageError extends Error {
  constructor(
    readonly stage: RestoreStage,
    message: string,
    readonly cause?: unknown,
    readonly code: RestoreFailureCode = "UNKNOWN",
  ) {
    super(message);
    this.name = "RestoreStageError";
  }
}

export type RestoreInput = {
  targetDatabaseUrl: string;
  plaintext: Buffer;
  manifest: BackupManifest;
  advisoryLockKey?: string;
};

export type RestoreResult = {
  targetFingerprint: string;
  tableCounts: Awaited<ReturnType<typeof validateTableCounts>>;
  foreignKeys: Awaited<ReturnType<typeof validateForeignKeys>>;
  domainChecks: Awaited<ReturnType<typeof validateDomainInvariants>>;
  sequences: SequenceSyncResult[];
};

function restoreValue(value: unknown, postgresType: string) {
  if (
    postgresType === "bytea" &&
    value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "Buffer" &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    return Buffer.from((value as { data: number[] }).data);
  }
  return value;
}

function getSafeTargetFingerprint(targetDatabaseUrl: string) {
  try {
    const target = new URL(targetDatabaseUrl);
    return createHash("sha256")
      .update(`${target.protocol}//${target.hostname}:${target.port || "default"}${target.pathname}`)
      .digest("hex")
      .slice(0, 16);
  } catch {
    return "invalid-target";
  }
}

async function restoreTable(client: PoolClient, table: BackupTableRecord, records: Array<{ data: Record<string, unknown> }>) {
  if (RESTORE_SKIPPED_TABLES.has(table.name) || records.length === 0) return 0;
  const columns = table.columns.map((column) => column.name);
  const columnTypes = new Map(table.columns.map((column) => [column.name, column.postgresType]));
  let restored = 0;
  for (const record of records) {
    const values = columns.map((column) => restoreValue(record.data[column], columnTypes.get(column) ?? ""));
    const placeholders = values.map((_value, index) => `$${index + 1}`).join(", ");
    await client.query(
      `INSERT INTO ${tableReference(table.schema, table.name)} (${columns.map(quoteIdentifier).join(", ")}) VALUES (${placeholders})`,
      values,
    );
    restored += 1;
  }
  return restored;
}

async function assertTargetIsPostgres(client: PoolClient) {
  const result = await client.query<{ version: string }>("SELECT version() AS version");
  const version = result.rows[0]?.version ?? "";
  if (!/^PostgreSQL\s/i.test(version)) throw new RestoreStageError("preflight", "El target no es PostgreSQL.", undefined, "TARGET_NOT_AUTHORIZED");
}

function migrationEnvironment(targetDatabaseUrl: string) {
  return {
    PATH: process.env.PATH ?? "",
    DATABASE_URL: targetDatabaseUrl,
    DATABASE_URL_UNPOOLED: "",
    NODE_ENV: process.env.NODE_ENV ?? "test",
  };
}

export async function applyCurrentMigrations(targetDatabaseUrl: string) {
  try {
    await execFileAsync("npx", ["prisma", "migrate", "deploy"], {
      cwd: process.cwd(),
      env: migrationEnvironment(targetDatabaseUrl),
      maxBuffer: 4 * 1024 * 1024,
    });
    return { ok: true as const, command: "prisma migrate deploy" };
  } catch (error) {
    throw new RestoreStageError("preflight", "No se pudieron aplicar las migraciones actuales al target.", error, "UNKNOWN");
  }
}

export async function checkRestoreTargetConnection(targetDatabaseUrl: string) {
  if (!/^postgres(ql)?:\/\//i.test(targetDatabaseUrl)) {
    throw new RestoreStageError("preflight", "RESTORE_DATABASE_URL debe apuntar a PostgreSQL.", undefined, "TARGET_NOT_AUTHORIZED");
  }
  const pool = new Pool({ connectionString: targetDatabaseUrl, max: 1, application_name: "policydesk-restore-preflight" });
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("SELECT 1");
    await assertTargetIsPostgres(client);
    return { ok: true as const, database: "postgresql" as const };
  } catch (error) {
    if (error instanceof RestoreStageError) throw error;
    throw new RestoreStageError("preflight", "No se pudo conectar al target de restore.", error, "TARGET_NOT_AUTHORIZED");
  } finally {
    client?.release();
    await pool.end().catch(() => undefined);
  }
}

export async function checkTargetMigrationDrift(targetDatabaseUrl: string) {
  try {
    await execFileAsync("npm", ["run", "db:check-drift"], {
      cwd: process.cwd(),
      env: migrationEnvironment(targetDatabaseUrl),
      maxBuffer: 4 * 1024 * 1024,
    });
    return { ok: true as const, command: "npm run db:check-drift" };
  } catch (error) {
    throw new RestoreStageError("post-commit-smoke", "El target presenta drift de Prisma.", error, "PRISMA_DRIFT_FAILED");
  }
}

export async function restoreVerifiedBackup(input: RestoreInput): Promise<RestoreResult> {
  if (!/^postgres(ql)?:\/\//i.test(input.targetDatabaseUrl)) {
    throw new RestoreStageError("preflight", "RESTORE_DATABASE_URL debe apuntar a PostgreSQL.", undefined, "TARGET_NOT_AUTHORIZED");
  }
  let parsed: ReturnType<typeof parseBackupRecords>;
  try {
    parsed = parseBackupRecords(input.plaintext);
  } catch (error) {
    if (error instanceof RestoreStageError) throw error;
    throw new RestoreStageError("backup-verification", "El contenido del backup no tiene un formato NDJSON válido.", error, "BACKUP_VERIFICATION_FAILED");
  }
  const pool = new Pool({
    connectionString: input.targetDatabaseUrl,
    max: 1,
    application_name: "policydesk-restore-drill",
  });
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw new RestoreStageError("preflight", "No se pudo conectar al target de restore.", error, "TARGET_NOT_AUTHORIZED");
  }
  let transactionStarted = false;
  try {
    await assertTargetIsPostgres(client);
    await validateRestoreSchema(client, parsed);
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.advisoryLockKey ?? "policydesk-backup-restore"]);
    await client.query("SET LOCAL session_replication_role = replica");

    const restorableTables = [...parsed.tables.values()].filter((table) => !RESTORE_SKIPPED_TABLES.has(table.name));
    if (restorableTables.length > 0) {
      await client.query(
        `TRUNCATE ${restorableTables.map((table) => tableReference(table.schema, table.name)).join(", ")} RESTART IDENTITY CASCADE`,
      );
    }
    for (const table of parsed.tables.values()) {
      await restoreTable(client, table, parsed.rows.get(`${table.schema}.${table.name}`) ?? []);
    }
    await client.query("SET LOCAL session_replication_role = origin");

    const tableCounts = await validateTableCounts(
      client,
      parsed,
      input.manifest.tables,
      input.manifest.totals.rows,
    );
    const foreignKeys = await validateForeignKeys(client);
    const domainChecks = await validateDomainInvariants(client);
    const sequences = await synchronizeSequences(client);
    await client.query("COMMIT");
    transactionStarted = false;
    return {
      targetFingerprint: getSafeTargetFingerprint(input.targetDatabaseUrl),
      tableCounts,
      foreignKeys,
      domainChecks,
      sequences,
    };
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof RestoreStageError) throw error;
    if (error instanceof RestoreIntegrityError) throw new RestoreStageError("integrity", error.message, error, error.code);
    throw new RestoreStageError(
      transactionStarted ? "insertion" : "preflight",
      error instanceof Error ? error.message : "Falló la restauración.",
      error,
      transactionStarted ? "INSERTION_FAILED" : "UNKNOWN",
    );
  } finally {
    client.release();
    await pool.end().catch(() => undefined);
  }
}
