import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import { del, get, list, put } from "@vercel/blob";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import {
  BACKUP_AUTH_TAG_BYTES,
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  canonicalJson,
  createBackupContainerHeader,
  createBackupManifest,
  parseBackupEncryptionKey,
  selectBackupRetention,
  verifyBackupManifest,
  type BackupManifest,
} from "@/lib/backup-logic";

const BACKUP_PREFIX = "database-backups/";
const BACKUP_EXTENSION = ".ndjson.gz.enc";
const MANIFEST_SUFFIX = ".manifest.json";
const EXPORT_BATCH_SIZE = 500;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const BACKUP_FILENAME_PATTERN =
  /^policydesk-\d{8}T\d{9}Z-[a-f0-9]{12}-kv-[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.ndjson\.gz\.enc$/;

type TableDescription = {
  schema: string;
  name: string;
  columns: Array<{
    name: string;
    dataType: string;
    postgresType: string;
    nullable: boolean;
  }>;
  primaryKey: string[];
};

type ExportStats = {
  tables: Array<{ schema: string; name: string; rowCount: number }>;
  totalRows: number;
};

export type BackupEntry = {
  filename: string;
  pathname: string;
  size: number;
  createdAt: Date;
  manifestAvailable: boolean;
};

export type CreatedBackup = BackupEntry & {
  manifest: BackupManifest;
  pruned: string[];
};

export type BackupPreflightCheck = {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
};

export type BackupPreflightStatus = {
  ready: boolean;
  checks: BackupPreflightCheck[];
};

export type BackupVerification =
  | {
      valid: true;
      filename: string;
      size: number;
      sha256: string;
      manifest: BackupManifest;
    }
  | { valid: false; filename: string; reason: string };

function requireEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for database backups.`);
  return value;
}

function buildBackupPreflightCheck(
  key: string,
  label: string,
  detail: string,
  ok: boolean,
): BackupPreflightCheck {
  return { key, label, detail, ok };
}

export function getBackupPreflightStatus(): BackupPreflightStatus {
  const checks: BackupPreflightCheck[] = [];

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  checks.push(
    buildBackupPreflightCheck(
      "blob",
      "Vercel Blob",
      blobToken ? "Token privado detectado." : "Falta BLOB_READ_WRITE_TOKEN para escribir el respaldo privado.",
      Boolean(blobToken),
    ),
  );

  const databaseUrl = process.env.DATABASE_URL?.trim();
  checks.push(
    buildBackupPreflightCheck(
      "database",
      "Postgres",
      databaseUrl && /^postgres(ql)?:\/\//i.test(databaseUrl)
        ? "DATABASE_URL apunta a Postgres."
        : "DATABASE_URL debe apuntar a Postgres hosted.",
      Boolean(databaseUrl && /^postgres(ql)?:\/\//i.test(databaseUrl)),
    ),
  );

  const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY?.trim();
  let encryptionKeyOk = false;
  let encryptionKeyDetail = "Falta BACKUP_ENCRYPTION_KEY.";
  if (encryptionKey) {
    try {
      parseBackupEncryptionKey(encryptionKey);
      encryptionKeyOk = true;
      encryptionKeyDetail = "Clave de cifrado válida.";
    } catch (error) {
      encryptionKeyDetail = error instanceof Error ? error.message : "BACKUP_ENCRYPTION_KEY inválida.";
    }
  }
  checks.push(buildBackupPreflightCheck("encryption-key", "Clave de cifrado", encryptionKeyDetail, encryptionKeyOk));

  const encryptionVersion = process.env.BACKUP_ENCRYPTION_KEY_VERSION?.trim();
  checks.push(
    buildBackupPreflightCheck(
      "encryption-version",
      "Versión de clave",
      encryptionVersion ? `Versión activa: ${encryptionVersion}.` : "Falta BACKUP_ENCRYPTION_KEY_VERSION.",
      Boolean(encryptionVersion),
    ),
  );

  return {
    ready: checks.every((check) => check.ok),
    checks,
  };
}

export function formatBackupPreflightError(status: BackupPreflightStatus) {
  const missing = status.checks.filter((check) => !check.ok);
  if (missing.length === 0) return "La configuración de backup está lista.";
  return `Faltan validaciones de backup: ${missing.map((check) => `${check.label} (${check.detail})`).join(" · ")}`;
}

function getEncryptionConfiguration() {
  return {
    key: parseBackupEncryptionKey(requireEnvironment("BACKUP_ENCRYPTION_KEY")),
    keyVersion: requireEnvironment("BACKUP_ENCRYPTION_KEY_VERSION"),
  };
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function tableReference(table: Pick<TableDescription, "schema" | "name">) {
  return `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`;
}

function jsonLine(value: unknown) {
  return Buffer.from(
    `${JSON.stringify(value, (_key, entry) =>
      typeof entry === "bigint" ? entry.toString() : entry)}\n`,
    "utf8",
  );
}

async function describeTables(client: PoolClient): Promise<TableDescription[]> {
  const tables = await client.query<{ table_schema: string; table_name: string }>(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_schema, table_name
  `);

  const descriptions: TableDescription[] = [];
  for (const table of tables.rows) {
    const [columns, primaryKey] = await Promise.all([
      client.query<{
        column_name: string;
        data_type: string;
        udt_name: string;
        is_nullable: "YES" | "NO";
      }>(
        `SELECT column_name, data_type, udt_name, is_nullable
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        [table.table_schema, table.table_name],
      ),
      client.query<{ column_name: string }>(
        `SELECT attribute.attname AS column_name
         FROM pg_index index_definition
         JOIN pg_class relation ON relation.oid = index_definition.indrelid
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         JOIN LATERAL unnest(index_definition.indkey) WITH ORDINALITY AS key(attnum, position)
           ON true
         JOIN pg_attribute attribute
           ON attribute.attrelid = relation.oid AND attribute.attnum = key.attnum
         WHERE namespace.nspname = $1
           AND relation.relname = $2
           AND index_definition.indisprimary
         ORDER BY key.position`,
        [table.table_schema, table.table_name],
      ),
    ]);
    descriptions.push({
      schema: table.table_schema,
      name: table.table_name,
      columns: columns.rows.map((column) => ({
        name: column.column_name,
        dataType: column.data_type,
        postgresType: column.udt_name,
        nullable: column.is_nullable === "YES",
      })),
      primaryKey: primaryKey.rows.map((column) => column.column_name),
    });
  }
  return descriptions;
}

async function* exportPostgresSnapshot(createdAt: Date, stats: ExportStats) {
  const connectionString = requireEnvironment("DATABASE_URL");
  if (!/^postgres(ql)?:\/\//i.test(connectionString)) {
    throw new Error("DATABASE_URL must point to Postgres for database backups.");
  }

  const pool = new Pool({
    connectionString,
    max: 1,
    application_name: "policydesk-backup",
  });
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionStarted = true;
    const versionResult = await client.query<{ server_version: string }>("SHOW server_version");
    const tables = await describeTables(client);

    yield jsonLine({
      type: "backup",
      format: BACKUP_FORMAT,
      version: BACKUP_FORMAT_VERSION,
      createdAt: createdAt.toISOString(),
      database: {
        engine: "postgresql",
        serverVersion: versionResult.rows[0]?.server_version ?? "unknown",
      },
      tableCount: tables.length,
    });

    for (const table of tables) {
      yield jsonLine({ type: "table", ...table });
      const orderBy = table.primaryKey.length
        ? table.primaryKey.map(quoteIdentifier).join(", ")
        : "ctid";
      await client.query(
        `DECLARE backup_rows NO SCROLL CURSOR FOR SELECT * FROM ${tableReference(table)} ORDER BY ${orderBy}`,
      );
      let rowCount = 0;
      try {
        while (true) {
          const batch = await client.query<QueryResultRow>(
            `FETCH FORWARD ${EXPORT_BATCH_SIZE} FROM backup_rows`,
          );
          if (batch.rows.length === 0) break;
          for (const row of batch.rows) {
            yield jsonLine({
              type: "row",
              schema: table.schema,
              table: table.name,
              data: row,
            });
            rowCount += 1;
          }
        }
      } finally {
        await client.query("CLOSE backup_rows").catch(() => undefined);
      }
      stats.tables.push({ schema: table.schema, name: table.name, rowCount });
      stats.totalRows += rowCount;
      yield jsonLine({
        type: "table_end",
        schema: table.schema,
        table: table.name,
        rowCount,
      });
    }

    yield jsonLine({
      type: "end",
      tableCount: stats.tables.length,
      rowCount: stats.totalRows,
    });
  } finally {
    if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end().catch(() => undefined);
  }
}

function compactTimestamp(date: Date) {
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(".", "");
}

function assertSafeBackupFilename(filename: string) {
  if (!BACKUP_FILENAME_PATTERN.test(filename)) throw new Error("Invalid backup filename.");
  return filename;
}

async function* encryptedBackupStream(
  createdAt: Date,
  key: Buffer,
  keyVersion: string,
  iv: Buffer,
  stats: ExportStats,
  onChunk: (chunk: Buffer) => void,
) {
  const { prefix, authenticatedData } = createBackupContainerHeader(keyVersion, iv);
  onChunk(prefix);
  yield prefix;

  const cipher = createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: BACKUP_AUTH_TAG_BYTES,
  });
  cipher.setAAD(authenticatedData);
  const compressed = Readable.from(exportPostgresSnapshot(createdAt, stats)).pipe(
    createGzip({ level: 9 }),
  );
  for await (const value of compressed) {
    const encrypted = cipher.update(Buffer.isBuffer(value) ? value : Buffer.from(value));
    if (encrypted.length > 0) {
      onChunk(encrypted);
      yield encrypted;
    }
  }
  const final = cipher.final();
  if (final.length > 0) {
    onChunk(final);
    yield final;
  }
  const authTag = cipher.getAuthTag();
  onChunk(authTag);
  yield authTag;
}

async function listAllBackupBlobs() {
  const blobs: Awaited<ReturnType<typeof list>>["blobs"] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: BACKUP_PREFIX, limit: 1000, cursor });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

export async function listBackups(): Promise<BackupEntry[]> {
  const blobs = await listAllBackupBlobs();
  const pathnames = new Set(blobs.map((blob) => blob.pathname));
  return blobs
    .filter((blob) => blob.pathname.endsWith(BACKUP_EXTENSION))
    .map((blob) => {
      const filename = blob.pathname.slice(BACKUP_PREFIX.length);
      if (!BACKUP_FILENAME_PATTERN.test(filename)) return null;
      return {
        filename,
        pathname: blob.pathname,
        size: blob.size,
        createdAt: blob.uploadedAt,
        manifestAvailable: pathnames.has(`${blob.pathname}${MANIFEST_SUFFIX}`),
      } satisfies BackupEntry;
    })
    .filter((entry): entry is BackupEntry => entry !== null)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
}

export async function rotateBackups() {
  const entries = await listBackups();
  const selection = selectBackupRetention(
    entries.map((entry) => ({ ...entry, id: entry.pathname })),
  );
  if (selection.remove.length === 0) return [];
  await del(
    selection.remove.flatMap((entry) => [entry.pathname, `${entry.pathname}${MANIFEST_SUFFIX}`]),
  );
  return selection.remove.map((entry) => entry.filename);
}

export async function createDatabaseBackup(now = new Date()): Promise<CreatedBackup> {
  const preflight = getBackupPreflightStatus();
  if (!preflight.ready) {
    throw new Error(formatBackupPreflightError(preflight));
  }
  const { key, keyVersion } = getEncryptionConfiguration();
  const iv = randomBytes(12);
  const nonce = randomBytes(6).toString("hex");
  const filename = `policydesk-${compactTimestamp(now)}-${nonce}-kv-${keyVersion}${BACKUP_EXTENSION}`;
  assertSafeBackupFilename(filename);
  const pathname = `${BACKUP_PREFIX}${filename}`;
  const stats: ExportStats = { tables: [], totalRows: 0 };
  const hash = createHash("sha256");
  let encryptedSize = 0;
  const onChunk = (chunk: Buffer) => {
    hash.update(chunk);
    encryptedSize += chunk.length;
  };
  const source = Readable.from(encryptedBackupStream(now, key, keyVersion, iv, stats, onChunk));
  const body = Readable.toWeb(source) as ReadableStream<Uint8Array>;

  const uploaded = await put(pathname, body, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 60,
    contentType: "application/octet-stream",
    multipart: true,
  });

  const manifest = createBackupManifest({
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    createdAt: now.toISOString(),
    completedAt: new Date().toISOString(),
    payload: {
      filename,
      pathname: uploaded.pathname,
      size: encryptedSize,
      sha256: hash.digest("hex"),
    },
    encryption: {
      algorithm: "AES-256-GCM",
      keyVersion,
      iv: iv.toString("base64"),
      authTagBytes: BACKUP_AUTH_TAG_BYTES,
    },
    compression: "gzip",
    tables: stats.tables,
    totals: { tables: stats.tables.length, rows: stats.totalRows },
  });
  try {
    await put(`${pathname}${MANIFEST_SUFFIX}`, canonicalJson(manifest), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 60,
      contentType: "application/json",
    });
  } catch (error) {
    await del(uploaded.pathname).catch(() => undefined);
    throw error;
  }

  const pruned = await rotateBackups();
  return {
    filename,
    pathname: uploaded.pathname,
    size: encryptedSize,
    createdAt: now,
    manifestAvailable: true,
    manifest,
    pruned,
  };
}

export const backupDatabase = createDatabaseBackup;

async function readStream(stream: ReadableStream<Uint8Array>, maximumBytes?: number) {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      size += chunk.length;
      if (maximumBytes !== undefined && size > maximumBytes) {
        throw new Error("Blob content exceeds the allowed size.");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

export async function verifyStoredBackup(filename: string): Promise<BackupVerification> {
  assertSafeBackupFilename(filename);
  const pathname = `${BACKUP_PREFIX}${filename}`;
  const manifestResult = await get(`${pathname}${MANIFEST_SUFFIX}`, { access: "private" });
  if (manifestResult?.statusCode !== 200 || !manifestResult.stream) {
    return { valid: false, filename, reason: "No se encontró el manifiesto privado." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse((await readStream(manifestResult.stream, MAX_MANIFEST_BYTES)).toString("utf8"));
  } catch {
    return { valid: false, filename, reason: "El manifiesto no contiene JSON válido." };
  }
  const manifestVerification = verifyBackupManifest(parsed);
  if (!manifestVerification.valid) {
    return { valid: false, filename, reason: manifestVerification.reason };
  }
  const manifest = manifestVerification.manifest;
  if (manifest.payload.filename !== filename || manifest.payload.pathname !== pathname) {
    return { valid: false, filename, reason: "El manifiesto apunta a otro respaldo." };
  }

  const payloadResult = await get(pathname, { access: "private" });
  if (payloadResult?.statusCode !== 200 || !payloadResult.stream) {
    return { valid: false, filename, reason: "No se encontró el payload cifrado." };
  }
  const hash = createHash("sha256");
  let size = 0;
  const reader = payloadResult.stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const sha256 = hash.digest("hex");
  if (size !== manifest.payload.size || sha256 !== manifest.payload.sha256) {
    return { valid: false, filename, reason: "El tamaño o hash del payload no coincide." };
  }
  return { valid: true, filename, size, sha256, manifest };
}

export async function getBackupDownload(filename: string) {
  assertSafeBackupFilename(filename);
  return get(`${BACKUP_PREFIX}${filename}`, { access: "private" });
}
