import { Pool, type PoolClient } from "pg";
import type { BackupManifest } from "@/lib/backup-logic";
import { PROTECTED_TENANT_TABLES } from "@/lib/tenant-organization-foundation";
import {
  quoteIdentifier,
  synchronizeSequences,
  tableReference,
  validateDomainInvariants,
  validateForeignKeys,
  type BackupTableRecord,
  type ParsedBackup,
} from "@/lib/backup-restore-validation";
import { RestoreIntegrityError } from "@/lib/backup-restore-validation";

const OPTIONAL_TENANT_TABLES = new Set(["SecurityEventAggregate", "OrganizationSubscription", "BillingCharge"]);
const TENANT_TABLES = new Set([...PROTECTED_TENANT_TABLES, ...OPTIONAL_TENANT_TABLES]);

const CYCLIC_NULLABLE_COLUMNS = [
  ["Client", "referidorId"],
  ["Policy", "familyRootId"],
  ["Policy", "renewedFromPolicyId"],
  ["PolicyRenewalSuggestion", "duplicateOfId"],
  ["ReceiptReconciliationIssue", "duplicateOfId"],
  ["LedgerImportIssue", "duplicateOfId"],
  ["AssistantReport", "parentReportId"],
  ["Document", "endorsementId"],
  ["Document", "receiptId"],
  ["Document", "taskId"],
  ["PolicyEndorsement", "documentId"],
  ["Receipt", "documentId"],
] as const;

const CYCLIC_EDGE_PAIRS = new Set([
  "Document->PolicyEndorsement",
  "PolicyEndorsement->Document",
  "Document->Receipt",
  "Receipt->Document",
]);

type TenantTable = BackupTableRecord & { columns: BackupTableRecord["columns"] };

function assertOrganizationId(organizationId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(organizationId)) throw new Error("Invalid organization id.");
}

function restoreValue(value: unknown, postgresType: string) {
  if (postgresType === "bytea" && value && typeof value === "object" && (value as { type?: unknown }).type === "Buffer" && Array.isArray((value as { data?: unknown }).data)) {
    return Buffer.from((value as { data: number[] }).data);
  }
  return value;
}

function tableKey(table: BackupTableRecord) {
  return `${table.schema}.${table.name}`;
}

function tenantTables(parsed: ParsedBackup, organizationId: string, formatVersion: BackupManifest["version"]): TenantTable[] {
  const result: TenantTable[] = [];
  for (const table of parsed.tables.values()) {
    if (table.schema !== "public" || !TENANT_TABLES.has(table.name)) continue;
    const rows = parsed.rows.get(tableKey(table)) ?? [];
    const hasOrganizationColumn = table.columns.some((column) => column.name === "organizationId");
    if (!hasOrganizationColumn && formatVersion === 2) {
      throw new RestoreIntegrityError(`La tabla tenant ${table.name} no tiene organizationId en un manifiesto v2.`, "BACKUP_SCHEMA_INCOMPATIBLE");
    }
    const data = rows.filter((row) => {
      const value = row.data.organizationId;
      if (hasOrganizationColumn && value !== organizationId) {
        if (value !== null && value !== undefined) throw new RestoreIntegrityError(`El backup contiene filas de otra organización en ${table.name}.`, "TENANT_AUDIT_FAILED");
        throw new RestoreIntegrityError(`El backup contiene organizationId nulo en ${table.name}.`, "TENANT_AUDIT_FAILED");
      }
      return true;
    });
    if (!hasOrganizationColumn) {
      table.columns = [...table.columns, { name: "organizationId", dataType: "text", postgresType: "text", nullable: false }];
      for (const row of data) row.data.organizationId = organizationId;
    }
    result.push({ ...table, columns: [...table.columns] });
  }
  if (result.length === 0) throw new RestoreIntegrityError("El backup no contiene tablas tenant restaurables.", "BACKUP_SCHEMA_INCOMPATIBLE");
  return result;
}

async function assertTargetOrganization(client: PoolClient, organizationId: string, allowRestoring = false) {
  const result = await client.query<{ status: string }>(`SELECT "status" FROM "Organization" WHERE "id" = $1 FOR UPDATE`, [organizationId]);
  if (!result.rows[0]) throw new RestoreIntegrityError("La organización no existe en el target.", "TENANT_AUDIT_FAILED");
  if (!allowRestoring && result.rows[0].status === "RESTORING") throw new RestoreIntegrityError("El target ya tiene la organización en RESTORING.", "TENANT_AUDIT_FAILED");
}

