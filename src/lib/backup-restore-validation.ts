import type { PoolClient, QueryResultRow } from "pg";

export const RESTORE_SKIPPED_TABLES = new Set(["_prisma_migrations"]);

export type BackupColumn = {
  name: string;
  dataType?: string;
  postgresType: string;
  nullable?: boolean;
};

export type BackupTableRecord = {
  type: "table";
  schema: string;
  name: string;
  columns: BackupColumn[];
  primaryKey?: string[];
};

export type BackupRowRecord = {
  type: "row";
  schema: string;
  table: string;
  data: Record<string, unknown>;
};

export type ParsedBackup = {
  tables: Map<string, BackupTableRecord>;
  rows: Map<string, BackupRowRecord[]>;
  tableEnds: Map<string, number>;
  declaredTotalRows: number | null;
};

export type TableCountResult = {
  backup: number;
  manifest: number;
  target: number | null;
  skipped: boolean;
};

export type ForeignKeyResult = {
  constraint: string;
  table: string;
  referencedTable: string;
  columns: string[];
  referencedColumns: string[];
  orphanCount: number;
};

export type DomainCheckResult = {
  name: string;
  count: number;
  ok: boolean;
  detail?: string;
};

export type SequenceSyncResult = {
  table: string;
  column: string;
  sequence: string;
  maxValue: string | null;
  nextValue: string | null;
};

export class RestoreIntegrityError extends Error {
  readonly stage = "integrity";

  constructor(message: string) {
    super(message);
    this.name = "RestoreIntegrityError";
  }
}

export function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function tableReference(schema: string, table: string) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

export function tableKey(schema: string, table: string) {
  return `${schema}.${table}`;
}

export function parseBackupRecords(plaintext: Buffer): ParsedBackup {
  const tables = new Map<string, BackupTableRecord>();
  const rows = new Map<string, BackupRowRecord[]>();
  const tableEnds = new Map<string, number>();
  let declaredTotalRows: number | null = null;
  let endRecordSeen = false;

  for (const [lineNumber, line] of plaintext.toString("utf8").split("\n").entries()) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new RestoreIntegrityError(`El backup contiene JSON inválido en la línea ${lineNumber + 1}.`);
    }
    if (!parsed || typeof parsed !== "object" || typeof (parsed as { type?: unknown }).type !== "string") {
      throw new RestoreIntegrityError(`El backup contiene un registro inválido en la línea ${lineNumber + 1}.`);
    }

    const record = parsed as { type: string; schema?: string; name?: string; table?: string };
    if (record.type === "backup") continue;
    if (record.type === "table") {
      if (typeof record.schema !== "string" || typeof record.name !== "string") {
        throw new RestoreIntegrityError(`El registro de tabla en la línea ${lineNumber + 1} es inválido.`);
      }
      const table = parsed as BackupTableRecord;
      const key = tableKey(table.schema, table.name);
      if (tables.has(key)) throw new RestoreIntegrityError(`La tabla ${key} aparece más de una vez en el backup.`);
      if (!Array.isArray(table.columns) || table.columns.some((column) => !column || typeof column.name !== "string")) {
        throw new RestoreIntegrityError(`La definición de columnas de ${key} es inválida.`);
      }
      tables.set(key, table);
      rows.set(key, []);
      continue;
    }
    if (record.type === "row") {
      if (typeof record.schema !== "string" || typeof record.table !== "string") {
        throw new RestoreIntegrityError(`El registro de fila en la línea ${lineNumber + 1} es inválido.`);
      }
      const key = tableKey(record.schema, record.table);
      const bucket = rows.get(key);
      if (!bucket) throw new RestoreIntegrityError(`La fila de ${key} aparece antes de su definición de tabla.`);
      bucket.push(parsed as BackupRowRecord);
      continue;
    }
    if (record.type === "table_end") {
      if (typeof record.schema !== "string" || typeof record.table !== "string") {
        throw new RestoreIntegrityError(`El cierre de tabla en la línea ${lineNumber + 1} es inválido.`);
      }
      const rowCount = (parsed as { rowCount?: unknown }).rowCount;
      if (typeof rowCount !== "number" || !Number.isSafeInteger(rowCount) || rowCount < 0) {
        throw new RestoreIntegrityError(`El conteo de ${record.schema}.${record.table} es inválido.`);
      }
      const key = tableKey(record.schema, record.table);
      if (!rows.has(key) || tableEnds.has(key)) {
        throw new RestoreIntegrityError(`El cierre de ${key} es inválido o está repetido.`);
      }
      tableEnds.set(key, rowCount);
      continue;
    }
    if (record.type === "end") {
      if (endRecordSeen) throw new RestoreIntegrityError("El backup contiene más de un registro final.");
      const rowCount = (parsed as { rowCount?: unknown }).rowCount;
      if (rowCount !== undefined && (typeof rowCount !== "number" || !Number.isSafeInteger(rowCount) || rowCount < 0)) {
        throw new RestoreIntegrityError("El conteo total declarado por el backup es inválido.");
      }
      declaredTotalRows = rowCount === undefined ? null : rowCount;
      endRecordSeen = true;
      continue;
    }
    throw new RestoreIntegrityError(`El backup contiene un tipo de registro no soportado: ${record.type}.`);
  }

  if (tables.size === 0) throw new RestoreIntegrityError("El backup no contiene tablas.");
  for (const key of tables.keys()) {
    if (!tableEnds.has(key)) throw new RestoreIntegrityError(`Falta el cierre de tabla de ${key}.`);
  }
  if (!endRecordSeen || declaredTotalRows === null) throw new RestoreIntegrityError("Falta el registro final del backup.");
  return { tables, rows, tableEnds, declaredTotalRows };
}

