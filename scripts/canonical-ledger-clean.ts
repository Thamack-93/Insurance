#!/usr/bin/env tsx

import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import * as XLSX from "@e965/xlsx";

import {
  databasePath,
  ensureDataDirs,
  exportsDir,
  getFlag,
  hasFlag,
  parseCliArgs,
  readTabularInput,
  stagingDatabasePath,
  stagingDir,
  timestampForFile,
} from "./_shared";
import { toWorkbook } from "../src/lib/export";
import {
  normalizeMasterName,
  normalizePolicyNumber,
  normalizeReceiptNumber,
} from "../src/lib/master-folder";

type LedgerRow = Record<string, unknown>;

type NormalizedLedgerRow = {
  rowNumber: number;
  sourceRowId: string;
  policyNumber: string;
  receiptNumber: string;
  receiptKey: string;
  historyReceiptKey: string;
  clientName: string;
  clientKey: string;
  insurerName: string;
  insurerKey: string;
  policyType: string;
  description: string;
  descriptionKey: string;
  model: string;
  serial: string;
  serialKey: string;
  subramo: string;
  subramoKey: string;
  product: string;
  policyStart: string;
  policyEnd: string;
  periodStart: string;
  periodEnd: string;
  endorsementNumber: string;
  endorsementType: string;
  endorsementConcept: string;
  paymentFrequency: string;
  paid: boolean;
  paymentDate: string;
  currency: "MXN" | "USD";
  primaNeta: number;
  primaTotal: number;
  sourceStatus: string;
  receiptStatus: string;
  isAdjustment: boolean;
  rawPayload: string;
};

type PgIndexes = ReturnType<typeof loadPgIndexes>;

type CanonicalRows = {
  reviewBatchId: string;
  importId: string;
  sourceHash: string;
  sourcePath: string;
  sourceSummary: Record<string, unknown>;
  clients: Array<Record<string, unknown>>;
  insurers: Array<Record<string, unknown>>;
  policyGroups: Array<Record<string, unknown>>;
  policies: Array<Record<string, unknown>>;
  receipts: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
  history: Array<Record<string, unknown>>;
  adjustments: Array<Record<string, unknown>>;
  quarantine: Array<Record<string, unknown>>;
  snapshots: Array<Record<string, unknown>>;
  diffs: Array<Record<string, unknown>>;
  mergeSuggestions: Array<Record<string, unknown>>;
  promotionPreview: Array<Record<string, unknown>>;
  issues: Array<Record<string, unknown>>;
  documentEvidence: Array<Record<string, unknown>>;
  aliases: Array<Record<string, unknown>>;
};

const VISIBLE_SOURCE_LABEL = "Fuente externa";
const DEFAULT_LEDGER_PATH = path.join(os.homedir(), "Desktop", "DescargaSAPS.csv");
const MAX_LEDGER_BATCHES = 10;

const REQUIRED_COLUMNS = [
  "No. de Póliza",
  "No. Recibo",
  "Ini Vigencia Rec",
  "Fin Vigencia Rec",
  "No. de Endoso",
  "Tipo Endoso",
  "Concepto Endoso",
  "Tipo Póliza",
  "Cliente",
  "Descripción",
  "Modelo",
  "Serie",
  "Subramo",
  "Producto",
  "Clave Compañía",
  "Compañía",
  "Inicio Vigencia Póliza",
  "Fin Vigencia",
  "Frecuencia Pago",
  "Pagado",
  "Fecha aplicación",
  "Moneda",
  "Prima Neta Recibo",
  "Prima Total Recibo",
  "Estatus",
];

function cleanText(value: unknown) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function columnsFor(keys: string[]) {
  return keys.map((key) => ({ clave: key, etiqueta: key }));
}

function rowValue(row: LedgerRow, key: string) {
  return cleanText(row[key]);
}

function parseDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = cleanText(value);
  if (!text) return "";

  const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function parseMoney(value: unknown) {
  const text = cleanText(value).replace(/[$,\s]/g, "");
  if (!text) return 0;
  const amount = Number(text);
  return Number.isFinite(amount) ? amount : 0;
}

function normalizeCurrency(value: unknown): "MXN" | "USD" {
  const normalized = normalizeMasterName(cleanText(value));
  if (normalized.includes("DOLAR")) return "USD";
  return "MXN";
}