async function assertDependencies(client: PoolClient, parsed: ParsedBackup, organizationId: string, manifest: BackupManifest) {
  if (manifest.version === 2 && manifest.organization?.id !== organizationId) {
    throw new RestoreIntegrityError("El manifiesto no corresponde a la organización solicitada.", "TENANT_AUDIT_FAILED");
  }
  if (manifest.capability === "DATABASE_ONLY") {
    throw new RestoreIntegrityError("El backup no es elegible para rollback porque contiene Document sin archivos.", "TENANT_AUDIT_FAILED");
  }
  if ((parsed.rows.get("public.Document")?.length ?? 0) > 0) {
    throw new RestoreIntegrityError("El backup contiene Document, pero los archivos documentales no están incluidos.", "TENANT_AUDIT_FAILED");
  }
  const dependencyIds = manifest.dependencies?.userIds ?? [];
  if (dependencyIds.length > 0) {
    const result = await client.query<{ id: string }>(`SELECT "id" FROM "User" WHERE "id" = ANY($1::text[])`, [dependencyIds]);
    const found = new Set(result.rows.map((row) => row.id));
    const missing = dependencyIds.filter((id) => !found.has(id));
    if (missing.length > 0) throw new RestoreIntegrityError(`Faltan usuarios globales dependientes (${missing.length}).`, "TENANT_AUDIT_FAILED");
  }

  const subscriptionRows = parsed.rows.get("public.OrganizationSubscription") ?? [];
  if (subscriptionRows.length > 0) {
    const planIds = manifest.dependencies?.planIds;
    if (!Array.isArray(planIds)) throw new RestoreIntegrityError("El backup con billing no declara sus dependencias de planes.", "BACKUP_SCHEMA_INCOMPATIBLE");
    const referencedPlanIds = [...new Set(subscriptionRows.map((row) => row.data.planId).filter((value): value is string => typeof value === "string"))];
    const undeclared = referencedPlanIds.filter((id) => !planIds.includes(id));
    if (undeclared.length > 0) throw new RestoreIntegrityError(`El backup contiene planes no declarados (${undeclared.length}).`, "TENANT_AUDIT_FAILED");
    if (planIds.length > 0) {
      const result = await client.query<{ id: string }>(`SELECT "id" FROM "Plan" WHERE "id" = ANY($1::text[])`, [planIds]);
      const found = new Set(result.rows.map((row) => row.id));
      const missing = planIds.filter((id) => !found.has(id));
      if (missing.length > 0) throw new RestoreIntegrityError(`Faltan planes globales dependientes (${missing.length}).`, "TENANT_AUDIT_FAILED");
    }
  }
}

async function dependencyOrder(client: PoolClient, tables: TenantTable[]) {
  const keys = new Set(tables.map(tableKey));
  const byKey = new Map(tables.map((table) => [tableKey(table), table]));
  const deps = new Map<string, Set<string>>([...keys].map((key) => [key, new Set()]));
  const children = new Map<string, Set<string>>([...keys].map((key) => [key, new Set()]));
  const fks = await client.query<{ child: string; parent: string }>(`
    SELECT child.relname AS child, parent.relname AS parent
      FROM pg_constraint con
      JOIN pg_class child ON child.oid = con.conrelid
      JOIN pg_class parent ON parent.oid = con.confrelid
      JOIN pg_namespace ns ON ns.oid = child.relnamespace
     WHERE con.contype = 'f' AND ns.nspname = 'public'
  `);
  for (const fk of fks.rows) {
    const child = `public.${fk.child}`;
    const parent = `public.${fk.parent}`;
    if (!keys.has(child) || !keys.has(parent) || child === parent || CYCLIC_EDGE_PAIRS.has(`${fk.child}->${fk.parent}`)) continue;
    deps.get(child)?.add(parent);
    children.get(parent)?.add(child);
  }
  const ready = [...keys].filter((key) => deps.get(key)?.size === 0).sort();
  const ordered: string[] = [];
  while (ready.length) {
    const key = ready.shift()!;
    ordered.push(key);
    for (const child of children.get(key) ?? []) {
      deps.get(child)?.delete(key);
      if (deps.get(child)?.size === 0) ready.push(child);
    }
    ready.sort();
  }
  if (ordered.length !== keys.size) throw new RestoreIntegrityError("El grafo tenant contiene un ciclo no soportado.", "TENANT_AUDIT_FAILED");
  return ordered.map((key) => byKey.get(key)!);
}