function assertCount(condition: boolean, message: string): asserts condition {
  if (!condition) throw new RestoreIntegrityError(message);
}

async function queryTableExists(client: PoolClient, schema: string, table: string) {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = $2 AND table_type = 'BASE TABLE'
     ) AS exists`,
    [schema, table],
  );
  return result.rows[0]?.exists === true;
}

async function queryColumns(client: PoolClient, schema: string, table: string) {
  const result = await client.query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position`,
    [schema, table],
  );
  return new Set(result.rows.map((row) => row.column_name));
}

export async function validateRestoreSchema(client: PoolClient, parsed: ParsedBackup) {
  const missingTables: string[] = [];
  const targetTables = await client.query<{ table_schema: string; table_name: string }>(
    `SELECT table_schema, table_name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  const backupKeys = new Set(parsed.tables.keys());
  for (const target of targetTables.rows) {
    if (RESTORE_SKIPPED_TABLES.has(target.table_name)) continue;
    if (!backupKeys.has(tableKey(target.table_schema, target.table_name))) {
      missingTables.push(tableKey(target.table_schema, target.table_name));
    }
  }
  assertCount(missingTables.length === 0, `El backup no contiene tablas actuales: ${missingTables.join(", ")}.`);

  for (const table of parsed.tables.values()) {
    assertCount(await queryTableExists(client, table.schema, table.name), `La tabla ${tableKey(table.schema, table.name)} no existe en el target.`);
    const targetColumns = await queryColumns(client, table.schema, table.name);
    const missingColumns = table.columns.filter((column) => !targetColumns.has(column.name)).map((column) => column.name);
    assertCount(missingColumns.length === 0, `El target no tiene columnas de ${tableKey(table.schema, table.name)}: ${missingColumns.join(", ")}.`);
  }

  const requiredColumns: Record<string, string[]> = {
    User: ["id", "email", "active"],
    Client: ["id", "fullName"],
    Insurer: ["id", "name"],
    Policy: ["id", "clientId", "insurerId", "status", "endDate", "renewedFromPolicyId", "cancellationReason", "cancellationBatchId", "cancelledAt"],
    Receipt: ["id", "policyId", "clientId", "insurerId", "status", "cancellationReason", "cancellationBatchId", "cancelledAt"],
    Payment: ["id", "receiptId", "policyId", "clientId", "status", "reversedAt", "reversalReason"],
    Commission: ["id", "policyId", "clientId", "insurerId"],
    WorkItem: ["id", "entityType", "entityId", "sourceType", "sourceId"],
    Claim: ["id", "clientId", "policyId", "insurerId"],
    ActivityLog: ["id", "entityType", "entityId", "userId"],
    NotificationChannel: ["id", "userId", "type"],
    NotificationPreference: ["id", "userId", "eventType", "channelType"],
    NotificationEvent: ["id", "userId", "channelType"],
    SystemSetting: ["id", "key", "value"],
  };
  for (const [table, columns] of Object.entries(requiredColumns)) {
    const actual = await queryColumns(client, "public", table);
    assertCount(actual.size > 0, `Falta la tabla crítica public.${table}.`);
    const missing = columns.filter((column) => !actual.has(column));
    assertCount(missing.length === 0, `Faltan columnas críticas en public.${table}: ${missing.join(", ")}.`);
  }
  return { missingTables, requiredTables: Object.keys(requiredColumns) };
}

export async function validateTableCounts(
  client: PoolClient,
  parsed: ParsedBackup,
  manifestTables: Array<{ schema: string; name: string; rowCount: number }>,
  manifestTotalRows: number,
) {
  const manifestByKey = new Map(manifestTables.map((table) => [tableKey(table.schema, table.name), table.rowCount]));
  assertCount(manifestByKey.size === manifestTables.length, "El manifiesto contiene tablas repetidas.");
  assertCount(manifestTables.length === manifestTables.filter((table) => Number.isSafeInteger(table.rowCount) && table.rowCount >= 0).length, "El manifiesto contiene conteos inválidos.");
  const result: Record<string, TableCountResult> = {};
  let manifestSum = 0;
  let backupSum = 0;
  let restoredSum = 0;

  for (const [key, table] of parsed.tables) {
    const backupCount = parsed.rows.get(key)?.length ?? 0;
    const manifestCount = manifestByKey.get(key);
    const skipped = RESTORE_SKIPPED_TABLES.has(table.name);
    assertCount(manifestCount !== undefined, `Falta el conteo de ${key} en el manifiesto.`);
    const tableEnd = parsed.tableEnds.get(key);
    if (tableEnd !== undefined) assertCount(tableEnd === backupCount, `El cierre de ${key} no coincide con sus filas.`);
    assertCount(manifestCount === backupCount, `El conteo del backup y manifiesto no coincide en ${key}.`);
    manifestSum += manifestCount;
    backupSum += backupCount;

    let targetCount: number | null = null;
    if (!skipped) {
      const countResult = await client.query<QueryResultRow>(`SELECT count(*)::text AS count FROM ${tableReference(table.schema, table.name)}`);
      targetCount = Number(countResult.rows[0]?.count ?? "0");
      assertCount(Number.isSafeInteger(targetCount), `El conteo de ${key} no es representable de forma segura.`);
      assertCount(targetCount === backupCount, `El conteo restaurado no coincide en ${key}.`);
      restoredSum += targetCount;
    }
    result[key] = { backup: backupCount, manifest: manifestCount, target: targetCount, skipped };
  }

  for (const [key, manifestCount] of manifestByKey) {
    if (!parsed.tables.has(key)) throw new RestoreIntegrityError(`El manifiesto contiene una tabla ausente en el backup: ${key}.`);
    if (!Number.isSafeInteger(manifestCount) || manifestCount < 0) throw new RestoreIntegrityError(`Conteo inválido en manifiesto para ${key}.`);
  }
  assertCount(manifestSum === manifestTotalRows, "El total del manifiesto no coincide con sus conteos de tabla.");
  if (parsed.declaredTotalRows !== null) assertCount(parsed.declaredTotalRows === backupSum, "El total declarado por el backup no coincide con sus filas.");
  const skippedRows = [...Object.entries(result)].filter(([, value]) => value.skipped).reduce((sum, [, value]) => sum + value.backup, 0);
  assertCount(restoredSum === manifestTotalRows - skippedRows, "El total restaurado no coincide con el total esperado.");
  return { tables: result, totalRows: restoredSum, manifestTotalRows, skippedRows };
}

type ForeignKeyRow = {
  constraint_name: string;
  table_name: string;
  referenced_table: string;
  columns: string[];
  referenced_columns: string[];
};

export async function validateForeignKeys(client: PoolClient): Promise<ForeignKeyResult[]> {
  const foreignKeys = await client.query<ForeignKeyRow>(`
    SELECT
      constraint_definition.conname AS constraint_name,
      child.relname AS table_name,
      parent.relname AS referenced_table,
      array_agg(child_attr.attname ORDER BY key.position) AS columns,
      array_agg(parent_attr.attname ORDER BY key.position) AS referenced_columns
    FROM pg_constraint constraint_definition
    JOIN pg_class child ON child.oid = constraint_definition.conrelid
    JOIN pg_namespace child_namespace ON child_namespace.oid = child.relnamespace
    JOIN pg_class parent ON parent.oid = constraint_definition.confrelid
    JOIN LATERAL unnest(constraint_definition.conkey, constraint_definition.confkey)
      WITH ORDINALITY AS key(child_attnum, parent_attnum, position) ON true
    JOIN pg_attribute child_attr ON child_attr.attrelid = child.oid AND child_attr.attnum = key.child_attnum
    JOIN pg_attribute parent_attr ON parent_attr.attrelid = parent.oid AND parent_attr.attnum = key.parent_attnum
    WHERE constraint_definition.contype = 'f'
      AND child_namespace.nspname = 'public'
    GROUP BY constraint_definition.conname, child.relname, parent.relname
    ORDER BY constraint_name
  `);

  const results: ForeignKeyResult[] = [];
  for (const foreignKey of foreignKeys.rows) {
    const childAlias = "child_row";
    const parentAlias = "parent_row";
    const join = foreignKey.columns
      .map((column, index) => `${parentAlias}.${quoteIdentifier(foreignKey.referenced_columns[index])} = ${childAlias}.${quoteIdentifier(column)}`)
      .join(" AND ");
    const notNull = foreignKey.columns.map((column) => `${childAlias}.${quoteIdentifier(column)} IS NOT NULL`).join(" AND ");
    const firstParentColumn = quoteIdentifier(foreignKey.referenced_columns[0]);
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM ${tableReference("public", foreignKey.table_name)} ${childAlias}
         LEFT JOIN ${tableReference("public", foreignKey.referenced_table)} ${parentAlias} ON ${join}
        WHERE ${notNull} AND ${parentAlias}.${firstParentColumn} IS NULL`,
    );
    const orphanCount = Number(result.rows[0]?.count ?? "0");
    if (orphanCount > 0) {
      throw new RestoreIntegrityError(`La FK ${foreignKey.constraint_name} tiene ${orphanCount} huérfanos.`);
    }
    results.push({
      constraint: foreignKey.constraint_name,
      table: foreignKey.table_name,
      referencedTable: foreignKey.referenced_table,
      columns: foreignKey.columns,
      referencedColumns: foreignKey.referenced_columns,
      orphanCount,
    });
  }
  return results;
}