function toDbStatus(row: Pick<NormalizedLedgerRow, "sourceStatus" | "paid" | "periodEnd">) {
  if (row.sourceStatus === "CANCELADO") return "CANCELLED";
  if (row.paid || row.sourceStatus === "PAGADO") return "PAID";
  if (row.periodEnd && row.periodEnd < todayIso()) return "OVERDUE";
  return "PENDING";
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function policyState(row: Pick<NormalizedLedgerRow, "sourceStatus" | "policyEnd">) {
  if (row.sourceStatus === "CANCELADO") return "CERRADA";
  if (row.policyEnd && row.policyEnd < todayIso()) return "VENCIDA";
  return "OPERATIVA";
}

function policyTypeFromSubramo(value: string) {
  const normalized = normalizeMasterName(value);
  if (normalized.includes("AUTO")) return "Auto";
  if (normalized.includes("GMM") || normalized.includes("GASTOS MEDICOS")) return "GMM";
  if (normalized.includes("VIDA")) return "Vida";
  if (normalized.includes("DANO")) return "Daños";
  if (normalized.includes("ACCIDENT")) return "Accidentes";
  return value || "Otro";
}

function safeJson(value: unknown) {
  return JSON.stringify(value);
}

async function sha256(filePath: string) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function backupStagingDatabase() {
  await fs.mkdir(path.join(stagingDir, "backups"), { recursive: true });
  try {
    await fs.access(stagingDatabasePath);
  } catch {
    return "";
  }

  const backupPath = path.join(stagingDir, "backups", `canonical-before-ledger-${timestampForFile()}.sqlite`);
  await fs.copyFile(stagingDatabasePath, backupPath);
  return backupPath;
}

function tableColumns(db: Database.Database, tableName: string) {
  return new Set(
    (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map((column) => column.name),
  );
}

function addColumnIfMissing(db: Database.Database, tableName: string, columnName: string, definition: string) {
  const columns = tableColumns(db, tableName);
  if (columns.has(columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function ensureLedgerSchema(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS canonical_review_batch (
      review_batch_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      source_summary TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS canonical_client (
      review_batch_id TEXT NOT NULL,
      client_key TEXT NOT NULL,
      full_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      type TEXT NOT NULL,
      referidor_client_key TEXT NOT NULL DEFAULT '',
      referidor_name TEXT NOT NULL DEFAULT '',
      source_refs TEXT NOT NULL,
      source_priority_used TEXT NOT NULL,
      confidence REAL NOT NULL,
      clean_status TEXT NOT NULL,
      review_reason TEXT NOT NULL,
      review_decision TEXT NOT NULL DEFAULT '',
      review_value TEXT NOT NULL DEFAULT '',
      review_note TEXT NOT NULL DEFAULT '',
      lock_field TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (review_batch_id, client_key)
    );

    CREATE TABLE IF NOT EXISTS canonical_insurer (
      review_batch_id TEXT NOT NULL,
      insurer_key TEXT NOT NULL,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      source_refs TEXT NOT NULL,
      source_priority_used TEXT NOT NULL,
      confidence REAL NOT NULL,
      clean_status TEXT NOT NULL,
      review_reason TEXT NOT NULL,
      review_decision TEXT NOT NULL DEFAULT '',
      review_value TEXT NOT NULL DEFAULT '',
      review_note TEXT NOT NULL DEFAULT '',
      lock_field TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (review_batch_id, insurer_key)
    );

    CREATE TABLE IF NOT EXISTS canonical_policy (
      review_batch_id TEXT NOT NULL,
      policy_number TEXT NOT NULL,
      client_key TEXT NOT NULL DEFAULT '',
      client_name TEXT NOT NULL DEFAULT '',
      insurer_key TEXT NOT NULL DEFAULT '',
      insurer_name TEXT NOT NULL DEFAULT '',
      policy_type TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL DEFAULT '',
      end_date TEXT NOT NULL DEFAULT '',
      renewal_date TEXT NOT NULL DEFAULT '',
      premium_amount TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT 'MXN',
      source_refs TEXT NOT NULL,
      source_priority_used TEXT NOT NULL,
      confidence REAL NOT NULL,
      clean_status TEXT NOT NULL,
      review_reason TEXT NOT NULL,
      review_decision TEXT NOT NULL DEFAULT '',
      review_value TEXT NOT NULL DEFAULT '',
      review_note TEXT NOT NULL DEFAULT '',
      lock_field TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (review_batch_id, policy_number)
    );

    CREATE TABLE IF NOT EXISTS canonical_receipt (
      review_batch_id TEXT NOT NULL,
      receipt_key TEXT NOT NULL,
      policy_number TEXT NOT NULL DEFAULT '',
      receipt_number TEXT NOT NULL,
      client_key TEXT NOT NULL DEFAULT '',
      client_name TEXT NOT NULL DEFAULT '',
      insurer_key TEXT NOT NULL DEFAULT '',
      insurer_name TEXT NOT NULL DEFAULT '',
      amount TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT 'MXN',
      due_date TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      source_refs TEXT NOT NULL,
      source_priority_used TEXT NOT NULL,
      confidence REAL NOT NULL,
      clean_status TEXT NOT NULL,
      review_reason TEXT NOT NULL,
      review_decision TEXT NOT NULL DEFAULT '',
      review_value TEXT NOT NULL DEFAULT '',
      review_note TEXT NOT NULL DEFAULT '',
      lock_field TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (review_batch_id, receipt_key)
    );

    CREATE TABLE IF NOT EXISTS canonical_field_lock (
      lock_id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      field_name TEXT NOT NULL,
      locked_value TEXT NOT NULL,
      locked_by TEXT NOT NULL DEFAULT 'human',
      locked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS canonical_promotion_preview (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_batch_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      action TEXT NOT NULL,
      current_value TEXT NOT NULL DEFAULT '',
      proposed_value TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL,
      clean_status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS canonical_review_issue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_batch_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      field_name TEXT NOT NULL,
      severity TEXT NOT NULL,
      reason TEXT NOT NULL,
      suggested_value TEXT NOT NULL DEFAULT '',
      source_refs TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS canonical_document_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_batch_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      source TEXT NOT NULL,
      evidence_ref TEXT NOT NULL,
      detail TEXT NOT NULL,
      confidence REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS canonical_alias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_batch_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      alias_value TEXT NOT NULL,
      normalized_alias TEXT NOT NULL,
      canonical_value TEXT NOT NULL,
      source_refs TEXT NOT NULL,
      confidence REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS canonical_policy_group (
      review_batch_id TEXT NOT NULL,
      group_key TEXT NOT NULL,
      display_name TEXT NOT NULL,
      client_key TEXT NOT NULL,
      client_name TEXT NOT NULL,
      insurer_key TEXT NOT NULL,
      insurer_name TEXT NOT NULL,
      subramo TEXT NOT NULL,
      serial TEXT NOT NULL DEFAULT '',
      description_key TEXT NOT NULL DEFAULT '',
      identity_strength TEXT NOT NULL,
      principal_policy_number TEXT NOT NULL,
      principal_state TEXT NOT NULL,
      policy_count INTEGER NOT NULL,
      requires_human_approval INTEGER NOT NULL DEFAULT 0,
      review_decision TEXT NOT NULL DEFAULT '',
      review_note TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (review_batch_id, group_key)
    );

    CREATE TABLE IF NOT EXISTS canonical_payment_candidate (
      review_batch_id TEXT NOT NULL,
      payment_key TEXT NOT NULL,
      receipt_key TEXT NOT NULL,
      policy_number TEXT NOT NULL,
      receipt_number TEXT NOT NULL,
      client_key TEXT NOT NULL,
      client_name TEXT NOT NULL,
      amount TEXT NOT NULL,
      currency TEXT NOT NULL,
      paid_date TEXT NOT NULL,
      status TEXT NOT NULL,
      review_reason TEXT NOT NULL DEFAULT '',
      review_decision TEXT NOT NULL DEFAULT '',
      review_note TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (review_batch_id, payment_key)
    );

    CREATE TABLE IF NOT EXISTS canonical_policy_history (
      review_batch_id TEXT NOT NULL,
      history_key TEXT NOT NULL,
      policy_number TEXT NOT NULL,
      receipt_number TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      client_key TEXT NOT NULL,
      client_name TEXT NOT NULL,
      insurer_key TEXT NOT NULL,
      insurer_name TEXT NOT NULL,
      policy_type TEXT NOT NULL,
      status TEXT NOT NULL,
      currency TEXT NOT NULL,
      prima_neta TEXT NOT NULL,
      prima_total TEXT NOT NULL,
      source_row_id TEXT NOT NULL,
      searchable_label TEXT NOT NULL,
      PRIMARY KEY (review_batch_id, history_key)
    );

    CREATE TABLE IF NOT EXISTS canonical_adjustment_evidence (
      review_batch_id TEXT NOT NULL,
      adjustment_key TEXT NOT NULL,
      policy_number TEXT NOT NULL,
      receipt_number TEXT NOT NULL,
      client_name TEXT NOT NULL,
      endorsement_number TEXT NOT NULL,
      endorsement_type TEXT NOT NULL,
      endorsement_concept TEXT NOT NULL,
      prima_neta TEXT NOT NULL,
      prima_total TEXT NOT NULL,
      status TEXT NOT NULL,
      source_row_id TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      PRIMARY KEY (review_batch_id, adjustment_key)
    );

    CREATE TABLE IF NOT EXISTS canonical_quarantine (
      review_batch_id TEXT NOT NULL,
      quarantine_key TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      reason TEXT NOT NULL,
      source_refs TEXT NOT NULL DEFAULT '',
      detail_json TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (review_batch_id, quarantine_key)
    );

    CREATE TABLE IF NOT EXISTS external_ledger_import (
      import_id TEXT PRIMARY KEY,
      review_batch_id TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      source_path TEXT NOT NULL,
      imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      unique_policies INTEGER NOT NULL,
      unique_receipts INTEGER NOT NULL,
      unique_clients INTEGER NOT NULL,
      summary_json TEXT NOT NULL
    );

    DROP INDEX IF EXISTS idx_external_ledger_import_hash;
    CREATE INDEX IF NOT EXISTS idx_external_ledger_import_hash ON external_ledger_import(file_hash);

    CREATE TABLE IF NOT EXISTS external_ledger_snapshot (
      review_batch_id TEXT NOT NULL,
      snapshot_key TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      normalized_json TEXT NOT NULL,
      source_row_id TEXT NOT NULL,
      PRIMARY KEY (review_batch_id, snapshot_key)
    );

    CREATE TABLE IF NOT EXISTS canonical_batch_diff (
      review_batch_id TEXT NOT NULL,
      diff_key TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      diff_type TEXT NOT NULL,
      previous_value TEXT NOT NULL DEFAULT '',
      current_value TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (review_batch_id, diff_key)
    );

    CREATE TABLE IF NOT EXISTS canonical_merge_suggestion (
      review_batch_id TEXT NOT NULL,
      suggestion_key TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      left_key TEXT NOT NULL,
      right_key TEXT NOT NULL,
      left_label TEXT NOT NULL,
      right_label TEXT NOT NULL,
      reason TEXT NOT NULL,
      score REAL NOT NULL,
      review_decision TEXT NOT NULL DEFAULT '',
      review_note TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (review_batch_id, suggestion_key)
    );

    CREATE TABLE IF NOT EXISTS canonical_merge_rule (
      rule_id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      source_key TEXT NOT NULL,
      target_key TEXT NOT NULL,
      approved_by TEXT NOT NULL DEFAULT 'human',
      approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      note TEXT NOT NULL DEFAULT ''
    );
  `);

  for (const [tableName, columns] of Object.entries({
    canonical_policy: {
      policy_group_key: "TEXT NOT NULL DEFAULT ''",
      operational_state: "TEXT NOT NULL DEFAULT ''",
      prima_neta: "TEXT NOT NULL DEFAULT ''",
      prima_total: "TEXT NOT NULL DEFAULT ''",
      is_operational: "INTEGER NOT NULL DEFAULT 0",
      is_historical: "INTEGER NOT NULL DEFAULT 0",
      missing_document_issue: "INTEGER NOT NULL DEFAULT 0",
      group_review_status: "TEXT NOT NULL DEFAULT ''",
      payment_frequency: "TEXT NOT NULL DEFAULT ''",
      insured_object: "TEXT NOT NULL DEFAULT ''",
      serial: "TEXT NOT NULL DEFAULT ''",
    },
    canonical_receipt: {
      period_start: "TEXT NOT NULL DEFAULT ''",
      period_end: "TEXT NOT NULL DEFAULT ''",
      prima_neta: "TEXT NOT NULL DEFAULT ''",
      prima_total: "TEXT NOT NULL DEFAULT ''",
      payment_date: "TEXT NOT NULL DEFAULT ''",
      is_operational: "INTEGER NOT NULL DEFAULT 0",
      is_historical: "INTEGER NOT NULL DEFAULT 0",
    },
  })) {
    for (const [columnName, definition] of Object.entries(columns)) {
      addColumnIfMissing(db, tableName, columnName, definition);
    }
  }
}

function validateLedgerSchema(rows: LedgerRow[]) {
  const headers = new Set(Object.keys(rows[0] ?? {}));
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.has(column));
  const extra = [...headers].filter((column) => !REQUIRED_COLUMNS.includes(column));
  return { missing, extra };
}

async function writeErrorWorkbook(outPath: string, summary: Record<string, unknown>[], details: Record<string, unknown>[]) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  XLSX.writeFile(
    toWorkbook([
      { nombre: "Resumen", columnas: columnsFor(["tipo", "mensaje", "valor"]), filas: summary },
      { nombre: "Detalle", columnas: columnsFor(Object.keys(details[0] ?? { tipo: "", detalle: "" })), filas: details },
    ]),
    outPath,
    { bookType: "xlsx" },
  );
}

async function failWithWorkbook(message: string, details: Record<string, unknown>[]) {
  const outPath = path.join(exportsDir, `canonical-ledger-error-${timestampForFile()}.xlsx`);
  await writeErrorWorkbook(outPath, [{ tipo: "error", mensaje: message, valor: outPath }], details);
  throw new Error(`${message}. Reporte: ${outPath}`);
}

function normalizeLedgerRow(row: LedgerRow, index: number): NormalizedLedgerRow {
  const policyNumber = normalizePolicyNumber(rowValue(row, "No. de Póliza"));
  const receiptNumber = normalizeReceiptNumber(rowValue(row, "No. Recibo"));
  const periodStart = parseDate(row["Ini Vigencia Rec"]);
  const periodEnd = parseDate(row["Fin Vigencia Rec"]);
  const clientName = rowValue(row, "Cliente");
  const insurerName = rowValue(row, "Compañía");
  const description = rowValue(row, "Descripción");
  const serial = normalizePolicyNumber(rowValue(row, "Serie"));
  const subramo = rowValue(row, "Subramo");
  const primaNeta = parseMoney(row["Prima Neta Recibo"]);
  const primaTotal = parseMoney(row["Prima Total Recibo"]);
  const endorsementType = normalizeMasterName(rowValue(row, "Tipo Endoso"));
  const sourceStatus = normalizeMasterName(rowValue(row, "Estatus"));
  const paid = normalizeMasterName(rowValue(row, "Pagado")) === "SI" || sourceStatus === "PAGADO";

  const normalized: NormalizedLedgerRow = {
    rowNumber: index + 2,
    sourceRowId: `Fuente externa:${index + 2}`,
    policyNumber,
    receiptNumber,
    receiptKey: `${policyNumber}:${receiptNumber}`,
    historyReceiptKey: `${policyNumber}:${receiptNumber}:${periodStart}:${periodEnd}`,
    clientName,
    clientKey: normalizeMasterName(clientName),
    insurerName,
    insurerKey: normalizeMasterName(insurerName),
    policyType: policyTypeFromSubramo(subramo),
    description,
    descriptionKey: normalizeMasterName(description).slice(0, 120),
    model: rowValue(row, "Modelo"),
    serial,
    serialKey: serial,
    subramo,
    subramoKey: normalizeMasterName(subramo),
    product: rowValue(row, "Producto"),
    policyStart: parseDate(row["Inicio Vigencia Póliza"]),
    policyEnd: parseDate(row["Fin Vigencia"]),
    periodStart,
    periodEnd,
    endorsementNumber: rowValue(row, "No. de Endoso"),
    endorsementType,
    endorsementConcept: rowValue(row, "Concepto Endoso"),
    paymentFrequency: rowValue(row, "Frecuencia Pago"),
    paid,
    paymentDate: parseDate(row["Fecha aplicación"]),
    currency: normalizeCurrency(row["Moneda"]),
    primaNeta,
    primaTotal,
    sourceStatus,
    receiptStatus: "PENDING",
    isAdjustment: Boolean(endorsementType || primaNeta < 0 || primaTotal < 0),
    rawPayload: safeJson(row),
  };
  normalized.receiptStatus = toDbStatus(normalized);
  return normalized;
}

function loadPgIndexes() {
  const pg = new Database(databasePath, { readonly: true });
  try {
    const clients = pg.prepare(`SELECT id, fullName FROM Client`).all() as Array<{ id: string; fullName: string }>;
    const insurers = pg.prepare(`SELECT id, name FROM Insurer`).all() as Array<{ id: string; name: string }>;
    const policies = pg.prepare(`
      SELECT p.id, p.policyNumber, p.status, p.startDate, p.endDate, p.premiumAmount, p.currency,
             c.fullName AS clientName, i.name AS insurerName
      FROM Policy p
      JOIN Client c ON c.id = p.clientId
      JOIN Insurer i ON i.id = p.insurerId
    `).all() as Array<Record<string, unknown>>;
    const receipts = pg.prepare(`
      SELECT r.id, r.receiptNumber, r.status, r.amount, r.currency, r.dueDate, r.periodStartDate, r.periodEndDate,
             r.paidDate, p.policyNumber
      FROM Receipt r
      JOIN Policy p ON p.id = r.policyId
    `).all() as Array<Record<string, unknown>>;
    const payments = pg.prepare(`
      SELECT pay.id, pay.amount, pay.currency, pay.paidDate, pay.receiptId, r.receiptNumber, p.policyNumber
      FROM Payment pay
      JOIN Receipt r ON r.id = pay.receiptId
      JOIN Policy p ON p.id = pay.policyId
    `).all() as Array<Record<string, unknown>>;

    return {
      clients,
      insurers,
      policies,
      receipts,
      payments,
      clientsByKey: new Map(clients.map((client) => [normalizeMasterName(client.fullName), client])),
      insurersByKey: new Map(insurers.map((insurer) => [normalizeMasterName(insurer.name), insurer])),
      policiesByKey: new Map(policies.map((policy) => [normalizePolicyNumber(String(policy.policyNumber ?? "")), policy])),
      receiptsByKey: new Map(receipts.map((receipt) => [`${normalizePolicyNumber(String(receipt.policyNumber ?? ""))}:${normalizeReceiptNumber(String(receipt.receiptNumber ?? ""))}`, receipt])),
      paymentsByKey: new Map(payments.map((payment) => [`${normalizePolicyNumber(String(payment.policyNumber ?? ""))}:${normalizeReceiptNumber(String(payment.receiptNumber ?? ""))}:${parseDate(payment.paidDate)}`, payment])),
    };
  } finally {
    pg.close();
  }
}

function canonicalInsurerName(insurerName: string, pg: PgIndexes) {
  const normalized = normalizeMasterName(insurerName);
  const exact = pg.insurersByKey.get(normalized);
  if (exact) return String(exact.name);
  const compact = normalized
    .replace(/\b(SEGUROS?|COMPANIA|COMPANIA DE SEGUROS|S A|SA|DE|C V|CV|GRUPO|FINANCIERO)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const fuzzy = pg.insurers.find((insurer) => normalizeMasterName(insurer.name).includes(compact) || compact.includes(normalizeMasterName(insurer.name)));
  return fuzzy?.name ?? insurerName;
}

function groupRows<T>(rows: T[], keyFn: (row: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFn(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return grouped;
}

function uniqueRowsBy<T>(rows: T[], keyFn: (row: T) => string) {
  const unique = new Map<string, T>();
  for (const row of rows) unique.set(keyFn(row), row);
  return [...unique.values()];
}

function latestByPolicyEnd(rows: NormalizedLedgerRow[]) {
  return [...rows].sort((left, right) => {
    const byEnd = right.policyEnd.localeCompare(left.policyEnd);
    if (byEnd) return byEnd;
    return right.periodEnd.localeCompare(left.periodEnd);
  })[0];
}

function hasDocumentEvidence(policyNumber: string, evidenceRecords: Array<{ evidence_ref?: string; detail?: string }>) {
  const normalizedPolicy = normalizePolicyNumber(policyNumber);
  if (!normalizedPolicy) return false;
  return evidenceRecords.some((record) => {
    const haystack = normalizePolicyNumber(`${record.evidence_ref ?? ""} ${record.detail ?? ""}`);
    return haystack.includes(normalizedPolicy);
  });
}

function loadDocumentEvidence(db: Database.Database) {
  try {
    return db.prepare(`
      SELECT evidence_ref, detail
      FROM canonical_document_evidence
      WHERE lower(evidence_ref) LIKE '%.pdf%' OR lower(detail) LIKE '%.pdf%'
    `).all() as Array<{ evidence_ref?: string; detail?: string }>;
  } catch {
    return [];
  }
}

function buildMergeSuggestions(reviewBatchId: string, clients: Array<Record<string, unknown>>, policyRows: NormalizedLedgerRow[]) {
  const suggestions: Array<Record<string, unknown>> = [];
  const clientRows = clients.map((client) => ({
    key: String(client.client_key),
    label: String(client.full_name),
    tokens: new Set(String(client.normalized_name).split(" ").filter((token) => token.length > 2)),
  }));

  for (let leftIndex = 0; leftIndex < clientRows.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < clientRows.length; rightIndex += 1) {
      const left = clientRows[leftIndex];
      const right = clientRows[rightIndex];
      if (left.key === right.key) continue;
      const intersection = [...left.tokens].filter((token) => right.tokens.has(token)).length;
      const union = new Set([...left.tokens, ...right.tokens]).size || 1;
      const score = Math.round((intersection / union) * 100);
      if (score < 72) continue;
      suggestions.push({
        review_batch_id: reviewBatchId,
        suggestion_key: `CLIENTE:${left.key}:${right.key}`,
        entity_type: "CLIENTE",
        left_key: left.key,
        right_key: right.key,
        left_label: left.label,
        right_label: right.label,
        reason: "Nombres similares; requiere aprobacion humana antes de mezclar.",
        score,
        review_decision: "",
        review_note: "",
      });
    }
  }

  const bySuggestedGroup = groupRows(
    policyRows.filter((row) => !row.serialKey),
    (row) => `${row.clientKey}:${row.insurerKey}:${row.subramoKey}:${row.descriptionKey}`,
  );
  for (const [suggestedKey, rows] of bySuggestedGroup) {
    const policies = [...new Set(rows.map((row) => row.policyNumber))];
    if (policies.length < 2) continue;
    for (let index = 0; index < policies.length - 1; index += 1) {
      suggestions.push({
        review_batch_id: reviewBatchId,
        suggestion_key: `POLIZA_GRUPO:${suggestedKey}:${policies[index]}:${policies[index + 1]}`,
        entity_type: "POLIZA_GRUPO",
        left_key: policies[index],
        right_key: policies[index + 1],
        left_label: policies[index],
        right_label: policies[index + 1],
        reason: "Misma descripcion sin serie/VIN; sugerencia para comparativa, no fusion automatica.",
        score: 80,
        review_decision: "",
        review_note: "",
      });
    }
  }

  return suggestions;
}

function buildDiffs(db: Database.Database, reviewBatchId: string, snapshots: Array<Record<string, unknown>>) {
  const previousBatch = db
    .prepare(`
      SELECT review_batch_id
      FROM external_ledger_import
      WHERE status = 'COMPLETED'
      ORDER BY imported_at DESC
      LIMIT 1
    `)
    .get() as { review_batch_id?: string } | undefined;

  if (!previousBatch?.review_batch_id) {
    return snapshots.map((snapshot) => ({
      review_batch_id: reviewBatchId,
      diff_key: `${snapshot.snapshot_key}:first_run`,
      entity_type: snapshot.entity_type,
      entity_key: snapshot.entity_key,
      diff_type: "nuevo",
      previous_value: "",
      current_value: snapshot.normalized_json,
      reason: "Primera corrida versionada.",
    }));
  }

  const previousRows = db
    .prepare(`SELECT entity_type, entity_key, normalized_json FROM external_ledger_snapshot WHERE review_batch_id = ?`)
    .all(previousBatch.review_batch_id) as Array<{ entity_type: string; entity_key: string; normalized_json: string }>;
  const previous = new Map(previousRows.map((row) => [`${row.entity_type}:${row.entity_key}`, row.normalized_json]));
  const current = new Map(snapshots.map((row) => [`${row.entity_type}:${row.entity_key}`, String(row.normalized_json)]));
  const diffs: Array<Record<string, unknown>> = [];

  for (const snapshot of snapshots) {
    const key = `${snapshot.entity_type}:${snapshot.entity_key}`;
    const previousValue = previous.get(key);
    const currentValue = String(snapshot.normalized_json);
    const diffType = !previousValue ? "nuevo" : previousValue === currentValue ? "igual" : "cambiado";
    diffs.push({
      review_batch_id: reviewBatchId,
      diff_key: `${snapshot.snapshot_key}:${diffType}`,
      entity_type: snapshot.entity_type,
      entity_key: snapshot.entity_key,
      diff_type: diffType,
      previous_value: previousValue ?? "",
      current_value: currentValue,
      reason: diffType === "cambiado" ? "Cambios detectados contra corrida anterior." : "",
    });
  }

  for (const [key, previousValue] of previous.entries()) {
    if (current.has(key)) continue;
    const [entityType, entityKey] = key.split(/:(.*)/s);
    diffs.push({
      review_batch_id: reviewBatchId,
      diff_key: `${entityType}:${entityKey}:missing`,
      entity_type: entityType,
      entity_key: entityKey,
      diff_type: "ya_no_aparece",
      previous_value: previousValue,
      current_value: "",
      reason: "Existia en la corrida anterior y no aparece en esta fuente.",
    });
  }

  return diffs;
}

function buildCanonicalRows(db: Database.Database, rows: NormalizedLedgerRow[], reviewBatchId: string, importId: string, sourceHash: string, sourcePath: string): CanonicalRows {
  const pg = loadPgIndexes();
  const evidenceRecords = loadDocumentEvidence(db);
  const clients = new Map<string, Record<string, unknown>>();
  const insurers = new Map<string, Record<string, unknown>>();
  const policyGroups = new Map<string, Record<string, unknown>>();
  const policies = new Map<string, Record<string, unknown>>();
  const receipts = new Map<string, Record<string, unknown>>();
  const payments = new Map<string, Record<string, unknown>>();
  const history: Array<Record<string, unknown>> = [];
  const adjustments: Array<Record<string, unknown>> = [];
  const quarantine: Array<Record<string, unknown>> = [];
  const snapshots: Array<Record<string, unknown>> = [];
  const promotionPreview: Array<Record<string, unknown>> = [];
  const issues: Array<Record<string, unknown>> = [];
  const documentEvidence: Array<Record<string, unknown>> = [];
  const aliases: Array<Record<string, unknown>> = [];

  const sourceRows = rows.filter((row) => row.policyNumber && row.clientKey && row.insurerKey);
  for (const row of rows.filter((candidate) => !sourceRows.includes(candidate))) {
    quarantine.push({
      review_batch_id: reviewBatchId,
      quarantine_key: `row:${row.rowNumber}`,
      entity_type: "FILA",
      entity_key: row.sourceRowId,
      reason: "Fila sin poliza, cliente o aseguradora confiable.",
      source_refs: row.sourceRowId,
      detail_json: row.rawPayload,
    });
  }

  for (const row of sourceRows) {
    const canonicalInsurer = canonicalInsurerName(row.insurerName, pg);
    const canonicalInsurerKey = normalizeMasterName(canonicalInsurer);
    clients.set(row.clientKey, {
      review_batch_id: reviewBatchId,
      client_key: row.clientKey,
      full_name: row.clientName,
      normalized_name: row.clientKey,
      type: /\b(SA|SAPI|S DE RL|SC|CV)\b/.test(row.clientKey) ? "COMPANY" : "PERSON",
      referidor_client_key: "",
      referidor_name: "",
      source_refs: VISIBLE_SOURCE_LABEL,
      source_priority_used: "external_ledger",
      confidence: 95,
      clean_status: pg.clientsByKey.has(row.clientKey) ? "existing" : "candidate",
      review_reason: pg.clientsByKey.has(row.clientKey) ? "" : "Cliente nuevo; requiere aprobacion explicita.",
      review_decision: "",
      review_value: "",
      review_note: "",
      lock_field: "",
    });
    insurers.set(canonicalInsurerKey, {
      review_batch_id: reviewBatchId,
      insurer_key: canonicalInsurerKey,
      name: canonicalInsurer,
      normalized_name: canonicalInsurerKey,
      source_refs: VISIBLE_SOURCE_LABEL,
      source_priority_used: "external_ledger",
      confidence: pg.insurersByKey.has(canonicalInsurerKey) ? 100 : 80,
      clean_status: pg.insurersByKey.has(canonicalInsurerKey) ? "existing" : "needs_review",
      review_reason: pg.insurersByKey.has(canonicalInsurerKey) ? "" : "Aseguradora no existe en catalogo actual.",
      review_decision: "",
      review_value: "",
      review_note: "",
      lock_field: "",
    });
    if (normalizeMasterName(row.insurerName) !== canonicalInsurerKey) {
      aliases.push({
        review_batch_id: reviewBatchId,
        entity_type: "ASEGURADORA",
        entity_key: canonicalInsurerKey,
        alias_value: row.insurerName,
        normalized_alias: normalizeMasterName(row.insurerName),
        canonical_value: canonicalInsurer,
        source_refs: VISIBLE_SOURCE_LABEL,
        confidence: 85,
      });
    }
  }

  const policyRows = groupRows(sourceRows, (row) => row.policyNumber);
  const policyRepresentatives = [...policyRows.values()].map((group) => latestByPolicyEnd(group));
  const groupKeyByPolicy = new Map<string, string>();
  const groupedPolicies = groupRows(policyRepresentatives, (row) => {
    if (row.serialKey) {
      return `STRONG:${row.clientKey}:${row.insurerKey}:${row.subramoKey}:${row.serialKey}`;
    }
    return `POLICY:${row.policyNumber}`;
  });

  for (const [groupKey, groupPolicies] of groupedPolicies) {
    const principal = latestByPolicyEnd(groupPolicies);
    const state = policyState(principal);
    for (const row of groupPolicies) groupKeyByPolicy.set(row.policyNumber, groupKey);
    policyGroups.set(groupKey, {
      review_batch_id: reviewBatchId,
      group_key: groupKey,
      display_name: `${principal.clientName} · ${principal.subramo || principal.policyType} · ${principal.serial || principal.policyNumber}`,
      client_key: principal.clientKey,
      client_name: principal.clientName,
      insurer_key: normalizeMasterName(canonicalInsurerName(principal.insurerName, pg)),
      insurer_name: canonicalInsurerName(principal.insurerName, pg),
      subramo: principal.subramo,
      serial: principal.serial,
      description_key: principal.descriptionKey,
      identity_strength: principal.serial ? "strong_serial" : "policy_only",
      principal_policy_number: principal.policyNumber,
      principal_state: state,
      policy_count: groupPolicies.length,
      requires_human_approval: principal.serial ? 0 : 0,
      review_decision: "",
      review_note: "",
    });
  }

  for (const [policyNumber, policyGroupRows] of policyRows) {
    const representative = latestByPolicyEnd(policyGroupRows);
    const groupKey = groupKeyByPolicy.get(policyNumber) ?? `POLICY:${policyNumber}`;
    const group = policyGroups.get(groupKey);
    const isPrincipal = group?.principal_policy_number === policyNumber;
    const state = policyState(representative);
    const isClosedOnly = !pg.policiesByKey.has(policyNumber) && state === "CERRADA";
    const hasPdf = hasDocumentEvidence(policyNumber, evidenceRecords);
    const cleanStatus = isPrincipal && !isClosedOnly ? "candidate" : "historical";
    const reviewReasons = [
      !hasPdf ? "Documento PDF no localizado; generar alerta de documento faltante." : "",
      isClosedOnly ? "Poliza cerrada solo presente en fuente externa; historico buscable." : "",
    ].filter(Boolean);

    if (isPrincipal && !isClosedOnly) {
      policies.set(policyNumber, {
        review_batch_id: reviewBatchId,
        policy_number: policyNumber,
        client_key: representative.clientKey,
        client_name: representative.clientName,
        insurer_key: normalizeMasterName(canonicalInsurerName(representative.insurerName, pg)),
        insurer_name: canonicalInsurerName(representative.insurerName, pg),
        policy_type: representative.policyType,
        status: state,
        start_date: representative.policyStart,
        end_date: representative.policyEnd,
        renewal_date: representative.policyEnd,
        premium_amount: String(representative.primaTotal),
        currency: representative.currency,
        source_refs: VISIBLE_SOURCE_LABEL,
        source_priority_used: "external_ledger",
        confidence: 95,
        clean_status: cleanStatus,
        review_reason: reviewReasons.join(" | "),
        review_decision: "",
        review_value: "",
        review_note: "",
        lock_field: "",
        policy_group_key: groupKey,
        operational_state: state,
        prima_neta: String(representative.primaNeta),
        prima_total: String(representative.primaTotal),
        is_operational: state !== "CERRADA" ? 1 : 0,
        is_historical: 0,
        missing_document_issue: hasPdf ? 0 : 1,
        group_review_status: "approved_by_strong_rule",
        payment_frequency: representative.paymentFrequency,
        insured_object: representative.description,
        serial: representative.serial,
      });
    }

    if (!hasPdf) {
      issues.push({
        review_batch_id: reviewBatchId,
        entity_type: "POLIZA",
        entity_key: policyNumber,
        field_name: "document",
        severity: "warning",
        reason: "Poliza limpia sin PDF/documento localizado.",
        suggested_value: "Agregar documento o confirmar que no existe.",
        source_refs: VISIBLE_SOURCE_LABEL,
      });
    }

    const existingPolicy = pg.policiesByKey.get(policyNumber);
    const proposedValue = `${representative.clientName} | ${canonicalInsurerName(representative.insurerName, pg)} | ${representative.policyStart} | ${representative.policyEnd} | ${representative.primaTotal}`;
    let action = "historical";
    let reason = reviewReasons.join(" | ");
    if (isPrincipal && !isClosedOnly) {
      action = existingPolicy ? "unchanged" : "create";
      const currentValue = existingPolicy
        ? `${existingPolicy.clientName} | ${existingPolicy.insurerName} | ${parseDate(existingPolicy.startDate)} | ${parseDate(existingPolicy.endDate)} | ${existingPolicy.premiumAmount}`
        : "";
      if (existingPolicy && currentValue !== proposedValue) {
        action = "update";
        reason = [reason, "Diferencia contra DB; requiere aprobacion explicita."].filter(Boolean).join(" | ");
      }
    }
    promotionPreview.push({
      review_batch_id: reviewBatchId,
      entity_type: "POLIZA",
      entity_key: policyNumber,
      action,
      current_value: existingPolicy ? `${existingPolicy.clientName} | ${existingPolicy.insurerName}` : "",
      proposed_value: proposedValue,
      reason,
      clean_status: cleanStatus,
    });
  }

  for (const row of sourceRows) {
    const state = policyState(row);
    const shouldKeepHistory =
      !row.isAdjustment ||
      (pg.receiptsByKey.has(row.receiptKey) && !history.some((historyRow) => historyRow.history_key === row.historyReceiptKey));
    if (shouldKeepHistory) {
      history.push({
        review_batch_id: reviewBatchId,
        history_key: row.historyReceiptKey,
        policy_number: row.policyNumber,
        receipt_number: row.receiptNumber,
        period_start: row.periodStart,
        period_end: row.periodEnd,
        client_key: row.clientKey,
        client_name: row.clientName,
        insurer_key: normalizeMasterName(canonicalInsurerName(row.insurerName, pg)),
        insurer_name: canonicalInsurerName(row.insurerName, pg),
        policy_type: row.policyType,
        status: state === "CERRADA" ? "CERRADA" : row.receiptStatus,
        currency: row.currency,
        prima_neta: String(row.primaNeta),
        prima_total: String(row.primaTotal),
        source_row_id: row.sourceRowId,
        searchable_label: `${row.policyNumber} · ${row.clientName} · Histórico`,
      });
    }

    snapshots.push({
      review_batch_id: reviewBatchId,
      snapshot_key: `row:${row.rowNumber}`,
      entity_type: "REGISTRO_FUENTE",
      entity_key: row.sourceRowId,
      normalized_json: safeJson(row),
      source_row_id: row.sourceRowId,
    });
    snapshots.push({
      review_batch_id: reviewBatchId,
      snapshot_key: `policy:${row.policyNumber}`,
      entity_type: "POLIZA",
      entity_key: row.policyNumber,
      normalized_json: safeJson({
        policyNumber: row.policyNumber,
        clientName: row.clientName,
        insurerName: canonicalInsurerName(row.insurerName, pg),
        policyStart: row.policyStart,
        policyEnd: row.policyEnd,
        status: state,
      }),
      source_row_id: row.sourceRowId,
    });
  }

  const receiptRows = sourceRows.filter((row) => !row.isAdjustment);
  const receiptsByKey = groupRows(receiptRows, (row) => row.receiptKey);
  for (const [receiptKey, grouped] of receiptsByKey) {
    const chosen = [...grouped].sort((left, right) => right.periodEnd.localeCompare(left.periodEnd))[0];
    const policy = policies.get(chosen.policyNumber);
    const existsInDb = pg.receiptsByKey.has(receiptKey);
    if (!policy && !existsInDb) continue;

    const signatures = new Set(grouped.map((row) => `${row.periodStart}:${row.periodEnd}:${row.primaNeta}:${row.primaTotal}:${row.receiptStatus}`));
    const reviewReason = signatures.size > 1 ? "Duplicado con diferencias de periodo, importe o estatus; requiere revision." : "";
    receipts.set(receiptKey, {
      review_batch_id: reviewBatchId,
      receipt_key: receiptKey,
      policy_number: chosen.policyNumber,
      receipt_number: chosen.receiptNumber,
      client_key: chosen.clientKey,
      client_name: chosen.clientName,
      insurer_key: normalizeMasterName(canonicalInsurerName(chosen.insurerName, pg)),
      insurer_name: canonicalInsurerName(chosen.insurerName, pg),
      amount: String(chosen.primaTotal),
      currency: chosen.currency,
      due_date: chosen.periodEnd,
      status: chosen.receiptStatus,
      source_refs: VISIBLE_SOURCE_LABEL,
      source_priority_used: "external_ledger",
      confidence: reviewReason ? 75 : 95,
      clean_status: reviewReason ? "needs_review" : "candidate",
      review_reason: reviewReason,
      review_decision: "",
      review_value: "",
      review_note: "",
      lock_field: "",
      period_start: chosen.periodStart,
      period_end: chosen.periodEnd,
      prima_neta: String(chosen.primaNeta),
      prima_total: String(chosen.primaTotal),
      payment_date: chosen.paymentDate,
      is_operational: policy && policy.operational_state !== "CERRADA" ? 1 : 0,
      is_historical: policy ? 0 : 1,
    });

    if (reviewReason) {
      issues.push({
        review_batch_id: reviewBatchId,
        entity_type: "RECIBO",
        entity_key: receiptKey,
        field_name: "receipt",
        severity: "review",
        reason: reviewReason,
        suggested_value: chosen.receiptNumber,
        source_refs: VISIBLE_SOURCE_LABEL,
      });
    }

    const existingReceipt = pg.receiptsByKey.get(receiptKey);
    const currentValue = existingReceipt ? `${existingReceipt.amount} | ${existingReceipt.status} | ${parseDate(existingReceipt.dueDate)}` : "";
    const proposedValue = `${chosen.primaTotal} | ${chosen.receiptStatus} | ${chosen.periodEnd}`;
    promotionPreview.push({
      review_batch_id: reviewBatchId,
      entity_type: "RECIBO",
      entity_key: receiptKey,
      action: reviewReason ? "needs_review" : existingReceipt ? (currentValue === proposedValue ? "unchanged" : "update") : "create",
      current_value: currentValue,
      proposed_value: proposedValue,
      reason: reviewReason || (existingReceipt && currentValue !== proposedValue ? "Diferencia contra DB; requiere aprobacion explicita." : ""),
      clean_status: reviewReason ? "needs_review" : "candidate",
    });

    if (chosen.receiptStatus === "PAID" && chosen.paymentDate) {
      const paymentKey = `${receiptKey}:${chosen.paymentDate}`;
      const paymentReason = Number(chosen.primaTotal) !== Number(receipts.get(receiptKey)?.prima_total ?? chosen.primaTotal)
        ? "Pago candidato no coincide con primaTotal."
        : "";
      payments.set(paymentKey, {
        review_batch_id: reviewBatchId,
        payment_key: paymentKey,
        receipt_key: receiptKey,
        policy_number: chosen.policyNumber,
        receipt_number: chosen.receiptNumber,
        client_key: chosen.clientKey,
        client_name: chosen.clientName,
        amount: String(chosen.primaTotal),
        currency: chosen.currency,
        paid_date: chosen.paymentDate,
        status: paymentReason ? "needs_review" : "candidate",
        review_reason: paymentReason,
        review_decision: "",
        review_note: "",
      });
    }
  }

  for (const row of sourceRows.filter((candidate) => candidate.isAdjustment)) {
    adjustments.push({
      review_batch_id: reviewBatchId,
      adjustment_key: `${row.policyNumber}:${row.receiptNumber}:${row.rowNumber}`,
      policy_number: row.policyNumber,
      receipt_number: row.receiptNumber,
      client_name: row.clientName,
      endorsement_number: row.endorsementNumber,
      endorsement_type: row.endorsementType,
      endorsement_concept: row.endorsementConcept,
      prima_neta: String(row.primaNeta),
      prima_total: String(row.primaTotal),
      status: row.sourceStatus,
      source_row_id: row.sourceRowId,
      detail_json: row.rawPayload,
    });
  }

  for (const client of clients.values()) {
    const existing = pg.clientsByKey.get(String(client.client_key));
    promotionPreview.push({
      review_batch_id: reviewBatchId,
      entity_type: "CLIENTE",
      entity_key: client.client_key,
      action: existing ? "unchanged" : "create",
      current_value: existing?.fullName ?? "",
      proposed_value: client.full_name,
      reason: existing ? "" : "Cliente nuevo; requiere aprobacion explicita.",
      clean_status: client.clean_status,
    });
  }

  for (const insurer of insurers.values()) {
    const existing = pg.insurersByKey.get(String(insurer.insurer_key));
    promotionPreview.push({
      review_batch_id: reviewBatchId,
      entity_type: "ASEGURADORA",
      entity_key: insurer.insurer_key,
      action: existing ? "unchanged" : "needs_review",
      current_value: existing?.name ?? "",
      proposed_value: insurer.name,
      reason: existing ? "" : "Aseguradora no existe en catalogo actual.",
      clean_status: insurer.clean_status,
    });
  }

  for (const payment of payments.values()) {
    const existing = pg.paymentsByKey.get(String(payment.payment_key));
    promotionPreview.push({
      review_batch_id: reviewBatchId,
      entity_type: "PAGO",
      entity_key: payment.payment_key,
      action: payment.status === "needs_review" ? "needs_review" : existing ? "unchanged" : "create",
      current_value: existing ? `${existing.amount} | ${parseDate(existing.paidDate)}` : "",
      proposed_value: `${payment.amount} | ${payment.paid_date}`,
      reason: payment.review_reason,
      clean_status: payment.status,
    });
  }

  const uniqueHistory = uniqueRowsBy(history, (row) => String(row.history_key));
  const uniqueSnapshots = uniqueRowsBy(snapshots, (snapshot) => String(snapshot.snapshot_key));
  const mergeSuggestions = buildMergeSuggestions(reviewBatchId, [...clients.values()], sourceRows);
  const diffs = buildDiffs(db, reviewBatchId, uniqueSnapshots);
  const sourceSummary = {
    sourceLabel: VISIBLE_SOURCE_LABEL,
    rows: rows.length,
    uniquePolicies: new Set(sourceRows.map((row) => row.policyNumber)).size,
    uniqueReceipts: new Set(sourceRows.map((row) => row.receiptKey)).size,
    uniqueOperationalReceipts: new Set(sourceRows.filter((row) => !row.isAdjustment).map((row) => row.receiptKey)).size,
    uniqueHistoricalReceipts: new Set(sourceRows.filter((row) => !row.isAdjustment).map((row) => row.historyReceiptKey)).size,
    uniqueClients: clients.size,
    dbPoliciesCovered: pg.policies.filter((policy) => policyRows.has(normalizePolicyNumber(String(policy.policyNumber ?? "")))).length,
    dbPolicyTotal: pg.policies.length,
    dbReceiptsCovered: pg.receipts.filter((receipt) => receiptsByKey.has(`${normalizePolicyNumber(String(receipt.policyNumber ?? ""))}:${normalizeReceiptNumber(String(receipt.receiptNumber ?? ""))}`)).length,
    dbReceiptTotal: pg.receipts.length,
    dbClientsCovered: pg.clients.filter((client) => clients.has(normalizeMasterName(client.fullName))).length,
    dbClientTotal: pg.clients.length,
    principalClosed: [...policies.values()].filter((policy) => policy.operational_state === "CERRADA").length,
    principalExpired: [...policies.values()].filter((policy) => policy.operational_state === "VENCIDA").length,
    pendingReceipts: [...receipts.values()].filter((receipt) => receipt.status === "PENDING" || receipt.status === "OVERDUE").length,
    paymentCandidates: payments.size,
    adjustments: adjustments.length,
    duplicateConflicts: issues.filter((issue) => issue.entity_type === "RECIBO").length,
    diffs: diffs.filter((diff) => diff.diff_type !== "igual").length,
  };

  return {
    reviewBatchId,
    importId,
    sourceHash,
    sourcePath,
    sourceSummary,
    clients: [...clients.values()],
    insurers: [...insurers.values()],
    policyGroups: [...policyGroups.values()],
    policies: [...policies.values()],
    receipts: [...receipts.values()],
    payments: [...payments.values()],
    history: uniqueHistory,
    adjustments,
    quarantine,
    snapshots: uniqueSnapshots,
    diffs,
    mergeSuggestions,
    promotionPreview,
    issues,
    documentEvidence,
    aliases,
  };
}

function insertRows(db: Database.Database, tableName: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const placeholders = keys.map((key) => `@${key}`).join(", ");
  const statement = db.prepare(`INSERT INTO ${tableName} (${keys.join(", ")}) VALUES (${placeholders})`);
  for (const row of rows) statement.run(row);
}

function insertCanonicalRows(db: Database.Database, clean: CanonicalRows) {
  const insertAll = db.transaction(() => {
    db.prepare(`INSERT INTO canonical_review_batch (review_batch_id, source_summary, notes) VALUES (?, ?, ?)`).run(
      clean.reviewBatchId,
      safeJson(clean.sourceSummary),
      "Ledger clean batch. Visible source label: Fuente externa.",
    );
    db.prepare(`
      INSERT INTO external_ledger_import (
        import_id, review_batch_id, file_hash, source_path, status, row_count, unique_policies,
        unique_receipts, unique_clients, summary_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      clean.importId,
      clean.reviewBatchId,
      clean.sourceHash,
      clean.sourcePath,
      "COMPLETED",
      Number(clean.sourceSummary.rows),
      Number(clean.sourceSummary.uniquePolicies),
      Number(clean.sourceSummary.uniqueReceipts),
      Number(clean.sourceSummary.uniqueClients),
      safeJson(clean.sourceSummary),
    );

    insertRows(db, "canonical_client", clean.clients);
    insertRows(db, "canonical_insurer", clean.insurers);
    insertRows(db, "canonical_policy_group", clean.policyGroups);
    insertRows(db, "canonical_policy", clean.policies);
    insertRows(db, "canonical_receipt", clean.receipts);
    insertRows(db, "canonical_payment_candidate", clean.payments);
    insertRows(db, "canonical_policy_history", clean.history);
    insertRows(db, "canonical_adjustment_evidence", clean.adjustments);
    insertRows(db, "canonical_quarantine", clean.quarantine);
    insertRows(db, "external_ledger_snapshot", clean.snapshots);
    insertRows(db, "canonical_batch_diff", clean.diffs);
    insertRows(db, "canonical_merge_suggestion", clean.mergeSuggestions);
    insertRows(db, "canonical_promotion_preview", clean.promotionPreview);
    insertRows(db, "canonical_review_issue", clean.issues);
    insertRows(db, "canonical_document_evidence", clean.documentEvidence);
    insertRows(db, "canonical_alias", clean.aliases);
  });

  insertAll();
}

function cleanupOldLedgerBatches(db: Database.Database) {
  const old = db
    .prepare(`
      SELECT review_batch_id
      FROM external_ledger_import
      WHERE status = 'COMPLETED'
      ORDER BY imported_at DESC
      LIMIT -1 OFFSET ?
    `)
    .all(MAX_LEDGER_BATCHES) as Array<{ review_batch_id: string }>;

  const tables = [
    "canonical_client",
    "canonical_insurer",
    "canonical_policy_group",
    "canonical_policy",
    "canonical_receipt",
    "canonical_payment_candidate",
    "canonical_policy_history",
    "canonical_adjustment_evidence",
    "canonical_quarantine",
    "external_ledger_snapshot",
    "canonical_batch_diff",
    "canonical_merge_suggestion",
    "canonical_promotion_preview",
    "canonical_review_issue",
    "canonical_document_evidence",
    "canonical_alias",
  ];

  const deleteOld = db.transaction(() => {
    for (const row of old) {
      for (const tableName of tables) {
        db.prepare(`DELETE FROM ${tableName} WHERE review_batch_id = ?`).run(row.review_batch_id);
      }
      db.prepare(`DELETE FROM canonical_review_batch WHERE review_batch_id = ?`).run(row.review_batch_id);
      db.prepare(`DELETE FROM external_ledger_import WHERE review_batch_id = ?`).run(row.review_batch_id);
    }
  });
  deleteOld();
}

function buildWorkbook(clean: CanonicalRows, backupPath: string) {
  const createRows = clean.promotionPreview.filter((row) => row.action === "create");
  const conflictRows = clean.promotionPreview.filter((row) => row.action === "needs_review" || String(row.reason));
  const summaryRows = Object.entries(clean.sourceSummary).map(([metrica, valor]) => ({
    grupo: "Resumen",
    metrica,
    valor,
    detalle: "",
  }));
  summaryRows.unshift(
    { grupo: "Batch", metrica: "Review batch", valor: clean.reviewBatchId, detalle: "" },
    { grupo: "Seguridad", metrica: "Backup staging", valor: backupPath ? "creado" : "no existia staging previo", detalle: backupPath },
    { grupo: "Fuente", metrica: "Etiqueta visible", valor: VISIBLE_SOURCE_LABEL, detalle: "No se expone el sistema origen." },
  );

  return toWorkbook([
    { nombre: "Resumen", columnas: columnsFor(["grupo", "metrica", "valor", "detalle"]), filas: summaryRows },
    { nombre: "Clientes actuales", columnas: columnsFor(Object.keys(clean.clients[0] ?? {})), filas: clean.clients },
    { nombre: "Clientes similares para mezclar", columnas: columnsFor(Object.keys(clean.mergeSuggestions[0] ?? { review_batch_id: "", suggestion_key: "", entity_type: "", left_key: "", right_key: "", left_label: "", right_label: "", reason: "", score: "", review_decision: "", review_note: "" })), filas: clean.mergeSuggestions.filter((row) => row.entity_type === "CLIENTE") },
    { nombre: "Polizas actuales", columnas: columnsFor(Object.keys(clean.policies[0] ?? {})), filas: clean.policies },
    { nombre: "Grupos sugeridos", columnas: columnsFor(Object.keys(clean.policyGroups[0] ?? {})), filas: clean.policyGroups },
    { nombre: "Recibos actuales", columnas: columnsFor(Object.keys(clean.receipts[0] ?? {})), filas: clean.receipts },
    { nombre: "Pagos candidatos", columnas: columnsFor(Object.keys(clean.payments[0] ?? {})), filas: clean.payments },
    { nombre: "Historico importado", columnas: columnsFor(Object.keys(clean.history[0] ?? {})), filas: clean.history },
    { nombre: "Ajustes y endosos", columnas: columnsFor(Object.keys(clean.adjustments[0] ?? {})), filas: clean.adjustments },
    { nombre: "Cambios vs corrida anterior", columnas: columnsFor(Object.keys(clean.diffs[0] ?? {})), filas: clean.diffs },
    { nombre: "Ya existe en DB", columnas: columnsFor(Object.keys(clean.promotionPreview[0] ?? {})), filas: clean.promotionPreview.filter((row) => row.action === "unchanged") },
    { nombre: "Crear desde fuente externa", columnas: columnsFor(Object.keys(createRows[0] ?? {})), filas: createRows },
    { nombre: "Conflictos fuente externa", columnas: columnsFor(Object.keys(conflictRows[0] ?? {})), filas: conflictRows },
    { nombre: "Promotion preview", columnas: columnsFor(Object.keys(clean.promotionPreview[0] ?? {})), filas: clean.promotionPreview },
    { nombre: "Referidores sugeridos", columnas: columnsFor(["review_batch_id", "client_key", "full_name", "referidor_name", "review_decision", "review_note"]), filas: clean.clients.filter((row) => row.referidor_name) },
    { nombre: "Documental en cuarentena", columnas: columnsFor(Object.keys(clean.quarantine[0] ?? {})), filas: clean.quarantine },
    { nombre: "Evidencia documental", columnas: columnsFor(Object.keys(clean.documentEvidence[0] ?? { review_batch_id: "", entity_type: "", entity_key: "", source: "", evidence_ref: "", detail: "", confidence: "" })), filas: clean.documentEvidence },
    { nombre: "Alias detectados", columnas: columnsFor(Object.keys(clean.aliases[0] ?? { review_batch_id: "", entity_type: "", entity_key: "", alias_value: "", normalized_alias: "", canonical_value: "", source_refs: "", confidence: "" })), filas: clean.aliases },
    { nombre: "Requiere revision", columnas: columnsFor(Object.keys(clean.issues[0] ?? {})), filas: clean.issues },
    {
      nombre: "Reglas",
      columnas: columnsFor(["regla", "descripcion"]),
      filas: [
        { regla: "Fuente externa", descripcion: "Etiqueta visible neutral; no exponer el sistema origen." },
        { regla: "Actual", descripcion: "Poliza con vigencia mas reciente dentro del grupo." },
        { regla: "Historico", descripcion: "Buscable, no operativo; no alimenta KPIs diarios." },
        { regla: "Receipt vs Payment", descripcion: "Recibo es obligacion; pago candidato es evento real." },
        { regla: "Primas", descripcion: "Prima neta y prima total se conservan por poliza y recibo." },
        { regla: "Endosos", descripcion: "Endosos e importes negativos son evidencia, no recibos operativos." },
        { regla: "Aprobacion", descripcion: "Nada se promueve a pg.sqlite sin aprobacion explicita." },
      ],
    },
  ]);
}

async function cleanLedger() {
  await ensureDataDirs();
  const args = parseCliArgs();
  const sourcePath = path.resolve(getFlag(args, "source", DEFAULT_LEDGER_PATH) ?? DEFAULT_LEDGER_PATH);
  const outPath = getFlag(args, "out") ?? path.join(exportsDir, `canonical-ledger-clean-${timestampForFile()}.xlsx`);
  const allowDuplicate = hasFlag(args, "allow-duplicate");
  const reviewBatchId = `ledger-${timestampForFile()}-${String(Date.now()).slice(-4)}`;
  const importId = `external-ledger-${reviewBatchId}`;

  const sourceHash = await sha256(sourcePath);
  const rawRows = await readTabularInput(sourcePath);
  const schema = validateLedgerSchema(rawRows);
  if (!rawRows.length || schema.missing.length) {
    await failWithWorkbook(
      "La fuente externa no tiene el schema esperado; no se genero canonical parcial",
      [
        ...schema.missing.map((column) => ({ tipo: "columna_faltante", columna: column })),
        ...schema.extra.map((column) => ({ tipo: "columna_extra", columna: column })),
      ],
    );
  }

  let backupPath = "";
  const db = new Database(stagingDatabasePath);
  try {
    ensureLedgerSchema(db);
    const duplicate = db.prepare(`SELECT review_batch_id FROM external_ledger_import WHERE file_hash = ? AND status = 'COMPLETED'`).get(sourceHash) as
      | { review_batch_id: string }
      | undefined;
    if (duplicate && !allowDuplicate) {
      await failWithWorkbook("La misma fuente externa ya fue procesada; no se reproceso silenciosamente", [
        { tipo: "duplicado", batch_existente: duplicate.review_batch_id, hash: sourceHash },
      ]);
    }

    backupPath = await backupStagingDatabase();
    const normalizedRows = rawRows.map(normalizeLedgerRow);
    const clean = buildCanonicalRows(db, normalizedRows, reviewBatchId, importId, sourceHash, sourcePath);
    insertCanonicalRows(db, clean);
    cleanupOldLedgerBatches(db);
    XLSX.writeFile(buildWorkbook(clean, backupPath), outPath, { bookType: "xlsx" });
    db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run("lastLedgerBatch", reviewBatchId);
    db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run("lastLedgerWorkbook", outPath);

    console.log(`Batch ledger: ${reviewBatchId}`);
    console.log(`Workbook: ${outPath}`);
    console.log(`Fuente externa filas: ${clean.sourceSummary.rows}`);
    console.log(`Pólizas únicas: ${clean.sourceSummary.uniquePolicies}`);
    console.log(`Recibos únicos: ${clean.sourceSummary.uniqueReceipts}`);
    console.log(`Recibos únicos operativos: ${clean.sourceSummary.uniqueOperationalReceipts}`);
    console.log(`Recibos únicos históricos: ${clean.sourceSummary.uniqueHistoricalReceipts}`);
    console.log(`Clientes únicos: ${clean.sourceSummary.uniqueClients}`);
    console.log(`Pólizas actuales: ${clean.policies.length}`);
    console.log(`Recibos actuales: ${clean.receipts.length}`);
    console.log(`Pagos candidatos: ${clean.payments.length}`);
    console.log(`Histórico importado: ${clean.history.length}`);
    console.log(`Ajustes y endosos: ${clean.adjustments.length}`);
    console.log(`Issues revisión: ${clean.issues.length}`);
  } finally {
    db.close();
  }
}

cleanLedger().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