async function clearCyclicReferences(client: PoolClient, organizationId: string, tables: TenantTable[]) {
  const available = new Map(tables.map((table) => [table.name, new Set(table.columns.map((column) => column.name))]));
  for (const [table, column] of CYCLIC_NULLABLE_COLUMNS) {
    if (!available.get(table)?.has(column)) continue;
    await client.query(`UPDATE ${tableReference("public", table)} SET ${quoteIdentifier(column)} = NULL WHERE "organizationId" = $1`, [organizationId]);
  }
}

async function deleteTenantRows(client: PoolClient, organizationId: string, ordered: TenantTable[]) {
  for (const table of [...ordered].reverse()) {
    await client.query(`DELETE FROM ${tableReference(table.schema, table.name)} WHERE "organizationId" = $1`, [organizationId]);
  }
}

async function insertTenantRows(client: PoolClient, organizationId: string, ordered: TenantTable[], parsed: ParsedBackup) {
  for (const table of ordered) {
    const columns = table.columns.map((column) => column.name);
    const types = new Map(table.columns.map((column) => [column.name, column.postgresType]));
    for (const row of (parsed.rows.get(tableKey(table)) ?? []).filter((candidate) => candidate.data.organizationId === organizationId)) {
      if (row.data.organizationId === undefined) row.data.organizationId = organizationId;
      const values = columns.map((column) => restoreValue(row.data[column], types.get(column) ?? ""));
      const placeholders = values.map((_value, index) => `$${index + 1}`).join(", ");
      await client.query(`INSERT INTO ${tableReference(table.schema, table.name)} (${columns.map(quoteIdentifier).join(", ")}) VALUES (${placeholders})`, values);
    }
  }
}

async function insertEnvelopeRows(client: PoolClient, table: BackupTableRecord, rows: Array<{ data: Record<string, unknown> }>, statusOverride?: string) {
  const columns = table.columns.map((column) => column.name);
  const types = new Map(table.columns.map((column) => [column.name, column.postgresType]));
  for (const row of rows) {
    const data = statusOverride && table.name === "Organization" ? { ...row.data, status: statusOverride } : row.data;
    const values = columns.map((column) => restoreValue(data[column], types.get(column) ?? ""));
    await client.query(`INSERT INTO ${tableReference(table.schema, table.name)} (${columns.map(quoteIdentifier).join(", ")}) VALUES (${values.map((_value, index) => `$${index + 1}`).join(", ")})`, values);
  }
}

async function restoreCyclicReferences(client: PoolClient, organizationId: string, ordered: TenantTable[], parsed: ParsedBackup) {
  const tables = new Map(ordered.map((table) => [table.name, table]));
  for (const [table, column] of CYCLIC_NULLABLE_COLUMNS) {
    const definition = tables.get(table);
    if (!definition) continue;
    const primaryKey = definition.primaryKey ?? [];
    if (primaryKey.length !== 1) throw new RestoreIntegrityError(`La tabla ${table} no tiene una PK simple para restaurar referencias cíclicas.`, "TENANT_AUDIT_FAILED");
    const key = primaryKey[0];
    const columnDefinition = definition.columns.find((item) => item.name === column);
    if (!columnDefinition) continue;
    const type = columnDefinition.postgresType;
    for (const row of (parsed.rows.get(tableKey(definition)) ?? []).filter((candidate) => candidate.data.organizationId === organizationId)) {
      const value = row.data[column];
      if (value === undefined || value === null) continue;
      await client.query(`UPDATE ${tableReference("public", table)} SET ${quoteIdentifier(column)} = $1 WHERE ${quoteIdentifier(key)} = $2 AND "organizationId" = $3`, [restoreValue(value, type), row.data[key], organizationId]);
    }
  }
}