async function count(client: PoolClient, sql: string, values: unknown[] = []) {
  const result = await client.query<{ count: string }>(sql, values);
  return Number(result.rows[0]?.count ?? "0");
}

export async function validateDomainInvariants(client: PoolClient): Promise<DomainCheckResult[]> {
  const checks: DomainCheckResult[] = [];
  const add = (name: string, countValue: number, detail?: string) => {
    const check = { name, count: countValue, ok: countValue === 0, detail };
    checks.push(check);
    if (!check.ok) throw new RestoreIntegrityError(`${name} falló con ${countValue} registros.`);
  };

  add("payment_invalid_status", await count(client, `SELECT count(*)::text AS count FROM "Payment" WHERE status NOT IN ('POSTED', 'REVERSED')`));
  add("posted_payment_duplicate_receipt", await count(client, `SELECT count(*)::text AS count FROM (SELECT "receiptId" FROM "Payment" WHERE status = 'POSTED' GROUP BY "receiptId" HAVING count(*) > 1) duplicates`));
  add("posted_payment_has_reversal_metadata", await count(client, `SELECT count(*)::text AS count FROM "Payment" WHERE status = 'POSTED' AND ("reversedAt" IS NOT NULL OR "reversalReason" IS NOT NULL OR "reversedById" IS NOT NULL)`));
  add("reversed_payment_missing_timestamp", await count(client, `SELECT count(*)::text AS count FROM "Payment" WHERE status = 'REVERSED' AND "reversedAt" IS NULL`));
  add("reversed_payment_missing_reason", await count(client, `SELECT count(*)::text AS count FROM "Payment" WHERE status = 'REVERSED' AND NULLIF(btrim("reversalReason"), '') IS NULL`));
  add("posted_payment_missing_receipt_policy_client", await count(client, `
    SELECT count(*)::text AS count
      FROM "Payment" payment
      LEFT JOIN "Receipt" receipt ON receipt.id = payment."receiptId"
      LEFT JOIN "Policy" policy ON policy.id = payment."policyId"
      LEFT JOIN "Client" client ON client.id = payment."clientId"
     WHERE payment.status = 'POSTED'
       AND (receipt.id IS NULL OR policy.id IS NULL OR client.id IS NULL)`));
  add("policy_self_renewal", await count(client, `SELECT count(*)::text AS count FROM "Policy" WHERE "renewedFromPolicyId" = id`));
  add("policy_missing_end_date", await count(client, `SELECT count(*)::text AS count FROM "Policy" WHERE "endDate" IS NULL`));
  add("policy_active_with_cancellation_metadata", await count(client, `SELECT count(*)::text AS count FROM "Policy" WHERE status <> 'CANCELLED' AND ("cancelledAt" IS NOT NULL OR "cancellationBatchId" IS NOT NULL OR "cancellationReason" IS NOT NULL)`));
  add("policy_cancellation_batch_without_cancelled_status", await count(client, `SELECT count(*)::text AS count FROM "Policy" WHERE "cancellationBatchId" IS NOT NULL AND status <> 'CANCELLED'`));
  add("policy_cancellation_batch_wrong_reason", await count(client, `SELECT count(*)::text AS count FROM "Policy" WHERE "cancellationBatchId" IS NOT NULL AND "cancellationReason" IS DISTINCT FROM 'NON_PAYMENT'`));
  add("policy_cancellation_batch_missing_timestamp", await count(client, `SELECT count(*)::text AS count FROM "Policy" WHERE "cancellationBatchId" IS NOT NULL AND "cancelledAt" IS NULL`));
  add("receipt_active_with_cancellation_metadata", await count(client, `SELECT count(*)::text AS count FROM "Receipt" WHERE status <> 'CANCELLED' AND ("cancelledAt" IS NOT NULL OR "cancellationBatchId" IS NOT NULL OR "cancellationReason" IS NOT NULL)`));
  add("receipt_cancellation_batch_wrong_reason", await count(client, `SELECT count(*)::text AS count FROM "Receipt" WHERE "cancellationBatchId" IS NOT NULL AND "cancellationReason" IS DISTINCT FROM 'NON_PAYMENT'`));
  add("receipt_cancellation_batch_missing_timestamp", await count(client, `SELECT count(*)::text AS count FROM "Receipt" WHERE "cancellationBatchId" IS NOT NULL AND "cancelledAt" IS NULL`));
  add("notification_event_missing_user", await count(client, `SELECT count(*)::text AS count FROM "NotificationEvent" event LEFT JOIN "User" user_row ON user_row.id = event."userId" WHERE user_row.id IS NULL`));
  add("activity_log_missing_user", await count(client, `SELECT count(*)::text AS count FROM "ActivityLog" log LEFT JOIN "User" user_row ON user_row.id = log."userId" WHERE user_row.id IS NULL`));

  add("workitem_empty_entity_reference", await count(client, `SELECT count(*)::text AS count FROM "WorkItem" WHERE NULLIF(btrim("entityType"), '') IS NULL OR NULLIF(btrim("entityId"), '') IS NULL`));
  add("workitem_partial_source_reference", await count(client, `SELECT count(*)::text AS count FROM "WorkItem" WHERE ("sourceType" IS NULL) <> ("sourceId" IS NULL)`));
  add("workitem_duplicate_legacy_task", await count(client, `SELECT count(*)::text AS count FROM (SELECT "sourceId" FROM "WorkItem" WHERE "sourceType" = 'Task' GROUP BY "sourceId" HAVING count(*) > 1) duplicates`));
  add("workitem_missing_legacy_task", await count(client, `SELECT count(*)::text AS count FROM "WorkItem" work_item LEFT JOIN "Task" task ON task.id = work_item."sourceId" WHERE work_item."sourceType" = 'Task' AND task.id IS NULL`));
  add("workitem_missing_client_reference", await count(client, `SELECT count(*)::text AS count FROM "WorkItem" work_item LEFT JOIN "Client" row ON row.id = work_item."clientId" WHERE work_item."clientId" IS NOT NULL AND row.id IS NULL`));
  add("workitem_missing_policy_reference", await count(client, `SELECT count(*)::text AS count FROM "WorkItem" work_item LEFT JOIN "Policy" row ON row.id = work_item."policyId" WHERE work_item."policyId" IS NOT NULL AND row.id IS NULL`));
  add("workitem_missing_insurer_reference", await count(client, `SELECT count(*)::text AS count FROM "WorkItem" work_item LEFT JOIN "Insurer" row ON row.id = work_item."insurerId" WHERE work_item."insurerId" IS NOT NULL AND row.id IS NULL`));
  add("workitem_missing_receipt_reference", await count(client, `SELECT count(*)::text AS count FROM "WorkItem" work_item LEFT JOIN "Receipt" row ON row.id = work_item."receiptId" WHERE work_item."receiptId" IS NOT NULL AND row.id IS NULL`));
  add("workitem_missing_created_by_reference", await count(client, `SELECT count(*)::text AS count FROM "WorkItem" work_item LEFT JOIN "User" row ON row.id = work_item."createdById" WHERE work_item."createdById" IS NOT NULL AND row.id IS NULL`));
  add("workitem_missing_updated_by_reference", await count(client, `SELECT count(*)::text AS count FROM "WorkItem" work_item LEFT JOIN "User" row ON row.id = work_item."updatedById" WHERE work_item."updatedById" IS NOT NULL AND row.id IS NULL`));
  add("workitem_missing_assignee_reference", await count(client, `SELECT count(*)::text AS count FROM "WorkItem" work_item LEFT JOIN "User" row ON row.id = work_item."assignedToId" WHERE work_item."assignedToId" IS NOT NULL AND row.id IS NULL`));

  return checks;
}

