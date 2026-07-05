import { getBackupDownload, verifyStoredBackup } from "../src/lib/backup.ts";
import {
  decryptBackupPayload,
  parseBackupContainerHeader,
  parseBackupEncryptionKey,
} from "../src/lib/backup-logic.ts";
import { assertTemporaryNeonRestoreTarget } from "../src/lib/backup-restore-guards.ts";
import { Pool, type PoolClient } from "pg";

type TableRecord = {
  type: "table";
  schema: string;
  name: string;
  columns: Array<{ name: string; postgresType: string }>;
};

type RowRecord = {
  type: "row";
  schema: string;
  table: string;
  data: Record<string, unknown>;
};

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function tableReference(schema: string, table: string) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

async function readStream(stream: ReadableStream<Uint8Array>) {
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function getEncryptionKey(keyVersion: string) {
  const activeVersion = process.env.BACKUP_ENCRYPTION_KEY_VERSION?.trim();
  const versionedName = `BACKUP_ENCRYPTION_KEY_${keyVersion.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
  const value =
    activeVersion === keyVersion
      ? process.env.BACKUP_ENCRYPTION_KEY
      : process.env[versionedName];
  if (!value?.trim()) {
    throw new Error(`No existe una clave para la versión ${keyVersion}. Configura ${versionedName}.`);
  }
  return parseBackupEncryptionKey(value);
}

function parseRecords(plaintext: Buffer) {
  const tables = new Map<string, TableRecord>();
  const rows = new Map<string, RowRecord[]>();
  for (const line of plaintext.toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    const record = JSON.parse(line) as TableRecord | RowRecord | { type: string };
    if (record.type === "table") {
      const table = record as TableRecord;
      const key = `${table.schema}.${table.name}`;
      tables.set(key, table);
      rows.set(key, []);
    } else if (record.type === "row") {
      const row = record as RowRecord;
      rows.get(`${row.schema}.${row.table}`)?.push(row);
    }
  }
  return { tables, rows };
}

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

async function restoreTable(
  client: PoolClient,
  table: TableRecord,
  records: RowRecord[],
) {
  if (table.name === "_prisma_migrations" || records.length === 0) return 0;
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

async function main() {
  const filename = process.argv[2]?.trim();
  if (!filename) {
    throw new Error("Uso: npm run restore:backup:temp-neon -- <archivo.ndjson.gz.enc>");
  }
  const target = assertTemporaryNeonRestoreTarget({
    sourceDatabaseUrl: process.env.DATABASE_URL,
    targetDatabaseUrl: process.env.RESTORE_DATABASE_URL,
    branchName: process.env.RESTORE_NEON_BRANCH,
    allowRestore: process.env.ALLOW_TEMPORARY_NEON_RESTORE,
  });
  const verification = await verifyStoredBackup(filename);
  if (!verification.valid) throw new Error(`Backup inválido: ${verification.reason}`);
  const download = await getBackupDownload(filename);
  if (download?.statusCode !== 200 || !download.stream) throw new Error("No se encontró el backup privado.");
  const container = await readStream(download.stream);
  const header = parseBackupContainerHeader(container).header;
  if (header.keyVersion !== verification.manifest.encryption.keyVersion) {
    throw new Error("La versión de clave no coincide con el manifiesto.");
  }
  const plaintext = decryptBackupPayload(container, getEncryptionKey(header.keyVersion)).plaintext;
  const { tables, rows } = parseRecords(plaintext);
  const restorableTables = [...tables.values()].filter((table) => table.name !== "_prisma_migrations");

  const pool = new Pool({ connectionString: target.target.toString(), max: 1, application_name: "policydesk-restore" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('policydesk-backup-restore'))");
    await client.query("SET LOCAL session_replication_role = replica");
    if (restorableTables.length > 0) {
      await client.query(`TRUNCATE ${restorableTables.map((table) => tableReference(table.schema, table.name)).join(", ")} CASCADE`);
    }
    let restoredRows = 0;
    for (const table of restorableTables) {
      restoredRows += await restoreTable(client, table, rows.get(`${table.schema}.${table.name}`) ?? []);
    }
    await client.query("SET LOCAL session_replication_role = origin");
    await client.query("COMMIT");
    console.log(`Restauración completada en ${target.branchName}: ${restoredRows} filas.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
