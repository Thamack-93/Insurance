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
  triggerMode: "session_replication_role" | "neon_user_trigger_fallback";
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

function isNeonTarget(targetDatabaseUrl: string) {
  try {
    return new URL(targetDatabaseUrl).hostname.endsWith(".neon.tech");
  } catch {
    return false;
  }
}

async function disableUserTriggersForRestore(client: PoolClient, tables: BackupTableRecord[]) {
  const tableRefs = tables
    .filter((table) => !RESTORE_SKIPPED_TABLES.has(table.name))
    .map((table) => tableReference(table.schema, table.name));
  if (tableRefs.length === 0) return;

  const nonNormal = await client.query<{ table_name: string; trigger_name: string; tgenabled: string }>(
    `SELECT c.relname AS table_name, t.tgname AS trigger_name, t.tgenabled
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgenabled <> 'O'
      ORDER BY c.relname, t.tgname`,
  );
  if ((nonNormal.rowCount ?? 0) > 0) {
    throw new RestoreStageError(
      "preflight",
      "El target tiene triggers de usuario fuera del estado normal.",
      undefined,
      "TARGET_NOT_AUTHORIZED",
    );
  }

  for (const tableRef of tableRefs) await client.query(`ALTER TABLE ${tableRef} DISABLE TRIGGER USER`);
  // The backup contains exact trigger-managed values. Deferring constraints, where
  // supported, keeps the insert order independent without weakening non-deferrable FKs.
  await client.query("SET CONSTRAINTS ALL DEFERRED");
}

async function restoreUserTriggersAfterRestore(client: PoolClient, tables: BackupTableRecord[]) {
  const tableRefs = tables
    .filter((table) => !RESTORE_SKIPPED_TABLES.has(table.name))
    .map((table) => tableReference(table.schema, table.name));
  for (const tableRef of tableRefs) await client.query(`ALTER TABLE ${tableRef} ENABLE TRIGGER USER`);
}

const NEON_FALLBACK_CYCLIC_FKS = [
  { table: "Document", constraint: "Document_endorsementId_fkey", column: '"endorsementId"', parent: '"PolicyEndorsement"' },
  { table: "Document", constraint: "Document_receiptId_fkey", column: '"receiptId"', parent: '"Receipt"' },
  { table: "Document", constraint: "Document_taskId_fkey", column: '"taskId"', parent: '"Task"' },
  { table: "AssistantReport", constraint: "AssistantReport_parentReportId_fkey", column: '"parentReportId"', parent: '"AssistantReport"' },
  { table: "Client", constraint: "Client_referidorId_fkey", column: '"referidorId"', parent: '"Client"' },
  { table: "LedgerImportIssue", constraint: "LedgerImportIssue_duplicateOfId_fkey", column: '"duplicateOfId"', parent: '"LedgerImportIssue"' },
  { table: "Policy", constraint: "Policy_renewedFromPolicyId_fkey", column: '"renewedFromPolicyId"', parent: '"Policy"' },
  { table: "Policy", constraint: "Policy_familyRootId_fkey", column: '"familyRootId"', parent: '"Policy"' },
  { table: "PolicyRenewalSuggestion", constraint: "PolicyRenewalSuggestion_duplicateOfId_fkey", column: '"duplicateOfId"', parent: '"PolicyRenewalSuggestion"' },
  { table: "ReceiptReconciliationIssue", constraint: "ReceiptReconciliationIssue_duplicateOfId_fkey", column: '"duplicateOfId"', parent: '"ReceiptReconciliationIssue"' },
] as const;