export async function synchronizeSequences(client: PoolClient): Promise<SequenceSyncResult[]> {
  const serialColumns = await client.query<{
    table_schema: string;
    table_name: string;
    column_name: string;
    sequence_name: string | null;
  }>(`
    SELECT c.table_schema, c.table_name, c.column_name,
           pg_get_serial_sequence(format('%I.%I', c.table_schema, c.table_name), c.column_name) AS sequence_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND (c.column_default LIKE 'nextval(%' OR c.is_identity = 'YES')
     ORDER BY c.table_name, c.ordinal_position
  `);
  const results: SequenceSyncResult[] = [];
  for (const column of serialColumns.rows) {
    if (!column.sequence_name) continue;
    const boundsResult = await client.query<{ max_value: string | null; min_value: string | null }>(
      `SELECT max(${quoteIdentifier(column.column_name)})::text AS max_value,
              min(${quoteIdentifier(column.column_name)})::text AS min_value
         FROM ${tableReference(column.table_schema, column.table_name)}`,
    );
    const maxValue = boundsResult.rows[0]?.max_value ?? null;
    const minColumnValue = boundsResult.rows[0]?.min_value ?? null;
    const sequenceParts = column.sequence_name.split(".");
    const sequenceSchema = sequenceParts.length > 1 ? sequenceParts[0] : "public";
    const sequenceName = sequenceParts.length > 1 ? sequenceParts.slice(1).join(".") : sequenceParts[0];
    const sequence = await client.query<{ min_value: string; start_value: string; increment_by: string }>(
      `SELECT min_value::text, start_value::text, increment_by::text FROM pg_sequences WHERE schemaname = $1 AND sequencename = $2`,
      [sequenceSchema.replaceAll('"', ""), sequenceName.replaceAll('"', "")],
    );
    const minValue = sequence.rows[0]?.min_value ?? "1";
    const startValue = sequence.rows[0]?.start_value ?? minValue;
    const increment = BigInt(sequence.rows[0]?.increment_by ?? "1");
    const positiveIncrement = increment > BigInt(0);
    let safeBound: string | null = null;
    if (maxValue === null) {
      await client.query("SELECT setval($1::regclass, $2::bigint, false)", [column.sequence_name, startValue]);
    } else {
      safeBound = (positiveIncrement ? maxValue : minColumnValue) ?? maxValue;
      await client.query("SELECT setval($1::regclass, $2::bigint, true)", [column.sequence_name, safeBound]);
    }
    const nextValue = maxValue === null ? startValue : String(BigInt(safeBound ?? maxValue) + increment);
    results.push({
      table: tableKey(column.table_schema, column.table_name),
      column: column.column_name,
      sequence: column.sequence_name,
      maxValue,
      nextValue,
    });
  }
  return results;
}