export async function restoreOrganizationBackup(input: {
  targetDatabaseUrl: string;
  organizationId: string;
  plaintext: Buffer;
  manifest: BackupManifest;
  mode?: "create" | "replace";
  advisoryLockKey?: string;
  allowRestoring?: boolean;
}) {
  assertOrganizationId(input.organizationId);
  const { parseBackupRecords } = await import("@/lib/backup-restore-validation");
  const parsed = parseBackupRecords(input.plaintext);
  const manifestCounts = new Map(input.manifest.tables.map(table => [`${table.schema}.${table.name}`, table.rowCount]));
  if (manifestCounts.size !== input.manifest.tables.length || manifestCounts.size !== parsed.tables.size) throw new RestoreIntegrityError("Las tablas del manifiesto y payload no coinciden.", "COUNT_MISMATCH");
  let payloadTotal = 0;
  for (const [key] of parsed.tables) {
    const rows = parsed.rows.get(key)?.length ?? 0;
    if (manifestCounts.get(key) !== rows || parsed.tableEnds.get(key) !== rows) throw new RestoreIntegrityError(`Conteo de manifiesto/payload inválido en ${key}.`, "COUNT_MISMATCH");
    payloadTotal += rows;
  }
  if (payloadTotal !== parsed.declaredTotalRows || payloadTotal !== input.manifest.totals.rows) throw new RestoreIntegrityError("El total del manifiesto y payload no coincide.", "COUNT_MISMATCH");
  const pool = new Pool({ connectionString: input.targetDatabaseUrl, max: 1, application_name: "policydesk-organization-restore" });
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    const tables = tenantTables(parsed, input.organizationId, input.manifest.version);
    const mode = input.mode ?? "replace";
    const envelope = new Map([...parsed.tables.values()].filter((table) => table.schema === "public" && ["Organization", "User", "OrganizationMembership"].includes(table.name)).map((table) => [table.name, table]));
    const organizationRows = parsed.rows.get("public.Organization") ?? [];
    const userRows = parsed.rows.get("public.User") ?? [];
    const membershipRows = parsed.rows.get("public.OrganizationMembership") ?? [];
    if (mode === "create" && (organizationRows.length !== 1 || !envelope.has("Organization") || !envelope.has("User") || !envelope.has("OrganizationMembership"))) {
      throw new RestoreIntegrityError("El paquete de creación no contiene Organization/User/Membership completos.", "BACKUP_SCHEMA_INCOMPATIBLE");
    }
    if (organizationRows.some((row) => row.data.id !== input.organizationId)
      || membershipRows.some((row) => row.data.organizationId !== input.organizationId)
      || userRows.some((row) => row.data.platformRole && row.data.platformRole !== "NONE")) {
      throw new RestoreIntegrityError("El paquete contiene identidades fuera del tenant o un superadmin.", "TENANT_AUDIT_FAILED");
    }
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    transactionStarted = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.advisoryLockKey ?? `policydesk-organization-restore:${input.organizationId}`]);
    // Production import runs as a controlled CLI role. When FORCE RLS is
    // already enabled, the transaction still needs the exact tenant context;
    // this never becomes a web restore path.
    await client.query("SELECT set_config('app.organization_id', $1, true)", [input.organizationId]);
    const existing = await client.query<{ status: string }>(`SELECT "status" FROM "Organization" WHERE "id" = $1 FOR UPDATE`, [input.organizationId]);
    if (mode === "create") {
      if (existing.rows[0]) throw new RestoreIntegrityError("La organización ya existe en el target.", "TENANT_AUDIT_FAILED");
      await insertEnvelopeRows(client, envelope.get("Organization")!, organizationRows, "SUSPENDED");
      await insertEnvelopeRows(client, envelope.get("User")!, userRows);
      await insertEnvelopeRows(client, envelope.get("OrganizationMembership")!, membershipRows);
    } else {
      await assertTargetOrganization(client, input.organizationId, input.allowRestoring === true);
    }
    await assertDependencies(client, parsed, input.organizationId, input.manifest);
    const ordered = await dependencyOrder(client, tables);
    await clearCyclicReferences(client, input.organizationId, tables);
    await deleteTenantRows(client, input.organizationId, ordered);
    await insertTenantRows(client, input.organizationId, ordered, parsed);
    await restoreCyclicReferences(client, input.organizationId, ordered, parsed);
    const tableCounts: Array<{ table: string; rows: number; backup: number; manifest: number }> = [];
    for (const table of ordered) {
      const backupCount = parsed.rows.get(tableKey(table))?.length ?? 0;
      const manifestCount = manifestCounts.get(tableKey(table));
      const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${tableReference(table.schema, table.name)} WHERE "organizationId" = $1`, [input.organizationId]);
      const restoredCount = Number(result.rows[0]?.count);
      if (manifestCount !== backupCount || restoredCount !== backupCount) {
        throw new RestoreIntegrityError(`El conteo tenant restaurado no coincide en ${table.name}.`, "COUNT_MISMATCH");
      }
      tableCounts.push({ table: table.name, rows: restoredCount, backup: backupCount, manifest: manifestCount });
    }
    const foreignKeys = await validateForeignKeys(client);
    const domainChecks = await validateDomainInvariants(client);
    const sequences = await synchronizeSequences(client);
    await client.query("COMMIT");
    transactionStarted = false;
    return { mode, foreignKeys, domainChecks, sequences, tables: tableCounts };
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end().catch(() => undefined);
  }
}