async function dropNeonFallbackCyclicForeignKey(client: PoolClient, tables: BackupTableRecord[]) {
  if (!tables.some((table) => table.schema === "public" && table.name === "Document")) return [];
  const dropped: Array<{ table: string; constraint: string; definition: string }> = [];
  for (const expected of NEON_FALLBACK_CYCLIC_FKS) {
    const result = await client.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(con.oid) AS definition
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE conname = $1 AND n.nspname = 'public' AND c.relname = $2 AND contype = 'f'`,
      [expected.constraint, expected.table],
    );
    const definition = result.rows[0]?.definition;
    if (!definition || !definition.includes(expected.column) || !definition.includes(expected.parent)) {
      throw new RestoreStageError(
        "preflight",
        "Las FKs cíclicas esperadas del target no coinciden con el inventario de restore.",
        undefined,
        "TARGET_NOT_AUTHORIZED",
      );
    }
    await client.query(
      `ALTER TABLE ${tableReference("public", expected.table)} DROP CONSTRAINT ${quoteIdentifier(expected.constraint)}`,
    );
    dropped.push({ table: expected.table, constraint: expected.constraint, definition });
  }
  return dropped;
}

async function restoreNeonFallbackCyclicForeignKey(client: PoolClient, definitions: Array<{ table: string; constraint: string; definition: string }>) {
  for (const item of definitions) {
    await client.query(
      `ALTER TABLE ${tableReference("public", item.table)} ADD CONSTRAINT ${quoteIdentifier(item.constraint)} ${item.definition}`,
    );
  }
}

async function orderTablesForRestore(client: PoolClient, tables: BackupTableRecord[]) {
  const keys = new Set(tables.map((table) => `${table.schema}.${table.name}`));
  const byKey = new Map(tables.map((table) => [`${table.schema}.${table.name}`, table]));
  const originalIndex = new Map(tables.map((table, index) => [`${table.schema}.${table.name}`, index]));
  const dependencies = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  for (const key of keys) {
    dependencies.set(key, new Set());
    dependents.set(key, new Set());
  }
  const foreignKeys = await client.query<{ child_schema: string; child_table: string; parent_schema: string; parent_table: string }>(
    `SELECT child_ns.nspname AS child_schema, child.relname AS child_table,
            parent_ns.nspname AS parent_schema, parent.relname AS parent_table
       FROM pg_constraint con
       JOIN pg_class child ON child.oid = con.conrelid
       JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
       JOIN pg_class parent ON parent.oid = con.confrelid
       JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
      WHERE con.contype = 'f' AND child_ns.nspname = 'public' AND parent_ns.nspname = 'public'`,
  );
  for (const fk of foreignKeys.rows) {
    const child = `${fk.child_schema}.${fk.child_table}`;
    const parent = `${fk.parent_schema}.${fk.parent_table}`;
    if (!keys.has(child) || !keys.has(parent) || child === parent) continue;
    dependencies.get(child)?.add(parent);
    dependents.get(parent)?.add(child);
  }
  const available = [...keys].filter((key) => dependencies.get(key)?.size === 0)
    .sort((left, right) => (originalIndex.get(left) ?? 0) - (originalIndex.get(right) ?? 0));
  const orderedKeys: string[] = [];
  while (available.length > 0) {
    const key = available.shift()!;
    orderedKeys.push(key);
    for (const dependent of dependents.get(key) ?? []) {
      const remaining = dependencies.get(dependent);
      remaining?.delete(key);
      if (remaining?.size === 0) {
        available.push(dependent);
        available.sort((left, right) => (originalIndex.get(left) ?? 0) - (originalIndex.get(right) ?? 0));
      }
    }
  }
  if (orderedKeys.length !== keys.size) {
    throw new RestoreStageError(
      "insertion",
      "El grafo de relaciones del target contiene un ciclo no restaurable sin triggers de replicación.",
      undefined,
      "INSERTION_FAILED",
    );
  }
  return orderedKeys.map((key) => byKey.get(key)!);
}

async function beginRestoreTransaction(
  client: PoolClient,
  parsed: { tables: Map<string, BackupTableRecord> },
  targetDatabaseUrl: string,
  advisoryLockKey: string,
) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [advisoryLockKey]);
    await client.query("SET LOCAL session_replication_role = replica");
    return "session_replication_role" as const;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const enabled = process.env.ALLOW_NEON_USER_TRIGGER_FALLBACK === "1";
    const isReplicationPermissionFailure = error instanceof Error
      && (error as { code?: string }).code === "42501"
      && error.message.includes("session_replication_role");
    if (!enabled || !isNeonTarget(targetDatabaseUrl) || !isReplicationPermissionFailure) throw error;
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [advisoryLockKey]);
      await disableUserTriggersForRestore(client, [...parsed.tables.values()]);
      return "neon_user_trigger_fallback" as const;
    } catch (fallbackError) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw fallbackError;
    }
  }
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
    const triggerMode = await beginRestoreTransaction(
      client,
      parsed,
      input.targetDatabaseUrl,
      input.advisoryLockKey ?? "policydesk-backup-restore",
    );
    transactionStarted = true;
    const droppedCyclicForeignKeys = triggerMode === "neon_user_trigger_fallback"
      ? await dropNeonFallbackCyclicForeignKey(client, [...parsed.tables.values()])
      : [];

    const restorableTables = [...parsed.tables.values()].filter((table) => !RESTORE_SKIPPED_TABLES.has(table.name));
    const orderedTables = triggerMode === "neon_user_trigger_fallback"
      ? await orderTablesForRestore(client, restorableTables)
      : restorableTables;
    if (restorableTables.length > 0) {
      await client.query(
        `TRUNCATE ${restorableTables.map((table) => tableReference(table.schema, table.name)).join(", ")} RESTART IDENTITY CASCADE`,
      );
    }
    for (const table of orderedTables) {
      await restoreTable(client, table, parsed.rows.get(`${table.schema}.${table.name}`) ?? []);
    }
    if (triggerMode === "neon_user_trigger_fallback") {
      await restoreNeonFallbackCyclicForeignKey(client, droppedCyclicForeignKeys);
      await restoreUserTriggersAfterRestore(client, [...parsed.tables.values()]);
    } else {
      await client.query("SET LOCAL session_replication_role = origin");
    }

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
      triggerMode,
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
