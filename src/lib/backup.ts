import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import { del, get, list, put } from "@vercel/blob";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import {
  BACKUP_AUTH_TAG_BYTES,
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  TENANT_BACKUP_FORMAT_VERSION,
  assertValidKeyVersion,
  canonicalJson,
  createBackupContainerHeader,
  createBackupManifest,
  decryptBackupPayload,
  encryptBackupPayload,
  parseBackupEncryptionKey,
  selectBackupRetention,
  sha256Hex,
  verifyBackupManifest,
  type BackupManifest,
} from "@/lib/backup-logic";
import { PROTECTED_TENANT_TABLES } from "@/lib/tenant-organization-foundation";
import { getDirectDatabaseUrl } from "@/lib/db";

const BACKUP_PREFIX = "database-backups/";
const TENANT_BACKUP_PREFIX = "organization-backups/";
export const EMERGENCY_BACKUP_PREFIX = "emergency-backups/";
// Copies created during a key migration are deliberately outside BACKUP_PREFIX so
// regular retention can never prune either the source or the migration copy.
const BACKUP_REKEY_PREFIX = "database-backup-rekeys/";
export const GLOBAL_BACKUP_RETENTION_DAYS = 30;
const BACKUP_EXTENSION = ".ndjson.gz.enc";
const MANIFEST_SUFFIX = ".manifest.json";
const EXPORT_BATCH_SIZE = 500;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const BACKUP_FILENAME_PATTERN =
  /^(?:policydesk|policydesk-emergency|policydesk-org-[A-Za-z0-9._-]{1,128})-\d{8}T\d{9}Z-[a-f0-9]{12}-kv-[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.ndjson\.gz\.enc$/;

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
  scope?: "PLATFORM" | "ORGANIZATION";
  organizationId?: string;
  storage?: "original" | "rekeyed";
};

export type BackupTarget = Pick<BackupEntry, "filename" | "pathname">;

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

export type BackupRekeyStatus = {
  ready: boolean;
  detail: string;
  targetKeyVersion?: string;
};

export type BackupVerification =
  | {
      valid: true;
      filename: string;
      size: number;
      sha256: string;
      manifest: BackupManifest;
    }
  | {
      valid: false;
      filename: string;
      reason: string;
      code:
        | "MANIFEST_NOT_FOUND"
        | "MANIFEST_INVALID"
        | "MANIFEST_SCOPE_MISMATCH"
        | "PAYLOAD_NOT_FOUND"
        | "PAYLOAD_HASH_MISMATCH"
        | "PAYLOAD_DECRYPTION_FAILED"
        | "PAYLOAD_HEADER_MISMATCH"
        | "BLOB_UNAVAILABLE";
    };

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

  const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  const databaseUrl = process.env.DATABASE_ADMIN_URL?.trim() ||
    (!isProduction ? (process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim()) : "");
  checks.push(
    buildBackupPreflightCheck(
      "database",
      "Postgres",
      databaseUrl && /^postgres(ql)?:\/\//i.test(databaseUrl)
        ? (process.env.DATABASE_ADMIN_URL?.trim() ? "DATABASE_ADMIN_URL apunta a Postgres directo." : "Postgres directo configurado para un entorno no productivo.")
        : (isProduction ? "DATABASE_ADMIN_URL debe apuntar a un Postgres directo en producción." : "DATABASE_ADMIN_URL o DATABASE_URL debe apuntar a Postgres."),
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
    keyVersion: assertValidKeyVersion(requireEnvironment("BACKUP_ENCRYPTION_KEY_VERSION")),
  };
}

function versionedBackupEncryptionKeyName(keyVersion: string) {
  return `BACKUP_ENCRYPTION_KEY_${assertValidKeyVersion(keyVersion)
    .replace(/[^A-Za-z0-9]/g, "_")
    .toUpperCase()}`;
}

function getEncryptionKeyForVersion(keyVersion: string) {
  const activeVersion = assertValidKeyVersion(requireEnvironment("BACKUP_ENCRYPTION_KEY_VERSION"));
  const environmentName = keyVersion === activeVersion
    ? "BACKUP_ENCRYPTION_KEY"
    : versionedBackupEncryptionKeyName(keyVersion);
  return parseBackupEncryptionKey(requireEnvironment(environmentName));
}

export function getBackupRekeyStatus(): BackupRekeyStatus {
  if (process.env.BACKUP_REKEY_ENABLED !== "true") {
    return {
      ready: false,
      detail: "La migración está desactivada. Define BACKUP_REKEY_ENABLED=true solo durante la migración.",
    };
  }

  const targetKeyVersion = process.env.BACKUP_REKEY_TARGET_KEY_VERSION?.trim();
  if (!targetKeyVersion) {
    return { ready: false, detail: "Falta BACKUP_REKEY_TARGET_KEY_VERSION." };
  }

  try {
    assertValidKeyVersion(targetKeyVersion);
    const activeVersion = assertValidKeyVersion(requireEnvironment("BACKUP_ENCRYPTION_KEY_VERSION"));
    if (targetKeyVersion === activeVersion) {
      return {
        ready: false,
        detail: "La nueva versión debe ser distinta de BACKUP_ENCRYPTION_KEY_VERSION.",
      };
    }
    parseBackupEncryptionKey(requireEnvironment(versionedBackupEncryptionKeyName(targetKeyVersion)));
    return { ready: true, detail: `Lista para crear copias con la versión ${targetKeyVersion}.`, targetKeyVersion };
  } catch (error) {
    return {
      ready: false,
      detail: error instanceof Error ? error.message : "La configuración de migración no es válida.",
    };
  }
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

type SnapshotScope = {
  organizationId?: string;
  tableNames?: ReadonlySet<string>;
  manifestVersion?: number;
};

async function* exportPostgresSnapshot(createdAt: Date, stats: ExportStats, scope: SnapshotScope = {}) {
  const connectionString = getDirectDatabaseUrl();
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
    const allTables = await describeTables(client);
    const tables = scope.tableNames
      ? allTables.filter((table) => scope.tableNames?.has(table.name))
      : allTables;

    yield jsonLine({
      type: "backup",
      format: BACKUP_FORMAT,
      version: scope.manifestVersion ?? BACKUP_FORMAT_VERSION,
      createdAt: createdAt.toISOString(),
      scope: scope.organizationId ? "ORGANIZATION" : "PLATFORM",
      ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
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
      const where = scope.organizationId ? organizationSnapshotWhere(table, scope.organizationId) : platformSnapshotWhere(table);
      await client.query(
        `DECLARE backup_rows NO SCROLL CURSOR FOR SELECT * FROM ${tableReference(table)}${where} ORDER BY ${orderBy}`,
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

function organizationSnapshotWhere(table: Pick<TableDescription, "name">, organizationId: string) {
  // Tenant v2 exports only tables with organizationId. Future envelope tables
  // must add an explicit predicate here rather than broadening the scope.
  const escaped = organizationId.replaceAll("'", "''");
  if (table.name === "Organization") return ` WHERE "id" = '${escaped}'`;
  if (table.name === "OrganizationMembership") return ` WHERE "organizationId" = '${escaped}'`;
  if (table.name === "User") {
    return ` WHERE "id" IN (SELECT "userId" FROM "OrganizationMembership" WHERE "organizationId" = '${escaped}') AND "platformRole" = 'NONE'`;
  }
  return ` WHERE "organizationId" = '${escaped}'`;
}

function platformSnapshotWhere(table: Pick<TableDescription, "name">) {
  const name = table.name;
  if (name === "Organization") return ` WHERE "kind" <> 'DEMO'`;
  if (name === "OrganizationMembership") return ` WHERE "organizationId" IN (SELECT "id" FROM "Organization" WHERE "kind" <> 'DEMO')`;
  if (name === "User") return ` WHERE "id" IN (SELECT "userId" FROM "OrganizationMembership" WHERE "organizationId" IN (SELECT "id" FROM "Organization" WHERE "kind" <> 'DEMO')) OR "platformRole" = 'SUPERADMIN' OR "id" = 'system-user-0000'`;
  if (name === "Session" || name === "UserPreference" || name === "NotificationChannel") return ` WHERE "userId" IN (SELECT "userId" FROM "OrganizationMembership" WHERE "organizationId" IN (SELECT "id" FROM "Organization" WHERE "kind" <> 'DEMO')) OR "userId" IN (SELECT "id" FROM "User" WHERE "platformRole" = 'SUPERADMIN')`;
  if (name === "BackupArtifact") return ` WHERE "organizationId" IS NULL OR "organizationId" IN (SELECT "id" FROM "Organization" WHERE "kind" <> 'DEMO')`;
  if (name === "OrganizationRestoreRun") return ` WHERE "organizationId" IN (SELECT "id" FROM "Organization" WHERE "kind" <> 'DEMO')`;
  if (name === "PlatformAuditLog") {
    // Platform audit evidence is retained, but a DEMO tenant must not leak
    // into a logical platform backup through either side of the audit event.
    // Keep global/operator events (NULL actor/target) while excluding any
    // event attributed to a DEMO member or organization.
    return ` WHERE ("targetOrganizationId" IS NULL OR "targetOrganizationId" IN (SELECT "id" FROM "Organization" WHERE "kind" <> 'DEMO'))
      AND ("actorUserId" IS NULL OR "actorUserId" NOT IN (SELECT "userId" FROM "OrganizationMembership" WHERE "organizationId" IN (SELECT "id" FROM "Organization" WHERE "kind" = 'DEMO')))
      AND ("targetUserId" IS NULL OR "targetUserId" NOT IN (SELECT "userId" FROM "OrganizationMembership" WHERE "organizationId" IN (SELECT "id" FROM "Organization" WHERE "kind" = 'DEMO')))`;
  }
  if (name === "OrganizationSubscription" || name === "BillingCharge" || name === "SecurityEventAggregate" || name === "OrganizationCapability" || name === "OrganizationSetting" || name === "DemoOrganizationState" || name === "DemoUploadArtifact") return ` WHERE "organizationId" IN (SELECT "id" FROM "Organization" WHERE "kind" <> 'DEMO')`;
  if (PROTECTED_TENANT_TABLES.includes(name as (typeof PROTECTED_TENANT_TABLES)[number])) return ` WHERE "organizationId" IN (SELECT "id" FROM "Organization" WHERE "kind" <> 'DEMO')`;
  return "";
}

function compactTimestamp(date: Date) {
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(".", "");
}

function deterministicBackupNonce(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function utcDayStart(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function utcWeekStart(value: Date) {
  const start = utcDayStart(value);
  const daysSinceMonday = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start;
}

export function buildScheduledPlatformBackupTarget(now: Date): BackupTarget {
  const keyVersion = assertValidKeyVersion(requireEnvironment("BACKUP_ENCRYPTION_KEY_VERSION"));
  const period = utcWeekStart(now);
  const nonce = deterministicBackupNonce(`platform:${period.toISOString()}:${keyVersion}`);
  const filename = `policydesk-${compactTimestamp(period)}-${nonce}-kv-${keyVersion}${BACKUP_EXTENSION}`;
  assertSafeBackupFilename(filename);
  return { filename, pathname: `${BACKUP_PREFIX}${filename}` };
}

export function buildManualPlatformBackupTarget(now: Date, emergency = false): BackupTarget {
  const keyVersion = assertValidKeyVersion(requireEnvironment("BACKUP_ENCRYPTION_KEY_VERSION"));
  const nonce = randomBytes(6).toString("hex");
  const filename = `${emergency ? "policydesk-emergency" : "policydesk"}-${compactTimestamp(now)}-${nonce}-kv-${keyVersion}${BACKUP_EXTENSION}`;
  assertSafeBackupFilename(filename);
  return { filename, pathname: `${emergency ? EMERGENCY_BACKUP_PREFIX : BACKUP_PREFIX}${filename}` };
}

export function buildScheduledOrganizationBackupTarget(organizationId: string, now: Date): BackupTarget {
  const safeOrganizationId = assertSafeOrganizationId(organizationId);
  const keyVersion = assertValidKeyVersion(requireEnvironment("BACKUP_ENCRYPTION_KEY_VERSION"));
  const period = utcDayStart(now);
  const nonce = deterministicBackupNonce(`organization:${safeOrganizationId}:${period.toISOString()}:${keyVersion}`);
  const filename = `policydesk-org-${safeOrganizationId}-${compactTimestamp(period)}-${nonce}-kv-${keyVersion}${BACKUP_EXTENSION}`;
  assertSafeBackupFilename(filename);
  return { filename, pathname: `${TENANT_BACKUP_PREFIX}${safeOrganizationId}/${filename}` };
}

export function buildManualOrganizationBackupTarget(organizationId: string, now: Date): BackupTarget {
  const safeOrganizationId = assertSafeOrganizationId(organizationId);
  const keyVersion = assertValidKeyVersion(requireEnvironment("BACKUP_ENCRYPTION_KEY_VERSION"));
  const nonce = randomBytes(6).toString("hex");
  const filename = `policydesk-org-${safeOrganizationId}-${compactTimestamp(now)}-${nonce}-kv-${keyVersion}${BACKUP_EXTENSION}`;
  assertSafeBackupFilename(filename);
  return { filename, pathname: `${TENANT_BACKUP_PREFIX}${safeOrganizationId}/${filename}` };
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
  scope: SnapshotScope = {},
) {
  const { prefix, authenticatedData } = createBackupContainerHeader(keyVersion, iv);
  onChunk(prefix);
  yield prefix;

  const cipher = createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: BACKUP_AUTH_TAG_BYTES,
  });
  cipher.setAAD(authenticatedData);
  const compressed = Readable.from(exportPostgresSnapshot(createdAt, stats, scope)).pipe(
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

async function listAllBackupBlobs(prefix: string) {
  const blobs: Awaited<ReturnType<typeof list>>["blobs"] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, limit: 1000, cursor });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function listBackupsInPrefix(prefix: string): Promise<BackupEntry[]> {
  const blobs = await listAllBackupBlobs(prefix);
  const pathnames = new Set(blobs.map((blob) => blob.pathname));
  return blobs
    .filter((blob) => blob.pathname.endsWith(BACKUP_EXTENSION))
    .map((blob) => {
      const filename = blob.pathname.slice(prefix.length);
      if (!BACKUP_FILENAME_PATTERN.test(filename)) return null;
      return {
        filename,
        pathname: blob.pathname,
        size: blob.size,
        createdAt: blob.uploadedAt,
        manifestAvailable: pathnames.has(`${blob.pathname}${MANIFEST_SUFFIX}`),
        storage: prefix === BACKUP_REKEY_PREFIX ? "rekeyed" : "original",
      } satisfies BackupEntry;
    })
    .filter((entry): entry is Exclude<typeof entry, null> => entry !== null)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
}

export function listBackups(): Promise<BackupEntry[]> {
  return listBackupsInPrefix(BACKUP_PREFIX);
}

export function listRekeyedBackups(): Promise<BackupEntry[]> {
  return listBackupsInPrefix(BACKUP_REKEY_PREFIX);
}

export function listEmergencyBackups(): Promise<BackupEntry[]> {
  return listBackupsInPrefix(EMERGENCY_BACKUP_PREFIX);
}

function assertSafeOrganizationId(organizationId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(organizationId)) {
    throw new Error("Invalid organization id for backup storage.");
  }
  return organizationId;
}

async function listTenantBackupsInPrefix(prefix: string, organizationId: string): Promise<BackupEntry[]> {
  const safeOrganizationId = assertSafeOrganizationId(organizationId);
  const tenantPrefix = `${prefix}${safeOrganizationId}/`;
  const blobs = await listAllBackupBlobs(tenantPrefix);
  const pathnames = new Set(blobs.map((blob) => blob.pathname));
  return blobs
    .filter((blob) => blob.pathname.endsWith(BACKUP_EXTENSION))
    .map((blob) => {
      const filename = blob.pathname.slice(tenantPrefix.length);
      if (!BACKUP_FILENAME_PATTERN.test(filename)) return null;
      return {
        filename,
        pathname: blob.pathname,
        size: blob.size,
        createdAt: blob.uploadedAt,
        manifestAvailable: pathnames.has(`${blob.pathname}${MANIFEST_SUFFIX}`),
        scope: "ORGANIZATION",
        organizationId: safeOrganizationId,
        storage: prefix === BACKUP_REKEY_PREFIX ? "rekeyed" : "original",
      } satisfies BackupEntry;
    })
    .filter((entry): entry is Exclude<typeof entry, null> => entry !== null)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
}

export function listOrganizationBackups(organizationId: string): Promise<BackupEntry[]> {
  return listTenantBackupsInPrefix(TENANT_BACKUP_PREFIX, organizationId);
}

export async function rotateBackups(options: { retentionDays?: number } = {}) {
  const entries = await listBackups();
  const selection = selectBackupRetention(
    entries.map((entry) => ({ ...entry, id: entry.pathname })),
  );
  const expired = options.retentionDays === undefined
    ? []
    : selection.keep.filter(
        (entry) => Date.now() - entry.createdAt.getTime() >= options.retentionDays! * 86_400_000,
      );
  const toRemove = [...selection.remove, ...expired].filter(
    (entry, index, all) => all.findIndex((candidate) => candidate.pathname === entry.pathname) === index,
  );
  if (toRemove.length === 0) return [];
  await del(
    toRemove.flatMap((entry) => [entry.pathname, `${entry.pathname}${MANIFEST_SUFFIX}`]),
  );
  return toRemove.map((entry) => entry.pathname);
}

export async function createDatabaseBackup(
  now = new Date(),
  options: { emergency?: boolean; retentionDays?: number; target?: BackupTarget; deferRotation?: boolean } = {},
): Promise<CreatedBackup> {
  const preflight = getBackupPreflightStatus();
  if (!preflight.ready) {
    throw new Error(formatBackupPreflightError(preflight));
  }
  const { key, keyVersion } = getEncryptionConfiguration();
  const demoExclusion = await getDemoExclusionStats();
  const iv = randomBytes(12);
  const target = options.target ?? buildManualPlatformBackupTarget(now, options.emergency);
  const filename = target.filename;
  assertSafeBackupFilename(filename);
  const pathname = target.pathname;
  if (options.target && pathname !== `${options.emergency ? EMERGENCY_BACKUP_PREFIX : BACKUP_PREFIX}${filename}`) {
    throw new Error("El target global no coincide con su prefijo y filename.");
  }
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
    demoExclusion,
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

  const pruned = options.emergency || options.deferRotation ? [] : await rotateBackups(
    options.retentionDays === undefined ? {} : { retentionDays: options.retentionDays },
  );
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

async function getDemoExclusionStats() {
  const pool = new Pool({ connectionString: getDirectDatabaseUrl(), max: 1, application_name: "policydesk-backup-demo-exclusion" });
  try {
    const organizations = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM "Organization" WHERE "kind" = 'DEMO'`);
    let protectedRowsExcluded = 0;
    for (const table of PROTECTED_TENANT_TABLES) {
      const result = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM "${table}" WHERE "organizationId" IN (SELECT "id" FROM "Organization" WHERE "kind" = 'DEMO')`);
      protectedRowsExcluded += Number(result.rows[0]?.count ?? 0);
    }
    return { policy: "EXCLUDE_DEMO" as const, organizationCount: Number(organizations.rows[0]?.count ?? 0), protectedRowsExcluded };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export const backupDatabase = createDatabaseBackup;

const TENANT_EXPORT_TABLES = new Set<string>([
  "Organization",
  "User",
  "OrganizationMembership",
  "OrganizationCapability",
  "OrganizationSetting",
  ...PROTECTED_TENANT_TABLES,
  "SecurityEventAggregate",
  "OrganizationSubscription",
  "BillingCharge",
]);

async function getOrganizationBackupMetadata(organizationId: string) {
  const connectionString = getDirectDatabaseUrl();
  const pool = new Pool({ connectionString, max: 1, application_name: "policydesk-organization-backup-metadata" });
  try {
    const result = await pool.query<{
      id: string;
      name: string;
      slug: string;
      status: string;
      kind: string;
    }>(`SELECT "id", "name", "slug", "status", "kind" FROM "Organization" WHERE "id" = $1`, [organizationId]);
    const organization = result.rows[0];
    if (!organization) throw new Error("La organización no existe.");
    if (organization.kind === "DEMO") throw new Error("Los respaldos tenant no están disponibles para organizaciones DEMO.");
    if (organization.status === "RESTORING") throw new Error("La organización está en RESTORING y no puede respaldarse.");
    const memberships = await pool.query<{ userId: string }>(
      `SELECT "userId" FROM "OrganizationMembership" WHERE "organizationId" = $1 ORDER BY "userId"`,
      [organizationId],
    );
    const plans = await pool.query<{ planId: string }>(
      `SELECT DISTINCT "planId" FROM "OrganizationSubscription" WHERE "organizationId" = $1 ORDER BY "planId"`,
      [organizationId],
    );
    return { organization, userIds: memberships.rows.map((row) => row.userId), planIds: plans.rows.map((row) => row.planId) };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function rotateOrganizationBackups(organizationId: string) {
  const entries = await listOrganizationBackups(organizationId);
  const selection = selectBackupRetention(entries.map((entry) => ({ ...entry, id: entry.pathname })));
  if (selection.remove.length === 0) return [];
  await del(selection.remove.flatMap((entry) => [entry.pathname, `${entry.pathname}${MANIFEST_SUFFIX}`]));
  return selection.remove.map((entry) => entry.pathname);
}

export async function createOrganizationDatabaseBackup(
  organizationId: string,
  now = new Date(),
  options: { target?: BackupTarget; deferRotation?: boolean } = {},
): Promise<CreatedBackup> {
  const preflight = getBackupPreflightStatus();
  if (!preflight.ready) throw new Error(formatBackupPreflightError(preflight));
  const safeOrganizationId = assertSafeOrganizationId(organizationId);
  const metadata = await getOrganizationBackupMetadata(safeOrganizationId);
  const { key, keyVersion } = getEncryptionConfiguration();
  const iv = randomBytes(12);
  const target = options.target ?? buildManualOrganizationBackupTarget(safeOrganizationId, now);
  const filename = target.filename;
  assertSafeBackupFilename(filename);
  const pathname = target.pathname;
  if (options.target && pathname !== `${TENANT_BACKUP_PREFIX}${safeOrganizationId}/${filename}`) {
    throw new Error("El target tenant no coincide con su organización y filename.");
  }
  const stats: ExportStats = { tables: [], totalRows: 0 };
  const hash = createHash("sha256");
  let encryptedSize = 0;
  const onChunk = (chunk: Buffer) => {
    hash.update(chunk);
    encryptedSize += chunk.length;
  };
  const source = Readable.from(encryptedBackupStream(
    now,
    key,
    keyVersion,
    iv,
    stats,
    onChunk,
    { organizationId: safeOrganizationId, tableNames: TENANT_EXPORT_TABLES, manifestVersion: TENANT_BACKUP_FORMAT_VERSION },
  ));
  const body = Readable.toWeb(source) as ReadableStream<Uint8Array>;
  const uploaded = await put(pathname, body, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 60,
    contentType: "application/octet-stream",
    multipart: true,
  });
  const capability = (stats.tables.find((table) => table.name === "Document")?.rowCount ?? 0) === 0
    ? "COMPLETE"
    : "DATABASE_ONLY";
  const manifest = createBackupManifest({
    format: BACKUP_FORMAT,
    version: TENANT_BACKUP_FORMAT_VERSION,
    scope: "ORGANIZATION",
    organization: {
      id: safeOrganizationId,
      name: metadata.organization.name,
      slug: metadata.organization.slug,
    },
    capability,
    dependencies: { userIds: metadata.userIds, planIds: metadata.planIds },
    schemaFingerprint: sha256Hex(canonicalJson(stats.tables.map((table) => ({ schema: table.schema, name: table.name, rowCount: table.rowCount })))),
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
  const pruned = options.deferRotation ? [] : await rotateOrganizationBackups(safeOrganizationId);
  return {
    filename,
    pathname: uploaded.pathname,
    size: encryptedSize,
    createdAt: now,
    manifestAvailable: true,
    scope: "ORGANIZATION",
    organizationId: safeOrganizationId,
    manifest,
    pruned,
  };
}

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

async function findBackupManifest(filename: string, pathnameHint?: string) {
  const pathnames = pathnameHint
    ? [pathnameHint]
    : [
        `${BACKUP_PREFIX}${filename}`,
        `${BACKUP_REKEY_PREFIX}${filename}`,
      ];
  for (const pathname of pathnames) {
    let manifestResult;
    try {
      manifestResult = await get(`${pathname}${MANIFEST_SUFFIX}`, { access: "private", useCache: false });
    } catch {
      return { unavailable: true as const };
    }
    if (manifestResult?.statusCode === 200 && manifestResult.stream) {
      return { pathname, manifestResult };
    }
  }
  return null;
}

export async function verifyStoredBackup(filename: string, pathnameHint?: string): Promise<BackupVerification> {
  assertSafeBackupFilename(filename);
  const stored = await findBackupManifest(filename, pathnameHint);
  if (stored && "unavailable" in stored) {
    return { valid: false, filename, reason: "No se pudo consultar el manifiesto privado.", code: "BLOB_UNAVAILABLE" };
  }
  if (!stored) {
    return { valid: false, filename, reason: "No se encontró el manifiesto privado.", code: "MANIFEST_NOT_FOUND" };
  }
  const { pathname, manifestResult } = stored;

  let parsed: unknown;
  try {
    parsed = JSON.parse((await readStream(manifestResult.stream, MAX_MANIFEST_BYTES)).toString("utf8"));
  } catch {
    return { valid: false, filename, reason: "El manifiesto no contiene JSON válido.", code: "MANIFEST_INVALID" };
  }
  const manifestVerification = verifyBackupManifest(parsed);
  if (!manifestVerification.valid) {
    return { valid: false, filename, reason: manifestVerification.reason, code: "MANIFEST_INVALID" };
  }
  const manifest = manifestVerification.manifest;
  if (manifest.payload.filename !== filename || manifest.payload.pathname !== pathname) {
    return { valid: false, filename, reason: "El manifiesto apunta a otro respaldo.", code: "MANIFEST_SCOPE_MISMATCH" };
  }

  let payloadResult;
  try {
    payloadResult = await get(pathname, { access: "private", useCache: false });
  } catch {
    return { valid: false, filename, reason: "No se pudo consultar el payload cifrado.", code: "BLOB_UNAVAILABLE" };
  }
  if (payloadResult?.statusCode !== 200 || !payloadResult.stream) {
    return { valid: false, filename, reason: "No se encontró el payload cifrado.", code: "PAYLOAD_NOT_FOUND" };
  }
  const hash = createHash("sha256");
  const encryptedChunks: Buffer[] = [];
  let size = 0;
  const reader = payloadResult.stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      encryptedChunks.push(Buffer.from(value));
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const sha256 = hash.digest("hex");
  if (size !== manifest.payload.size || sha256 !== manifest.payload.sha256) {
    return { valid: false, filename, reason: "El tamaño o hash del payload no coincide.", code: "PAYLOAD_HASH_MISMATCH" };
  }
  try {
    const key = getEncryptionKeyForVersion(manifest.encryption.keyVersion);
    const decrypted = decryptBackupPayload(Buffer.concat(encryptedChunks, size), key);
    if (decrypted.header.keyVersion !== manifest.encryption.keyVersion || decrypted.plaintext.length === 0) {
      return { valid: false, filename, reason: "El payload cifrado no coincide con el manifiesto.", code: "PAYLOAD_HEADER_MISMATCH" };
    }
  } catch {
    return { valid: false, filename, reason: "El payload no pudo descifrarse con la clave declarada.", code: "PAYLOAD_DECRYPTION_FAILED" };
  }
  return { valid: true, filename, size, sha256, manifest };
}

export async function deleteStoredBackup(pathname: string) {
  if (!pathname.startsWith(BACKUP_PREFIX) && !pathname.startsWith(TENANT_BACKUP_PREFIX) && !pathname.startsWith(BACKUP_REKEY_PREFIX) && !pathname.startsWith(EMERGENCY_BACKUP_PREFIX)) {
    throw new Error("Invalid backup pathname.");
  }
  await del([pathname, `${pathname}${MANIFEST_SUFFIX}`]);
}

export async function getBackupDownload(filename: string, pathnameHint?: string) {
  assertSafeBackupFilename(filename);
  if (pathnameHint) return get(pathnameHint, { access: "private", useCache: false });
  const primary = await get(`${BACKUP_PREFIX}${filename}`, { access: "private", useCache: false });
  if (primary?.statusCode === 200 && primary.stream) return primary;
  return get(`${BACKUP_REKEY_PREFIX}${filename}`, { access: "private", useCache: false });
}

export type RekeyedBackup = {
  sourceFilename: string;
  filename: string;
  pathname: string;
  size: number;
  manifest: BackupManifest;
};

/**
 * Creates a separately stored copy encrypted with a new key. This intentionally
 * never calls `del`, `rotateBackups`, or overwrites a source object.
 */
export async function rekeyStoredBackup(
  sourceFilename: string,
  now = new Date(),
  sourcePathname?: string,
): Promise<RekeyedBackup> {
  assertSafeBackupFilename(sourceFilename);
  const rekeyStatus = getBackupRekeyStatus();
  if (!rekeyStatus.ready || !rekeyStatus.targetKeyVersion) {
    throw new Error(rekeyStatus.detail);
  }

  const source = await verifyStoredBackup(sourceFilename, sourcePathname);
  if (!source.valid) throw new Error(`El respaldo origen no es válido: ${source.reason}`);

  const sourceDownload = await getBackupDownload(sourceFilename, sourcePathname);
  if (sourceDownload?.statusCode !== 200 || !sourceDownload.stream) {
    throw new Error("No se pudo leer el payload cifrado de origen.");
  }

  const encryptedSource = await readStream(sourceDownload.stream);
  const sourceKey = getEncryptionKeyForVersion(source.manifest.encryption.keyVersion);
  const decryptedSource = decryptBackupPayload(encryptedSource, sourceKey);
  if (decryptedSource.header.keyVersion !== source.manifest.encryption.keyVersion) {
    throw new Error("La versión de la clave del payload no coincide con el manifiesto.");
  }
  if (decryptedSource.header.keyVersion === rekeyStatus.targetKeyVersion) {
    throw new Error("El respaldo ya usa la versión de clave destino.");
  }

  const targetKey = parseBackupEncryptionKey(
    requireEnvironment(versionedBackupEncryptionKeyName(rekeyStatus.targetKeyVersion)),
  );
  const iv = randomBytes(12);
  const encryptedTarget = encryptBackupPayload(
    decryptedSource.plaintext,
    targetKey,
    rekeyStatus.targetKeyVersion,
    iv,
  );
  const locallyVerified = decryptBackupPayload(encryptedTarget, targetKey);
  if (!locallyVerified.plaintext.equals(decryptedSource.plaintext)) {
    throw new Error("La copia re-cifrada no pasó la verificación local.");
  }

  const nonce = randomBytes(6).toString("hex");
  const filename = `policydesk-${compactTimestamp(now)}-${nonce}-kv-${rekeyStatus.targetKeyVersion}${BACKUP_EXTENSION}`;
  assertSafeBackupFilename(filename);
  const pathname = `${BACKUP_REKEY_PREFIX}${filename}`;
  const uploaded = await put(pathname, encryptedTarget, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 60,
    contentType: "application/octet-stream",
  });
  const manifest = createBackupManifest({
    format: source.manifest.format,
    version: source.manifest.version,
    createdAt: source.manifest.createdAt,
    completedAt: now.toISOString(),
    payload: {
      filename,
      pathname: uploaded.pathname,
      size: encryptedTarget.length,
      sha256: createHash("sha256").update(encryptedTarget).digest("hex"),
    },
    encryption: {
      algorithm: "AES-256-GCM",
      keyVersion: rekeyStatus.targetKeyVersion,
      iv: iv.toString("base64"),
      authTagBytes: BACKUP_AUTH_TAG_BYTES,
    },
    compression: source.manifest.compression,
    tables: source.manifest.tables,
    totals: source.manifest.totals,
  });
  await put(`${pathname}${MANIFEST_SUFFIX}`, canonicalJson(manifest), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 60,
    contentType: "application/json",
  });

  const verification = await verifyStoredBackup(filename);
  if (!verification.valid) {
    throw new Error(`La copia fue creada pero no pasó su verificación: ${verification.reason}`);
  }

  return { sourceFilename, filename, pathname: uploaded.pathname, size: encryptedTarget.length, manifest };
}
