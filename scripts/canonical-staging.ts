#!/usr/bin/env tsx

import fs from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";
import * as XLSX from "@e965/xlsx";

import {
  databasePath,
  exportsDir,
  ensureDataDirs,
  getFlag,
  parseCliArgs,
  stagingDatabasePath,
  timestampForFile,
} from "./_shared";
import { toWorkbook } from "../src/lib/export";
import {
  normalizeMasterName,
  normalizePolicyNumber,
  normalizeReceiptNumber,
} from "../src/lib/master-folder";

type WorkbookRow = Record<string, string | number | boolean>;
type DecisionStatus = "auto" | "review" | "reject";
type HumanDecision = "approve" | "reject" | "review" | "";

type CleanRow = {
  sourceSheet: string;
  entityType: string;
  entityKey: string;
  fieldName: string;
  rawValues: string;
  normalizedValue: string;
  verifiedValue: string;
  score: number;
  status: DecisionStatus;
  sources: string;
  reason: string;
};

type CrossRow = Record<string, string | number | boolean>;

type SourceRecord = {
  source: string;
  sheetName: string;
  rowNumber: number;
  entityType: string;
  entityKey: string;
  filePath: string;
  sourceRowId: string;
  rawPayload: string;
  rawText: string;
};

type FieldDecisionRow = {
  decisionId: string;
  entityType: string;
  entityKey: string;
  fieldName: string;
  rawValue: string;
  normalizedValue: string;
  proposedValue: string;
  verifiedValue: string;
  score: number;
  status: DecisionStatus;
  humanStatus: HumanDecision;
  humanVerifiedValue: string;
  humanNote: string;
  evidenceSources: string;
  evidenceRefs: string;
  reason: string;
};

type EntityResolutionRow = {
  entityId: string;
  entityType: string;
  entityKey: string;
  displayValue: string;
  sourceCount: number;
  exactCount: number;
  reviewCount: number;
  rejectCount: number;
  status: string;
  summaryJson: string;
};

type ReviewQueueRow = {
  entityType: string;
  entityKey: string;
  fieldName: string;
  decisionId: string;
  priority: number;
  status: string;
  reason: string;
  suggestedValue: string;
  currentValue: string;
  sourceList: string;
  evidenceRefs: string;
};

const DEFAULT_CLEAN_WORKBOOK_PREFIXES = ["four-source-field-cleaning-", "four-source-reconciliation-"];
const DEFAULT_REVIEW_OUT = path.join(exportsDir, `canonical-review-${timestampForFile()}.xlsx`);

function normalizeDisplay(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeMaybe(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  return text;
}

function latestWorkbookPath(prefixes: string[]) {
  return fs.readdir(exportsDir, { withFileTypes: true }).then(async (entries) => {
    const candidates: Array<{ filePath: string; mtime: number }> = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".xlsx")) continue;
      if (!prefixes.some((prefix) => entry.name.startsWith(prefix))) continue;
      const filePath = path.join(exportsDir, entry.name);
      const stat = await fs.stat(filePath);
      candidates.push({ filePath, mtime: stat.mtimeMs });
    }

    candidates.sort((left, right) => right.mtime - left.mtime);
    return candidates[0]?.filePath ?? null;
  });
}

function readSheetRows<T extends WorkbookRow>(workbook: XLSX.WorkBook, sheetName: string) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [] as T[];
  return XLSX.utils.sheet_to_json<T>(sheet, { defval: "" });
}

function scorePriority(status: DecisionStatus) {
  if (status === "auto") return 3;
  if (status === "review") return 2;
  return 1;
}

function parseDecisionStatus(value: unknown): DecisionStatus {
  const normalized = normalizeDisplay(normalizeMaybe(value)).toLowerCase();
  if (normalized === "auto") return "auto";
  if (normalized === "review") return "review";
  return "reject";
}

function parseHumanDecision(value: unknown): HumanDecision {
  const normalized = normalizeDisplay(normalizeMaybe(value)).toLowerCase();
  if (!normalized) return "";
  if (["approve", "aprobar", "aprobado", "keep", "mantener"].includes(normalized)) return "approve";
  if (["reject", "rechazar", "rechazado", "remove", "eliminar"].includes(normalized)) return "reject";
  if (["review", "revisar", "revisar luego", "pending", "pendiente"].includes(normalized)) return "review";
  return "";
}

function makeDecisionId(entityType: string, entityKey: string, fieldName: string) {
  return `${entityType}:${normalizeMasterName(entityKey)}:${fieldName}`;
}

function createDb(recreate = false) {
  const resolved = stagingDatabasePath;

  if (recreate) {
    return fs
      .rm(resolved, { force: true })
      .then(() => new Database(resolved))
      .catch(() => new Database(resolved));
  }

  return Promise.resolve(new Database(resolved));
}

function ensureSchema(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_record (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      sheet_name TEXT NOT NULL,
      row_number INTEGER NOT NULL,
      entity_type TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      file_path TEXT NOT NULL,
      source_row_id TEXT NOT NULL UNIQUE,
      raw_payload TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_source_record_source ON source_record(source);
    CREATE INDEX IF NOT EXISTS idx_source_record_entity ON source_record(entity_type, entity_key);

    CREATE TABLE IF NOT EXISTS field_candidate (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_sheet TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      field_name TEXT NOT NULL,
      raw_value TEXT NOT NULL,
      normalized_value TEXT NOT NULL,
      proposed_value TEXT NOT NULL,
      confidence REAL NOT NULL,
      status TEXT NOT NULL,
      source_list TEXT NOT NULL,
      evidence_refs TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_field_candidate_entity ON field_candidate(entity_type, entity_key);
    CREATE INDEX IF NOT EXISTS idx_field_candidate_field ON field_candidate(field_name, status);

    CREATE TABLE IF NOT EXISTS field_decision (
      decision_id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      field_name TEXT NOT NULL,
      raw_value TEXT NOT NULL,
      normalized_value TEXT NOT NULL,
      proposed_value TEXT NOT NULL,
      verified_value TEXT NOT NULL,
      confidence REAL NOT NULL,
      status TEXT NOT NULL,
      human_status TEXT NOT NULL DEFAULT '',
      human_verified_value TEXT NOT NULL DEFAULT '',
      human_note TEXT NOT NULL DEFAULT '',
      evidence_sources TEXT NOT NULL,
      evidence_refs TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_field_decision_entity ON field_decision(entity_type, entity_key);
    CREATE INDEX IF NOT EXISTS idx_field_decision_status ON field_decision(status, human_status);

    CREATE TABLE IF NOT EXISTS entity_resolution (
      entity_id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      display_value TEXT NOT NULL,
      source_count INTEGER NOT NULL,
      exact_count INTEGER NOT NULL,
      review_count INTEGER NOT NULL,
      reject_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_entity_resolution_entity ON entity_resolution(entity_type, entity_key);

    CREATE TABLE IF NOT EXISTS review_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      decision_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      field_name TEXT NOT NULL,
      priority INTEGER NOT NULL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      suggested_value TEXT NOT NULL,
      current_value TEXT NOT NULL,
      source_list TEXT NOT NULL,
      evidence_refs TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_review_queue_status ON review_queue(status, priority);
    CREATE INDEX IF NOT EXISTS idx_review_queue_entity ON review_queue(entity_type, entity_key);

    CREATE TABLE IF NOT EXISTS evidence_link (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_record_id INTEGER NOT NULL,
      decision_id TEXT,
      evidence_type TEXT NOT NULL,
      evidence_ref TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (source_record_id) REFERENCES source_record(id) ON DELETE CASCADE,
      FOREIGN KEY (decision_id) REFERENCES field_decision(decision_id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_evidence_link_decision ON evidence_link(decision_id);

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

    CREATE INDEX IF NOT EXISTS idx_canonical_client_batch ON canonical_client(review_batch_id, clean_status);
    CREATE INDEX IF NOT EXISTS idx_canonical_policy_batch ON canonical_policy(review_batch_id, clean_status);
    CREATE INDEX IF NOT EXISTS idx_canonical_receipt_batch ON canonical_receipt(review_batch_id, clean_status);
    CREATE INDEX IF NOT EXISTS idx_canonical_preview_batch ON canonical_promotion_preview(review_batch_id, action);
  `);
}

function rawTextFromRow(row: Record<string, unknown>) {
  return Object.entries(row)
    .map(([key, value]) => `${key}: ${normalizeMaybe(value)}`)
    .filter((entry) => entry !== ": ")
    .join(" | ");
}

function sourceTypeFromSheet(sheetName: string) {
  if (sheetName === "Revisar PDFs") return "revisar";
  if (sheetName === "Master Clientes") return "master";
  if (sheetName === "SAPS crudo") return "saps";
  if (sheetName === "DB crudo") return "db";
  return "review";
}

function entityHintsFromRow(sheetName: string, row: Record<string, unknown>) {
  const entityType = normalizeMaybe(row["Entidad"] ?? row["entityType"] ?? row["fuente"] ?? row["source"] ?? "");
  const key =
    normalizeMaybe(row["Clave"] ?? row["key"] ?? row["policyNumber"] ?? row["policy"] ?? row["No. Póliza"] ?? row["No. Recibo"] ?? row["cliente"] ?? row["Cliente"] ?? row["display"] ?? row["Nombre"] ?? row["archivo"] ?? row["Archivo"] ?? "");

  const entityKey = key || `${sheetName}:${normalizeDisplay(rawTextFromRow(row)).slice(0, 80)}`;
  const guessType =
    normalizeDisplay(entityType).toUpperCase() ||
    (sheetName === "SAPS crudo" || sheetName === "DB crudo" ? "POLIZA" : sheetName === "Revisar PDFs" || sheetName === "Master Clientes" ? "ARCHIVO" : "CAMPO");

  return { entityType: guessType, entityKey };
}

function collectSourceRecords(workbook: XLSX.WorkBook) {
  const sheets = ["Revisar PDFs", "Master Clientes", "SAPS crudo", "DB crudo"];
  const records: SourceRecord[] = [];

  for (const sheetName of sheets) {
    const rows = readSheetRows<Record<string, unknown>>(workbook, sheetName);
    const source = sourceTypeFromSheet(sheetName);

    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const { entityType, entityKey } = entityHintsFromRow(sheetName, row);
      const filePath =
        normalizeMaybe(row["Archivo"] ?? row["archivo"] ?? row["filePath"] ?? row["file_path"] ?? row["ruta"] ?? row["Ruta"] ?? row["topLevelFolder"] ?? "");
      records.push({
        source,
        sheetName,
        rowNumber,
        entityType,
        entityKey: normalizeDisplay(entityKey),
        filePath,
        sourceRowId: `${sheetName}:${rowNumber}`,
        rawPayload: JSON.stringify(row),
        rawText: rawTextFromRow(row),
      });
    });
  }

  return records;
}

function decisionRowsFromWorkbook(workbook: XLSX.WorkBook) {
  const cleanSheets = [
    ...readSheetRows<WorkbookRow>(workbook, "Campos limpios"),
    ...readSheetRows<WorkbookRow>(workbook, "Campos sospechosos"),
  ];

  if (cleanSheets.length > 0) {
    const byDecision = new Map<string, CleanRow>();

    for (const row of cleanSheets) {
      const entityType = normalizeDisplay(normalizeMaybe(row["entityType"] ?? row["Entidad"] ?? ""));
      const entityKey = normalizeDisplay(normalizeMaybe(row["entityKey"] ?? row["Clave"] ?? ""));
      const fieldName = normalizeDisplay(normalizeMaybe(row["fieldName"] ?? row["Campo"] ?? ""));
      const rawValues = normalizeDisplay(normalizeMaybe(row["rawValues"] ?? row["Valores brutos"] ?? ""));
      const normalizedValue = normalizeDisplay(normalizeMaybe(row["normalizedValue"] ?? row["Normalizado"] ?? ""));
      const verifiedValue = normalizeDisplay(normalizeMaybe(row["verifiedValue"] ?? row["Verificado"] ?? ""));
      const score = Number(row["score"] ?? row["Score"] ?? 0) || 0;
      const status = parseDecisionStatus(row["status"] ?? row["Estado"] ?? "");
      const sources = normalizeDisplay(normalizeMaybe(row["sources"] ?? row["Fuentes"] ?? ""));
      const reason = normalizeDisplay(normalizeMaybe(row["reason"] ?? row["Motivo"] ?? ""));
      const sourceSheet = normalizeDisplay(normalizeMaybe(row["sourceSheet"] ?? row["Hoja"] ?? "Campos"));
      const decisionId = makeDecisionId(entityType || "ENTIDAD", entityKey || "SIN_CLAVE", fieldName || "campo");
      const existing = byDecision.get(decisionId);

      const current: CleanRow = {
        sourceSheet,
        entityType: entityType || "ENTIDAD",
        entityKey: entityKey || "SIN_CLAVE",
        fieldName: fieldName || "campo",
        rawValues,
        normalizedValue,
        verifiedValue,
        score,
        status,
        sources,
        reason,
      };

      if (!existing) {
        byDecision.set(decisionId, current);
        continue;
      }

      const currentPriority = scorePriority(current.status);
      const existingPriority = scorePriority(existing.status);
      if (currentPriority > existingPriority || (currentPriority === existingPriority && current.score > existing.score)) {
        byDecision.set(decisionId, current);
      }
    }

    return Array.from(byDecision.entries()).map(([decisionId, row]) => ({ decisionId, ...row }));
  }

  const crossRows = [
    ...readSheetRows<CrossRow>(workbook, "Cruce Poliza"),
    ...readSheetRows<CrossRow>(workbook, "Cruce Cliente"),
    ...readSheetRows<CrossRow>(workbook, "Cruce Recibo"),
  ];
  const byDecision = new Map<string, CleanRow>();

  for (const row of crossRows) {
    const entityType = normalizeDisplay(normalizeMaybe(row["Entidad"] ?? row["entityType"] ?? ""));
    const entityKey = normalizeDisplay(normalizeMaybe(row["Clave"] ?? row["key"] ?? ""));
    const statusText = normalizeDisplay(normalizeMaybe(row["Estatus"] ?? row["status"] ?? ""));
    const sourceList = normalizeDisplay(normalizeMaybe(row["Fuentes detalle"] ?? row["sourceList"] ?? ""));
    const sources = sourceList || statusText;
    const exactAll = Boolean(row["exactAll"] ?? row["Iguales exactos"] ?? false) || statusText.toUpperCase() === "IGUALES_EXACTOS";
    const sourceCount = Number(row["Fuentes"] ?? row["sourceCount"] ?? 0) || sources.split(/[|,]/).filter(Boolean).length;
    const confidence = exactAll ? 100 : Math.min(95, Math.max(50, sourceCount * 20));
    const resolvedStatus: DecisionStatus = exactAll ? "auto" : statusText.toUpperCase() === "AMBIGUO" || sourceCount < 4 ? "review" : "review";
    const reason = normalizeDisplay(normalizeMaybe(row["Notas"] ?? row["notes"] ?? row["Motivos"] ?? ""));
    const sourceSheet = normalizeDisplay(normalizeMaybe(row["sourceSheet"] ?? row["Hoja"] ?? "Cruce"));
    const displayPolicy = normalizeDisplay(normalizeMaybe(row["Póliza"] ?? row["display"] ?? row["Nombre"] ?? ""));
    const displayClient = normalizeDisplay(normalizeMaybe(row["Cliente"] ?? row["Clientes"] ?? ""));
    const displayInsurer = normalizeDisplay(normalizeMaybe(row["Aseguradoras"] ?? row["Aseguradora"] ?? ""));
    const displayReceipt = normalizeDisplay(normalizeMaybe(row["Recibos"] ?? row["Recibo"] ?? ""));
    const displayReferidor = normalizeDisplay(normalizeMaybe(row["Referidor"] ?? row["referidorNames"] ?? ""));

    const fieldRows = [
      { fieldName: "policyNumber", rawValues: displayPolicy || entityKey, normalizedValue: normalizePolicyNumber(entityKey || displayPolicy), verifiedValue: normalizePolicyNumber(entityKey || displayPolicy) },
      { fieldName: "clientName", rawValues: displayClient || displayPolicy, normalizedValue: normalizeMasterName(displayClient || displayPolicy), verifiedValue: displayClient || displayPolicy },
      { fieldName: "insurerName", rawValues: displayInsurer, normalizedValue: normalizeMasterName(displayInsurer), verifiedValue: displayInsurer },
      { fieldName: "receiptNumber", rawValues: displayReceipt, normalizedValue: normalizeReceiptNumber(displayReceipt), verifiedValue: normalizeReceiptNumber(displayReceipt) },
      { fieldName: "referidorName", rawValues: displayReferidor, normalizedValue: normalizeMasterName(displayReferidor), verifiedValue: displayReferidor },
    ];

    for (const field of fieldRows) {
      const cleanRow: CleanRow = {
        sourceSheet,
        entityType: entityType || "ENTIDAD",
        entityKey: entityKey || "SIN_CLAVE",
        fieldName: field.fieldName,
        rawValues: field.rawValues,
        normalizedValue: field.normalizedValue,
        verifiedValue: field.verifiedValue,
        score: confidence,
        status: resolvedStatus,
        sources,
        reason: reason || statusText || "consolidado desde cruce",
      };
      const decisionId = makeDecisionId(cleanRow.entityType, cleanRow.entityKey, cleanRow.fieldName);
      const existing = byDecision.get(decisionId);

      if (!existing) {
        byDecision.set(decisionId, cleanRow);
        continue;
      }

      const currentPriority = scorePriority(cleanRow.status);
      const existingPriority = scorePriority(existing.status);
      if (currentPriority > existingPriority || (currentPriority === existingPriority && cleanRow.score > existing.score)) {
        byDecision.set(decisionId, cleanRow);
      }
    }
  }

  return Array.from(byDecision.entries()).map(([decisionId, row]) => ({ decisionId, ...row }));
}

function buildEntityResolutionRows(workbook: XLSX.WorkBook) {
  const rows = [
    ...readSheetRows<CrossRow>(workbook, "Cruce Poliza"),
    ...readSheetRows<CrossRow>(workbook, "Cruce Cliente"),
    ...readSheetRows<CrossRow>(workbook, "Cruce Recibo"),
  ];

  return rows.map((row) => {
    const entityType = normalizeDisplay(normalizeMaybe(row["Entidad"] ?? row["entityType"] ?? ""));
    const entityKey = normalizeDisplay(normalizeMaybe(row["Clave"] ?? row["key"] ?? ""));
    const displayValue = normalizeDisplay(normalizeMaybe(row["Póliza"] ?? row["Cliente"] ?? row["Recibo"] ?? row["Nombre"] ?? row["display"] ?? ""));
    const sourceList = normalizeDisplay(normalizeMaybe(row["Fuentes detalle"] ?? row["sourceList"] ?? ""));
    const exactCount = normalizeDisplay(normalizeMaybe(row["Estatus"] ?? row["status"] ?? "")).toUpperCase() === "IGUALES_EXACTOS" ? 1 : 0;
    const reviewCount = normalizeDisplay(normalizeMaybe(row["Estatus"] ?? row["status"] ?? "")).toUpperCase() === "AMBIGUO" ? 1 : 0;
    const rejectCount = normalizeDisplay(normalizeMaybe(row["Estatus"] ?? row["status"] ?? "")).toUpperCase().startsWith("SOLO_") ? 1 : 0;
    const sourceCount = Number(row["Fuentes"] ?? row["sourceCount"] ?? 0) || sourceList.split(/[|,]/).filter(Boolean).length;
    const status = normalizeDisplay(normalizeMaybe(row["Estatus"] ?? row["status"] ?? "PARCIAL"));

    return {
      entityId: makeDecisionId(entityType || "ENTIDAD", entityKey || "SIN_CLAVE", "resolution"),
      entityType: entityType || "ENTIDAD",
      entityKey: entityKey || "SIN_CLAVE",
      displayValue,
      sourceCount,
      exactCount,
      reviewCount,
      rejectCount,
      status,
      summaryJson: JSON.stringify(row),
    } satisfies EntityResolutionRow;
  });
}

function buildFieldCandidates(decisions: Array<{ decisionId: string } & CleanRow>) {
  return decisions.map((row) => ({
    sourceSheet: row.sourceSheet,
    entityType: row.entityType,
    entityKey: row.entityKey,
    fieldName: row.fieldName,
    rawValue: row.rawValues,
    normalizedValue: row.normalizedValue,
    proposedValue: row.verifiedValue || row.normalizedValue,
    confidence: row.score,
    status: row.status,
    sourceList: row.sources,
    evidenceRefs: row.sources,
    reason: row.reason,
  }));
}

function buildReviewQueueRows(decisions: Array<{ decisionId: string } & CleanRow>) {
  return decisions
    .filter((row) => row.status !== "auto" || row.score < 90)
    .map((row) => ({
      entityType: row.entityType,
      entityKey: row.entityKey,
      fieldName: row.fieldName,
      decisionId: row.decisionId,
      priority: row.fieldName === "policyNumber" || row.fieldName === "receiptNumber" ? 3 : row.status === "review" ? 2 : 1,
      status: "OPEN",
      reason: row.reason,
      suggestedValue: row.verifiedValue || row.normalizedValue,
      currentValue: "",
      sourceList: row.sources,
      evidenceRefs: row.sources,
    })) satisfies ReviewQueueRow[];
}

function buildEvidenceLinks(sourceRecords: SourceRecord[], decisions: Array<{ decisionId: string } & CleanRow>) {
  const links: Array<Record<string, unknown>> = [];
  const sourceByEntity = new Map<string, SourceRecord[]>();

  for (const record of sourceRecords) {
    const key = `${normalizeMasterName(record.entityType)}:${normalizeMasterName(record.entityKey)}`;
    const existing = sourceByEntity.get(key) ?? [];
    existing.push(record);
    sourceByEntity.set(key, existing);
  }

  for (const decision of decisions) {
    const key = `${normalizeMasterName(decision.entityType)}:${normalizeMasterName(decision.entityKey)}`;
    const sourceRefs = sourceByEntity.get(key) ?? [];

    for (const sourceRef of sourceRefs) {
      links.push({
        source_record_id: sourceRef.sourceRowId,
        decision_id: decision.decisionId,
        evidence_type: sourceRef.source,
        evidence_ref: sourceRef.filePath || sourceRef.sourceRowId,
        detail_json: JSON.stringify({
          sheetName: sourceRef.sheetName,
          rowNumber: sourceRef.rowNumber,
          rawText: sourceRef.rawText,
        }),
      });
    }
  }

  return links;
}

function buildWorkbookFromStaging(
  sourcePath: string,
  decisions: Array<{ decisionId: string } & CleanRow>,
  entityRows: EntityResolutionRow[],
  sourceRecords: SourceRecord[],
  reviewQueue: ReviewQueueRow[],
) {
  const autoRows = decisions.filter((row) => row.status === "auto");
  const reviewRows = decisions.filter((row) => row.status !== "auto");
  const sourceRows = sourceRecords.map((row) => ({
    source: row.source,
    sheetName: row.sheetName,
    rowNumber: row.rowNumber,
    entityType: row.entityType,
    entityKey: row.entityKey,
    filePath: row.filePath,
    sourceRowId: row.sourceRowId,
    rawText: row.rawText,
  }));

  const summaryRows = [
    { grupo: "fuente", métrica: "Workbook origen", valor: sourcePath, detalle: "" },
    { grupo: "fuente", métrica: "Registros fuente", valor: sourceRecords.length, detalle: "" },
    { grupo: "fuente", métrica: "Decisiones auto", valor: autoRows.length, detalle: "" },
    { grupo: "fuente", métrica: "Decisiones revisión", valor: reviewRows.length, detalle: "" },
    { grupo: "fuente", métrica: "Entidades consolidadas", valor: entityRows.length, detalle: "" },
    { grupo: "fuente", métrica: "Cola revisión", valor: reviewQueue.length, detalle: "" },
    { grupo: "calidad", métrica: "Con conflicto", valor: reviewQueue.filter((row) => row.priority >= 2).length, detalle: "" },
    { grupo: "calidad", métrica: "Policy/Receipt críticos", valor: reviewQueue.filter((row) => row.priority === 3).length, detalle: "" },
  ];

  const reviewWorkbook = toWorkbook([
    {
      nombre: "Resumen",
      columnas: [
        { clave: "grupo", etiqueta: "Grupo" },
        { clave: "métrica", etiqueta: "Métrica" },
        { clave: "valor", etiqueta: "Valor" },
        { clave: "detalle", etiqueta: "Detalle" },
      ],
      filas: summaryRows,
    },
    {
      nombre: "Pendientes revisión",
      columnas: [
        { clave: "decisionId", etiqueta: "Decision ID" },
        { clave: "entityType", etiqueta: "Entidad" },
        { clave: "entityKey", etiqueta: "Clave" },
        { clave: "fieldName", etiqueta: "Campo" },
        { clave: "rawValue", etiqueta: "Valor bruto" },
        { clave: "normalizedValue", etiqueta: "Normalizado" },
        { clave: "proposedValue", etiqueta: "Valor propuesto" },
        { clave: "confidence", etiqueta: "Score" },
        { clave: "status", etiqueta: "Estado sugerido" },
        { clave: "humanStatus", etiqueta: "Decision humana" },
        { clave: "humanVerifiedValue", etiqueta: "Valor humano" },
        { clave: "humanNote", etiqueta: "Nota humana" },
        { clave: "evidenceSources", etiqueta: "Fuentes" },
        { clave: "evidenceRefs", etiqueta: "Evidencia" },
        { clave: "reason", etiqueta: "Motivo" },
      ],
      filas: reviewRows.map((row) => ({
        ...row,
        humanStatus: "",
        humanVerifiedValue: row.verifiedValue || row.normalizedValue,
        humanNote: "",
      })),
    },
    {
      nombre: "Campos sospechosos",
      columnas: [
        { clave: "decisionId", etiqueta: "Decision ID" },
        { clave: "entityType", etiqueta: "Entidad" },
        { clave: "entityKey", etiqueta: "Clave" },
        { clave: "fieldName", etiqueta: "Campo" },
        { clave: "rawValue", etiqueta: "Valor bruto" },
        { clave: "normalizedValue", etiqueta: "Normalizado" },
        { clave: "proposedValue", etiqueta: "Valor propuesto" },
        { clave: "confidence", etiqueta: "Score" },
        { clave: "status", etiqueta: "Estado" },
        { clave: "evidenceSources", etiqueta: "Fuentes" },
        { clave: "evidenceRefs", etiqueta: "Evidencia" },
        { clave: "reason", etiqueta: "Motivo" },
      ],
      filas: reviewRows,
    },
    {
      nombre: "Campos autoaceptados",
      columnas: [
        { clave: "decisionId", etiqueta: "Decision ID" },
        { clave: "entityType", etiqueta: "Entidad" },
        { clave: "entityKey", etiqueta: "Clave" },
        { clave: "fieldName", etiqueta: "Campo" },
        { clave: "rawValue", etiqueta: "Valor bruto" },
        { clave: "normalizedValue", etiqueta: "Normalizado" },
        { clave: "proposedValue", etiqueta: "Valor propuesto" },
        { clave: "confidence", etiqueta: "Score" },
        { clave: "status", etiqueta: "Estado" },
        { clave: "evidenceSources", etiqueta: "Fuentes" },
        { clave: "evidenceRefs", etiqueta: "Evidencia" },
        { clave: "reason", etiqueta: "Motivo" },
      ],
      filas: autoRows,
    },
    {
      nombre: "Conflictos entre fuentes",
      columnas: [
        { clave: "entityType", etiqueta: "Entidad" },
        { clave: "entityKey", etiqueta: "Clave" },
        { clave: "fieldName", etiqueta: "Campo" },
        { clave: "decisionId", etiqueta: "Decision ID" },
        { clave: "priority", etiqueta: "Prioridad" },
        { clave: "status", etiqueta: "Estado" },
        { clave: "reason", etiqueta: "Motivo" },
        { clave: "suggestedValue", etiqueta: "Valor sugerido" },
        { clave: "currentValue", etiqueta: "Valor actual" },
        { clave: "sourceList", etiqueta: "Fuentes" },
        { clave: "evidenceRefs", etiqueta: "Evidencia" },
        { clave: "notes", etiqueta: "Notas" },
      ],
      filas: reviewQueue.map((row) => ({ ...row, notes: "" })),
    },
    {
      nombre: "Clientes",
      columnas: [
        { clave: "entityKey", etiqueta: "Clave" },
        { clave: "displayValue", etiqueta: "Cliente" },
        { clave: "status", etiqueta: "Estatus" },
        { clave: "sourceCount", etiqueta: "Fuentes" },
        { clave: "exactCount", etiqueta: "Exactos" },
        { clave: "reviewCount", etiqueta: "Revisar" },
        { clave: "rejectCount", etiqueta: "Rechazar" },
        { clave: "summaryJson", etiqueta: "Detalle" },
      ],
      filas: entityRows.filter((row) => normalizeMasterName(row.entityType) === "CLIENTE"),
    },
    {
      nombre: "Polizas",
      columnas: [
        { clave: "entityKey", etiqueta: "Clave" },
        { clave: "displayValue", etiqueta: "Póliza" },
        { clave: "status", etiqueta: "Estatus" },
        { clave: "sourceCount", etiqueta: "Fuentes" },
        { clave: "exactCount", etiqueta: "Exactos" },
        { clave: "reviewCount", etiqueta: "Revisar" },
        { clave: "rejectCount", etiqueta: "Rechazar" },
        { clave: "summaryJson", etiqueta: "Detalle" },
      ],
      filas: entityRows.filter((row) => normalizeMasterName(row.entityType) === "POLIZA"),
    },
    {
      nombre: "Recibos",
      columnas: [
        { clave: "entityKey", etiqueta: "Clave" },
        { clave: "displayValue", etiqueta: "Recibo" },
        { clave: "status", etiqueta: "Estatus" },
        { clave: "sourceCount", etiqueta: "Fuentes" },
        { clave: "exactCount", etiqueta: "Exactos" },
        { clave: "reviewCount", etiqueta: "Revisar" },
        { clave: "rejectCount", etiqueta: "Rechazar" },
        { clave: "summaryJson", etiqueta: "Detalle" },
      ],
      filas: entityRows.filter((row) => normalizeMasterName(row.entityType) === "RECIBO"),
    },
    {
      nombre: "Aseguradoras",
      columnas: [
        { clave: "entityKey", etiqueta: "Clave" },
        { clave: "displayValue", etiqueta: "Aseguradora" },
        { clave: "status", etiqueta: "Estatus" },
        { clave: "sourceCount", etiqueta: "Fuentes" },
        { clave: "exactCount", etiqueta: "Exactos" },
        { clave: "reviewCount", etiqueta: "Revisar" },
        { clave: "rejectCount", etiqueta: "Rechazar" },
        { clave: "summaryJson", etiqueta: "Detalle" },
      ],
      filas: entityRows.filter((row) => normalizeMasterName(row.entityType) === "ASEGURADORA"),
    },
    {
      nombre: "Referidor",
      columnas: [
        { clave: "entityType", etiqueta: "Entidad" },
        { clave: "entityKey", etiqueta: "Clave" },
        { clave: "fieldName", etiqueta: "Campo" },
        { clave: "rawValue", etiqueta: "Valor bruto" },
        { clave: "normalizedValue", etiqueta: "Normalizado" },
        { clave: "proposedValue", etiqueta: "Valor propuesto" },
        { clave: "confidence", etiqueta: "Score" },
        { clave: "status", etiqueta: "Estado" },
        { clave: "evidenceSources", etiqueta: "Fuentes" },
        { clave: "evidenceRefs", etiqueta: "Evidencia" },
        { clave: "reason", etiqueta: "Motivo" },
      ],
      filas: [...autoRows, ...reviewRows].filter((row) => row.fieldName === "referidorName"),
    },
    {
      nombre: "Evidencia",
      columnas: [
        { clave: "source", etiqueta: "Fuente" },
        { clave: "sheetName", etiqueta: "Hoja" },
        { clave: "rowNumber", etiqueta: "Fila" },
        { clave: "entityType", etiqueta: "Entidad" },
        { clave: "entityKey", etiqueta: "Clave" },
        { clave: "filePath", etiqueta: "Archivo" },
        { clave: "sourceRowId", etiqueta: "Source Row ID" },
        { clave: "rawText", etiqueta: "Texto" },
      ],
      filas: sourceRows,
    },
    {
      nombre: "Reglas",
      columnas: [
        { clave: "regla", etiqueta: "Regla" },
        { clave: "descripcion", etiqueta: "Descripcion" },
        { clave: "umbral", etiqueta: "Umbral" },
      ],
      filas: [
        { regla: "policyNumber", descripcion: "Debe parecer numero de poliza y contener digitos.", umbral: ">= 90 auto / >= 70 revisar" },
        { regla: "receiptNumber", descripcion: "Debe parecer numero de recibo o referencia cobrable.", umbral: ">= 90 auto / >= 70 revisar" },
        { regla: "clientName", descripcion: "Solo nombres reales sin ruido, números ni etiquetas tecnicas.", umbral: ">= 90 auto / >= 70 revisar" },
        { regla: "insurerName", descripcion: "Se canoniza contra el catalogo de aseguradoras.", umbral: ">= 90 auto / >= 70 revisar" },
        { regla: "referidorName", descripcion: "No reemplaza al cliente real; solo complementa la trazabilidad comercial.", umbral: ">= 90 auto / >= 70 revisar" },
      ],
    },
  ]);

  return reviewWorkbook;
}

function upsertStaging(db: Database.Database, workbook: XLSX.WorkBook, sourcePath: string, reviewPath: string) {
  const sourceRecords = collectSourceRecords(workbook);
  const decisions = decisionRowsFromWorkbook(workbook);
  const entityRows = buildEntityResolutionRows(workbook);
  const fieldCandidates = buildFieldCandidates(decisions);
  const reviewQueue = buildReviewQueueRows(decisions);
  const evidenceLinks = buildEvidenceLinks(sourceRecords, decisions);

  const insertSource = db.prepare(`
    INSERT INTO source_record (
      source, sheet_name, row_number, entity_type, entity_key, file_path, source_row_id, raw_payload, raw_text
    ) VALUES (
      @source, @sheetName, @rowNumber, @entityType, @entityKey, @filePath, @sourceRowId, @rawPayload, @rawText
    )
  `);
  const insertCandidate = db.prepare(`
    INSERT INTO field_candidate (
      source_sheet, entity_type, entity_key, field_name, raw_value, normalized_value, proposed_value, confidence, status, source_list, evidence_refs, reason
    ) VALUES (
      @sourceSheet, @entityType, @entityKey, @fieldName, @rawValue, @normalizedValue, @proposedValue, @confidence, @status, @sourceList, @evidenceRefs, @reason
    )
  `);
  const insertDecision = db.prepare(`
    INSERT INTO field_decision (
      decision_id, entity_type, entity_key, field_name, raw_value, normalized_value, proposed_value, verified_value,
      confidence, status, human_status, human_verified_value, human_note, evidence_sources, evidence_refs, reason
    ) VALUES (
      @decisionId, @entityType, @entityKey, @fieldName, @rawValue, @normalizedValue, @proposedValue, @verifiedValue,
      @confidence, @status, @humanStatus, @humanVerifiedValue, @humanNote, @evidenceSources, @evidenceRefs, @reason
    )
    ON CONFLICT(decision_id) DO UPDATE SET
      raw_value=excluded.raw_value,
      normalized_value=excluded.normalized_value,
      proposed_value=excluded.proposed_value,
      verified_value=excluded.verified_value,
      confidence=excluded.confidence,
      status=excluded.status,
      evidence_sources=excluded.evidence_sources,
      evidence_refs=excluded.evidence_refs,
      reason=excluded.reason,
      updated_at=CURRENT_TIMESTAMP
  `);
  const insertEntity = db.prepare(`
    INSERT INTO entity_resolution (
      entity_id, entity_type, entity_key, display_value, source_count, exact_count, review_count, reject_count, status, summary_json
    ) VALUES (
      @entityId, @entityType, @entityKey, @displayValue, @sourceCount, @exactCount, @reviewCount, @rejectCount, @status, @summaryJson
    )
    ON CONFLICT(entity_id) DO UPDATE SET
      display_value=excluded.display_value,
      source_count=excluded.source_count,
      exact_count=excluded.exact_count,
      review_count=excluded.review_count,
      reject_count=excluded.reject_count,
      status=excluded.status,
      summary_json=excluded.summary_json,
      updated_at=CURRENT_TIMESTAMP
  `);
  const insertQueue = db.prepare(`
    INSERT INTO review_queue (
      decision_id, entity_type, entity_key, field_name, priority, status, reason, suggested_value, current_value, source_list, evidence_refs, notes
    ) VALUES (
      @decisionId, @entityType, @entityKey, @fieldName, @priority, @status, @reason, @suggestedValue, @currentValue, @sourceList, @evidenceRefs, ''
    )
  `);
  const insertEvidence = db.prepare(`
    INSERT INTO evidence_link (
      source_record_id, decision_id, evidence_type, evidence_ref, detail_json
    ) VALUES (
      @sourceRecordId, @decisionId, @evidenceType, @evidenceRef, @detailJson
    )
  `);

  const insertAll = db.transaction(() => {
    db.prepare(`DELETE FROM evidence_link`).run();
    db.prepare(`DELETE FROM review_queue`).run();
    db.prepare(`DELETE FROM entity_resolution`).run();
    db.prepare(`DELETE FROM field_decision`).run();
    db.prepare(`DELETE FROM field_candidate`).run();
    db.prepare(`DELETE FROM source_record`).run();

    for (const record of sourceRecords) {
      insertSource.run(record);
    }

    for (const candidate of fieldCandidates) {
      insertCandidate.run(candidate);
    }

    for (const decision of decisions) {
      insertDecision.run({
        decisionId: decision.decisionId,
        entityType: decision.entityType,
        entityKey: decision.entityKey,
        fieldName: decision.fieldName,
        rawValue: decision.rawValues,
        normalizedValue: decision.normalizedValue,
        proposedValue: decision.verifiedValue || decision.normalizedValue,
        verifiedValue: decision.verifiedValue || decision.normalizedValue,
        confidence: decision.score,
        status: decision.status,
        humanStatus: "",
        humanVerifiedValue: "",
        humanNote: "",
        evidenceSources: decision.sources,
        evidenceRefs: decision.sources,
        reason: decision.reason,
      });
    }

    for (const row of entityRows) {
      insertEntity.run(row);
    }

    for (const row of reviewQueue) {
      insertQueue.run(row);
    }

    for (const link of evidenceLinks) {
      const sourceRow = db.prepare(`SELECT id FROM source_record WHERE source_row_id = ?`).get(link.source_record_id as string) as { id?: number } | undefined;
      if (!sourceRow?.id) continue;
      insertEvidence.run({
        sourceRecordId: sourceRow.id,
        decisionId: link.decision_id,
        evidenceType: link.evidence_type,
        evidenceRef: link.evidence_ref,
        detailJson: link.detail_json,
      });
    }

    db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(
      "sourceWorkbook",
      sourcePath,
    );
    db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(
      "reviewWorkbook",
      reviewPath,
    );
    db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(
      "builtAt",
      new Date().toISOString(),
    );
  });

  insertAll();
}

function updateStagingFromWorkbook(db: Database.Database, workbook: XLSX.WorkBook) {
  const rows = readSheetRows<WorkbookRow>(workbook, "Pendientes revisión");
  const updateDecision = db.prepare(`
    UPDATE field_decision
    SET human_status = @humanStatus,
        human_verified_value = @humanVerifiedValue,
        human_note = @humanNote,
        verified_value = CASE
          WHEN @humanStatus = 'approve' AND LENGTH(TRIM(@humanVerifiedValue)) > 0 THEN @humanVerifiedValue
          WHEN @humanStatus = 'reject' THEN ''
          WHEN LENGTH(TRIM(@humanVerifiedValue)) > 0 THEN @humanVerifiedValue
          ELSE verified_value
        END,
        updated_at = CURRENT_TIMESTAMP
    WHERE decision_id = @decisionId
  `);
  const updateQueue = db.prepare(`
    UPDATE review_queue
    SET status = @status,
        notes = @notes
    WHERE decision_id = @decisionId
  `);
  const refreshEntity = db.prepare(`
    INSERT INTO entity_resolution (
      entity_id, entity_type, entity_key, display_value, source_count, exact_count, review_count, reject_count, status, summary_json
    ) VALUES (
      @entityId, @entityType, @entityKey, @displayValue, @sourceCount, @exactCount, @reviewCount, @rejectCount, @status, @summaryJson
    )
    ON CONFLICT(entity_id) DO UPDATE SET
      display_value=excluded.display_value,
      source_count=excluded.source_count,
      exact_count=excluded.exact_count,
      review_count=excluded.review_count,
      reject_count=excluded.reject_count,
      status=excluded.status,
      summary_json=excluded.summary_json,
      updated_at=CURRENT_TIMESTAMP
  `);

  const updateAll = db.transaction(() => {
    for (const row of rows) {
      const decisionId = normalizeMaybe(row["Decision ID"] ?? row["decisionId"] ?? "");
      if (!decisionId) continue;
      const humanStatus = parseHumanDecision(row["Decision humana"] ?? row["decisionHumana"] ?? row["reviewDecision"] ?? "");
      const humanVerifiedValue = normalizeDisplay(normalizeMaybe(row["Valor humano"] ?? row["valorHumano"] ?? row["reviewValue"] ?? row["verifiedValue"] ?? ""));
      const humanNote = normalizeDisplay(normalizeMaybe(row["Nota humana"] ?? row["notaHumana"] ?? row["reviewNote"] ?? ""));

      if (!humanStatus && !humanVerifiedValue && !humanNote) continue;

      const current = db
        .prepare(`SELECT decision_id, entity_type, entity_key, field_name, status, verified_value, proposed_value, evidence_sources, evidence_refs FROM field_decision WHERE decision_id = ?`)
        .get(decisionId) as
        | {
            decision_id: string;
            entity_type: string;
            entity_key: string;
            field_name: string;
            status: DecisionStatus;
            verified_value: string;
            proposed_value: string;
            evidence_sources: string;
            evidence_refs: string;
          }
        | undefined;
      if (!current) continue;

      updateDecision.run({
        decisionId,
        humanStatus,
        humanVerifiedValue,
        humanNote,
      });

      const queueStatus = humanStatus === "approve" ? "RESOLVED" : humanStatus === "reject" ? "REJECTED" : "OPEN";
      updateQueue.run({
        decisionId,
        status: queueStatus,
        notes: humanNote,
      });
    }

    const currentDecisions = db.prepare(`SELECT * FROM field_decision`).all() as Array<
      FieldDecisionRow & { human_status: HumanDecision; human_verified_value: string }
    >;
    const grouped = new Map<string, Array<FieldDecisionRow & { human_status: HumanDecision; human_verified_value: string }>>();

    for (const decision of currentDecisions) {
      const key = `${normalizeMasterName(decision.entity_type)}:${normalizeMasterName(decision.entity_key)}`;
      const existing = grouped.get(key) ?? [];
      existing.push({
        decisionId: decision.decision_id,
        entityType: decision.entity_type,
        entityKey: decision.entity_key,
        fieldName: decision.field_name,
        rawValue: decision.raw_value,
        normalizedValue: decision.normalized_value,
        proposedValue: decision.proposed_value,
        verifiedValue: decision.verified_value,
        score: decision.confidence,
        status: decision.status,
        humanStatus: decision.human_status,
        humanVerifiedValue: decision.human_verified_value,
        humanNote: decision.human_note,
        evidenceSources: decision.evidence_sources,
        evidenceRefs: decision.evidence_refs,
        reason: decision.reason,
      });
      grouped.set(key, existing);
    }

    for (const [key, decisionsForEntity] of grouped.entries()) {
      const sourceCount = new Set(decisionsForEntity.flatMap((row) => row.evidenceSources.split(/[|,]/).map((entry) => normalizeDisplay(entry)).filter(Boolean))).size;
      const exactCount = decisionsForEntity.filter((row) => row.status === "auto" && !row.humanStatus).length;
      const reviewCount = decisionsForEntity.filter((row) => row.status === "review" || row.humanStatus === "review").length;
      const rejectCount = decisionsForEntity.filter((row) => row.status === "reject" || row.humanStatus === "reject").length;
      const status = rejectCount > 0 ? "needs-review" : reviewCount > 0 ? "review" : "ready";
      const displayValue =
        decisionsForEntity.find((row) => row.fieldName === "clientName" || row.fieldName === "policyNumber" || row.fieldName === "receiptNumber")?.humanVerifiedValue ||
        decisionsForEntity.find((row) => row.fieldName === "clientName" || row.fieldName === "policyNumber" || row.fieldName === "receiptNumber")?.verifiedValue ||
        decisionsForEntity[0]?.entityKey ||
        key;

      refreshEntity.run({
        entityId: `${key}:resolution`,
        entityType: decisionsForEntity[0]?.entityType ?? "ENTIDAD",
        entityKey: decisionsForEntity[0]?.entityKey ?? key,
        displayValue,
        sourceCount,
        exactCount,
        reviewCount,
        rejectCount,
        status,
        summaryJson: JSON.stringify({
          decisions: decisionsForEntity.length,
          approved: decisionsForEntity.filter((row) => row.humanStatus === "approve").length,
          rejected: decisionsForEntity.filter((row) => row.humanStatus === "reject").length,
          review: decisionsForEntity.filter((row) => row.humanStatus === "review" || row.status === "review").length,
        }),
      });
    }
  });

  updateAll();
}

type StoredFieldDecision = {
  decision_id: string;
  entity_type: string;
  entity_key: string;
  field_name: string;
  raw_value: string;
  normalized_value: string;
  proposed_value: string;
  verified_value: string;
  confidence: number;
  status: DecisionStatus;
  human_status: HumanDecision;
  human_verified_value: string;
  human_note: string;
  evidence_sources: string;
  evidence_refs: string;
  reason: string;
};

type CanonicalEntityRow = Record<string, string | number>;

const CLIENT_NOISE = new Set([
  "CLIENTE",
  "NOMBRE",
  "POLIZA",
  "RECIBO",
  "FACTURA",
  "COMPROBANTE",
  "VIGENCIA",
  "TOTAL",
  "PRIMA",
  "FOLIO",
  "NUMERO",
  "DOCUMENTO",
  "ARCHIVO",
  "CARPETA",
  "PAGO",
  "ASEGURADO",
  "CONTRATANTE",
  "TOMADOR",
]);

function splitValues(value: string) {
  return value
    .split("|")
    .map((item) => normalizeDisplay(item))
    .filter(Boolean);
}

function cleanDecisionValue(decision: StoredFieldDecision) {
  if (decision.human_status === "reject") return "";
  if (decision.human_verified_value) return normalizeDisplay(decision.human_verified_value);
  return normalizeDisplay(decision.verified_value || decision.proposed_value || decision.normalized_value || decision.raw_value);
}

function candidatePartsForField(value: string) {
  const parts = splitValues(value);
  return parts.length > 1 ? parts : [value];
}

function sourcesFromDecision(decision: Pick<StoredFieldDecision, "evidence_sources" | "evidence_refs">) {
  return `${decision.evidence_sources} | ${decision.evidence_refs}`
    .split(/[|,]/)
    .map((source) => normalizeDisplay(source).toLowerCase())
    .filter(Boolean);
}

function sourceWeight(source: string) {
  if (source.includes("lock")) return 120;
  if (source.includes("db")) return 100;
  if (source.includes("saps")) return 90;
  if (source.includes("master")) return 80;
  if (source.includes("revisar")) return 75;
  if (source.includes("pdf")) return 75;
  return 50;
}

function sourcePriorityUsed(sources: Iterable<string>) {
  const normalized = Array.from(sources).map((source) => source.toLowerCase());
  for (const source of ["lock", "db", "saps", "pdf", "master", "revisar", "heuristic"]) {
    if (normalized.some((candidate) => candidate.includes(source))) return source;
  }
  return normalized[0] ?? "unknown";
}

function confidenceFrom(decisions: StoredFieldDecision[]) {
  const sources = new Set(decisions.flatMap(sourcesFromDecision));
  const maxSource = Math.max(0, ...Array.from(sources).map(sourceWeight));
  const maxStored = Math.max(0, ...decisions.map((decision) => Number(decision.confidence) || 0));
  const multiSourceBonus = Math.min(10, Math.max(0, sources.size - 1) * 3);
  return Math.min(100, Math.max(maxSource, maxStored) + multiSourceBonus);
}

function likelyClientName(value: string) {
  const normalized = normalizeMasterName(value);
  if (!normalized || normalized.length < 5 || normalized.length > 120) return false;
  if (/\d/.test(normalized)) return false;
  if (normalized.includes("|")) return false;
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length < 2 || tokens.length > 9) return false;
  if (tokens.every((token) => CLIENT_NOISE.has(token))) return false;
  if (tokens.filter((token) => CLIENT_NOISE.has(token)).length >= tokens.length - 1) return false;
  return true;
}

function likelyPolicyNumber(value: string) {
  const normalized = normalizePolicyNumber(value);
  return Boolean(normalized && normalized.length >= 4 && normalized.length <= 35 && /\d/.test(normalized) && !normalized.includes("|"));
}

function likelyReceiptNumber(value: string) {
  const normalized = normalizeReceiptNumber(value);
  return Boolean(normalized && normalized.length >= 1 && normalized.length <= 35 && /\d/.test(normalized) && !normalized.includes("|"));
}

function simplifyInsurer(value: string) {
  return normalizeMasterName(value)
    .replace(/\b(SEGUROS?|COMPANIA|COMPAÑIA|CIA|DE|MEXICO|MEXICANA|S A|C V|SA|CV|SAB|SAB DE CV)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function simpleColumnsFor(keys: string[]) {
  return keys.map((key) => ({ clave: key, etiqueta: key }));
}

function bestSingleValue(decisions: StoredFieldDecision[], fieldName: string, canonicalLookup?: Map<string, string>) {
  const scores = new Map<string, { display: string; score: number; sources: Set<string>; aliases: Set<string> }>();

  for (const decision of decisions) {
    const value = cleanDecisionValue(decision);
    const parts = candidatePartsForField(value);

    for (const part of parts) {
      if (!part) continue;
      const display =
        fieldName === "policyNumber"
          ? normalizePolicyNumber(part)
          : fieldName === "receiptNumber"
            ? normalizeReceiptNumber(part)
            : fieldName === "insurerName"
              ? canonicalLookup?.get(normalizeMasterName(part)) ?? canonicalLookup?.get(simplifyInsurer(part)) ?? part
              : part;
      if (!display) continue;

      const key = fieldName === "clientName" || fieldName === "referidorName" || fieldName === "insurerName" ? normalizeMasterName(display) : display;
      const existing = scores.get(key) ?? { display, score: 0, sources: new Set<string>(), aliases: new Set<string>() };
      const sources = sourcesFromDecision(decision);
      existing.score = Math.max(existing.score, Number(decision.confidence) || 0, Math.max(...sources.map(sourceWeight), 0));
      for (const source of sources) existing.sources.add(source);
      if (normalizeMasterName(part) !== normalizeMasterName(display)) existing.aliases.add(part);
      scores.set(key, existing);
    }
  }

  const ranked = Array.from(scores.values())
    .map((item) => ({ ...item, score: Math.min(100, item.score + Math.min(10, Math.max(0, item.sources.size - 1) * 3)) }))
    .sort((left, right) => right.score - left.score || left.display.localeCompare(right.display, "es"));
  const best = ranked[0];
  const runnerUp = ranked[1];

  if (!best) return { value: "", confidence: 0, sources: new Set<string>(), aliases: new Set<string>(), issue: "sin candidatos" };

  const structuralValid =
    fieldName === "clientName" || fieldName === "referidorName"
      ? likelyClientName(best.display)
      : fieldName === "policyNumber"
        ? likelyPolicyNumber(best.display)
        : fieldName === "receiptNumber"
          ? likelyReceiptNumber(best.display)
          : Boolean(best.display && !best.display.includes("|"));
  const issue = !structuralValid ? "no pasa validacion estructural" : runnerUp && best.score - runnerUp.score < 10 ? `conflicto con ${runnerUp.display}` : "";

  return { value: best.display, confidence: best.score, sources: best.sources, aliases: best.aliases, issue };
}

function getLocks(db: Database.Database) {
  const rows = db.prepare(`SELECT * FROM canonical_field_lock`).all() as Array<{
    lock_id: string;
    locked_value: string;
    note: string;
  }>;
  return new Map(rows.map((row) => [row.lock_id, row]));
}

function lockId(entityType: string, entityKey: string, fieldName: string) {
  return makeDecisionId(entityType, entityKey, fieldName);
}

function applyLockedValue(
  locks: Map<string, { locked_value: string; note: string }>,
  entityType: string,
  entityKey: string,
  fieldName: string,
  current: ReturnType<typeof bestSingleValue>,
) {
  const lock = locks.get(lockId(entityType, entityKey, fieldName));
  if (!lock) return current;
  const lockedValue = candidatePartsForField(lock.locked_value)[0] ?? "";
  return { ...current, value: lockedValue, confidence: 100, sources: new Set([...current.sources, "lock"]), issue: "" };
}

function fieldRows(decisions: StoredFieldDecision[], entityType: string, entityKey: string, fieldName: string) {
  return decisions.filter(
    (decision) =>
      normalizeMasterName(decision.entity_type) === normalizeMasterName(entityType) &&
      normalizeMasterName(decision.entity_key) === normalizeMasterName(entityKey) &&
      decision.field_name === fieldName,
  );
}

function groupByEntity(decisions: StoredFieldDecision[], entityType: string) {
  const grouped = new Map<string, StoredFieldDecision[]>();
  for (const decision of decisions) {
    if (normalizeMasterName(decision.entity_type) !== normalizeMasterName(entityType)) continue;
    const key = normalizeDisplay(decision.entity_key);
    const existing = grouped.get(key) ?? [];
    existing.push(decision);
    grouped.set(key, existing);
  }
  return grouped;
}

function buildInsurerLookup() {
  const pg = new Database(databasePath, { readonly: true });
  try {
    const insurers = pg.prepare(`SELECT id, name FROM Insurer`).all() as Array<{ id: string; name: string }>;
    const lookup = new Map<string, string>();
    for (const insurer of insurers) {
      lookup.set(normalizeMasterName(insurer.name), insurer.name);
      const simplified = simplifyInsurer(insurer.name);
      if (simplified) lookup.set(simplified, insurer.name);
    }
    return lookup;
  } finally {
    pg.close();
  }
}

function pgIndexes() {
  const pg = new Database(databasePath, { readonly: true });
  try {
    const clients = pg.prepare(`SELECT id, fullName FROM Client`).all() as Array<{ id: string; fullName: string }>;
    const insurers = pg.prepare(`SELECT id, name FROM Insurer`).all() as Array<{ id: string; name: string }>;
    const policies = pg.prepare(`
      SELECT p.id, p.policyNumber, c.fullName AS clientName, i.name AS insurerName
      FROM Policy p
      JOIN Client c ON c.id = p.clientId
      JOIN Insurer i ON i.id = p.insurerId
    `).all() as Array<{ id: string; policyNumber: string; clientName: string; insurerName: string }>;
    const receipts = pg.prepare(`
      SELECT r.id, r.receiptNumber, p.policyNumber
      FROM Receipt r
      LEFT JOIN Policy p ON p.id = r.policyId
    `).all() as Array<{ id: string; receiptNumber: string; policyNumber: string | null }>;
    return {
      clients: new Map(clients.map((client) => [normalizeMasterName(client.fullName), client])),
      insurers: new Map(insurers.map((insurer) => [normalizeMasterName(insurer.name), insurer])),
      policies: new Map(policies.map((policy) => [normalizePolicyNumber(policy.policyNumber), policy])),
      receipts: new Map(receipts.map((receipt) => [`${normalizePolicyNumber(receipt.policyNumber ?? "")}:${normalizeReceiptNumber(receipt.receiptNumber)}`, receipt])),
    };
  } finally {
    pg.close();
  }
}

function cleanStatus(confidence: number, issues: string[]) {
  const meaningfulIssues = issues.filter(Boolean);
  if (meaningfulIssues.length) return "needs_review";
  if (confidence >= 90) return "ready";
  return "needs_review";
}

function sourceRefs(decisions: StoredFieldDecision[]) {
  return Array.from(new Set(decisions.flatMap(sourcesFromDecision))).sort().join(" | ");
}

function makeReviewBatchId() {
  return `batch-${timestampForFile()}-${String(Date.now()).slice(-4)}`;
}

function buildCanonicalCleanRows(db: Database.Database, reviewBatchId: string) {
  const decisions = db.prepare(`SELECT * FROM field_decision`).all() as StoredFieldDecision[];
  const locks = getLocks(db);
  const insurerLookup = buildInsurerLookup();
  const pg = pgIndexes();
  const clients = new Map<string, CanonicalEntityRow>();
  const insurers = new Map<string, CanonicalEntityRow>();
  const policies = new Map<string, CanonicalEntityRow>();
  const receipts = new Map<string, CanonicalEntityRow>();
  const aliases: CanonicalEntityRow[] = [];
  const issues: CanonicalEntityRow[] = [];
  const evidence: CanonicalEntityRow[] = [];
  const previews: CanonicalEntityRow[] = [];

  function addAlias(entityType: string, entityKey: string, aliasValue: string, canonicalValue: string, sources: string, confidence: number) {
    if (!aliasValue || normalizeMasterName(aliasValue) === normalizeMasterName(canonicalValue)) return;
    aliases.push({
      review_batch_id: reviewBatchId,
      entity_type: entityType,
      entity_key: entityKey,
      alias_value: aliasValue,
      normalized_alias: normalizeMasterName(aliasValue),
      canonical_value: canonicalValue,
      source_refs: sources,
      confidence,
    });
  }

  function addIssue(entityType: string, entityKey: string, fieldName: string, reason: string, suggestedValue: string, sources: string, severity = "review") {
    if (!reason) return;
    issues.push({
      review_batch_id: reviewBatchId,
      entity_type: entityType,
      entity_key: entityKey,
      field_name: fieldName,
      severity,
      reason,
      suggested_value: suggestedValue,
      source_refs: sources,
    });
  }

  function addEvidence(entityType: string, entityKey: string, rows: StoredFieldDecision[], confidence: number) {
    const refs = new Set<string>();
    for (const row of rows) {
      for (const ref of splitValues(row.evidence_refs || row.evidence_sources)) refs.add(ref);
    }
    for (const ref of refs) {
      evidence.push({
        review_batch_id: reviewBatchId,
        entity_type: entityType,
        entity_key: entityKey,
        source: sourcePriorityUsed([ref]),
        evidence_ref: ref,
        detail: "",
        confidence,
      });
    }
  }

  function upsertClient(name: string, referidorName: string, rows: StoredFieldDecision[], extraIssue = "") {
    if (!name) return "";
    const normalizedName = normalizeMasterName(name);
    if (!likelyClientName(name)) {
      addIssue("CLIENTE", normalizedName || name, "fullName", "nombre de cliente sospechoso", name, sourceRefs(rows), "reject");
      return "";
    }
    const clientKey = normalizedName;
    const confidence = confidenceFrom(rows);
    const referidorClean = referidorName && normalizeMasterName(referidorName) !== normalizedName && likelyClientName(referidorName) ? referidorName : "";
    const rowIssues = [extraIssue, confidence < 90 ? "confianza menor a 90" : ""].filter(Boolean);
    const existing = clients.get(clientKey);
    if (existing && Number(existing.confidence) >= confidence) return clientKey;
    clients.set(clientKey, {
      review_batch_id: reviewBatchId,
      client_key: clientKey,
      full_name: name,
      normalized_name: normalizedName,
      type: /\b(SA|S A|SAPI|SC|SRL|S DE RL|CV)\b/.test(normalizedName) ? "COMPANY" : "PERSON",
      referidor_client_key: referidorClean ? normalizeMasterName(referidorClean) : "",
      referidor_name: referidorClean,
      source_refs: sourceRefs(rows),
      source_priority_used: sourcePriorityUsed(rows.flatMap(sourcesFromDecision)),
      confidence,
      clean_status: cleanStatus(confidence, rowIssues),
      review_reason: rowIssues.join(" | "),
      review_decision: "",
      review_value: "",
      review_note: "",
      lock_field: locks.has(lockId("CLIENTE", clientKey, "clientName")) ? "yes" : "",
    });
    addEvidence("CLIENTE", clientKey, rows, confidence);
    for (const row of rows) addAlias("CLIENTE", clientKey, cleanDecisionValue(row), name, sourceRefs(rows), confidence);
    return clientKey;
  }

  function upsertInsurer(name: string, rows: StoredFieldDecision[]) {
    if (!name) return "";
    const canonical = insurerLookup.get(normalizeMasterName(name)) ?? insurerLookup.get(simplifyInsurer(name)) ?? name;
    const insurerKey = normalizeMasterName(canonical);
    if (!insurerKey) return "";
    const confidence = Math.max(80, confidenceFrom(rows));
    const rowIssues = [confidence < 90 ? "aseguradora requiere confirmacion" : ""].filter(Boolean);
    const existing = insurers.get(insurerKey);
    if (existing && Number(existing.confidence) >= confidence) return insurerKey;
    insurers.set(insurerKey, {
      review_batch_id: reviewBatchId,
      insurer_key: insurerKey,
      name: canonical,
      normalized_name: insurerKey,
      source_refs: sourceRefs(rows),
      source_priority_used: sourcePriorityUsed(rows.flatMap(sourcesFromDecision)),
      confidence,
      clean_status: cleanStatus(confidence, rowIssues),
      review_reason: rowIssues.join(" | "),
      review_decision: "",
      review_value: "",
      review_note: "",
      lock_field: locks.has(lockId("ASEGURADORA", insurerKey, "insurerName")) ? "yes" : "",
    });
    addEvidence("ASEGURADORA", insurerKey, rows, confidence);
    for (const row of rows) addAlias("ASEGURADORA", insurerKey, cleanDecisionValue(row), canonical, sourceRefs(rows), confidence);
    return insurerKey;
  }

  for (const [entityKey, rows] of groupByEntity(decisions, "CLIENTE")) {
    const name = applyLockedValue(locks, "CLIENTE", entityKey, "clientName", bestSingleValue(fieldRows(decisions, "CLIENTE", entityKey, "clientName"), "clientName")).value;
    const referidor = applyLockedValue(locks, "CLIENTE", entityKey, "referidorName", bestSingleValue(fieldRows(decisions, "CLIENTE", entityKey, "referidorName"), "referidorName")).value;
    upsertClient(name || entityKey, referidor, rows);
  }

  for (const [entityKey, rows] of groupByEntity(decisions, "POLIZA")) {
    const policyDecision = applyLockedValue(locks, "POLIZA", entityKey, "policyNumber", bestSingleValue(fieldRows(decisions, "POLIZA", entityKey, "policyNumber"), "policyNumber"));
    const policyNumber = normalizePolicyNumber(policyDecision.value || entityKey);
    if (!likelyPolicyNumber(policyNumber)) continue;

    const clientDecision = applyLockedValue(locks, "POLIZA", entityKey, "clientName", bestSingleValue(fieldRows(decisions, "POLIZA", entityKey, "clientName"), "clientName"));
    const insurerDecision = applyLockedValue(locks, "POLIZA", entityKey, "insurerName", bestSingleValue(fieldRows(decisions, "POLIZA", entityKey, "insurerName"), "insurerName", insurerLookup));
    const referidorDecision = applyLockedValue(locks, "POLIZA", entityKey, "referidorName", bestSingleValue(fieldRows(decisions, "POLIZA", entityKey, "referidorName"), "referidorName"));
    const confidence = Math.min(policyDecision.confidence, Math.max(clientDecision.confidence, 50), Math.max(insurerDecision.confidence, 50));
    const clientKey = upsertClient(clientDecision.value, referidorDecision.value, rows, clientDecision.issue);
    const insurerKey = upsertInsurer(insurerDecision.value, rows);
    const rowIssues = [
      policyDecision.issue,
      clientDecision.issue,
      insurerDecision.issue,
      !clientKey ? "cliente faltante o dudoso" : "",
      !insurerKey ? "aseguradora faltante o dudosa" : "",
      confidence < 90 ? "confianza menor a 90" : "",
    ].filter(Boolean);
    policies.set(policyNumber, {
      review_batch_id: reviewBatchId,
      policy_number: policyNumber,
      client_key: clientKey,
      client_name: clientDecision.value,
      insurer_key: insurerKey,
      insurer_name: insurerDecision.value,
      policy_type: "",
      status: "",
      start_date: "",
      end_date: "",
      renewal_date: "",
      premium_amount: "",
      currency: "MXN",
      source_refs: sourceRefs(rows),
      source_priority_used: sourcePriorityUsed(rows.flatMap(sourcesFromDecision)),
      confidence,
      clean_status: cleanStatus(confidence, rowIssues),
      review_reason: rowIssues.join(" | "),
      review_decision: "",
      review_value: "",
      review_note: "",
      lock_field: locks.has(lockId("POLIZA", entityKey, "policyNumber")) ? "yes" : "",
    });
    addEvidence("POLIZA", policyNumber, rows, confidence);
    for (const issue of rowIssues) addIssue("POLIZA", policyNumber, "policy", issue, policyNumber, sourceRefs(rows));

    for (const row of fieldRows(decisions, "POLIZA", entityKey, "receiptNumber")) {
      for (const receiptNumber of splitValues(cleanDecisionValue(row)).map(normalizeReceiptNumber).filter(Boolean)) {
        if (!likelyReceiptNumber(receiptNumber)) continue;
        const receiptKey = `${policyNumber}:${receiptNumber}`;
        const receiptConfidence = Math.max(confidence, sourceWeight(sourcePriorityUsed(sourcesFromDecision(row))));
        const receiptIssues = [receiptConfidence < 90 ? "confianza menor a 90" : ""].filter(Boolean);
        receipts.set(receiptKey, {
          review_batch_id: reviewBatchId,
          receipt_key: receiptKey,
          policy_number: policyNumber,
          receipt_number: receiptNumber,
          client_key: clientKey,
          client_name: clientDecision.value,
          insurer_key: insurerKey,
          insurer_name: insurerDecision.value,
          amount: "",
          currency: "MXN",
          due_date: "",
          status: "",
          source_refs: sourceRefs([row]),
          source_priority_used: sourcePriorityUsed(sourcesFromDecision(row)),
          confidence: receiptConfidence,
          clean_status: cleanStatus(receiptConfidence, receiptIssues),
          review_reason: receiptIssues.join(" | "),
          review_decision: "",
          review_value: "",
          review_note: "",
          lock_field: locks.has(lockId("RECIBO", receiptKey, "receiptNumber")) ? "yes" : "",
        });
      }
    }
  }

  for (const [entityKey, rows] of groupByEntity(decisions, "RECIBO")) {
    const receiptDecision = applyLockedValue(locks, "RECIBO", entityKey, "receiptNumber", bestSingleValue(fieldRows(decisions, "RECIBO", entityKey, "receiptNumber"), "receiptNumber"));
    const policyDecision = applyLockedValue(locks, "RECIBO", entityKey, "policyNumber", bestSingleValue(fieldRows(decisions, "RECIBO", entityKey, "policyNumber"), "policyNumber"));
    const clientDecision = applyLockedValue(locks, "RECIBO", entityKey, "clientName", bestSingleValue(fieldRows(decisions, "RECIBO", entityKey, "clientName"), "clientName"));
    const insurerDecision = applyLockedValue(locks, "RECIBO", entityKey, "insurerName", bestSingleValue(fieldRows(decisions, "RECIBO", entityKey, "insurerName"), "insurerName", insurerLookup));
    const receiptNumber = normalizeReceiptNumber(receiptDecision.value || entityKey);
    if (!likelyReceiptNumber(receiptNumber)) continue;
    const policyNumber = normalizePolicyNumber(policyDecision.value);
    const clientKey = upsertClient(clientDecision.value, "", rows, clientDecision.issue);
    const insurerKey = upsertInsurer(insurerDecision.value, rows);
    const receiptKey = `${policyNumber || "SIN_POLIZA"}:${receiptNumber}`;
    const confidence = confidenceFrom(rows);
    const rowIssues = [receiptDecision.issue, policyNumber ? "" : "recibo sin poliza", confidence < 90 ? "confianza menor a 90" : ""].filter(Boolean);
    receipts.set(receiptKey, {
      review_batch_id: reviewBatchId,
      receipt_key: receiptKey,
      policy_number: policyNumber,
      receipt_number: receiptNumber,
      client_key: clientKey,
      client_name: clientDecision.value,
      insurer_key: insurerKey,
      insurer_name: insurerDecision.value,
      amount: "",
      currency: "MXN",
      due_date: "",
      status: "",
      source_refs: sourceRefs(rows),
      source_priority_used: sourcePriorityUsed(rows.flatMap(sourcesFromDecision)),
      confidence,
      clean_status: cleanStatus(confidence, rowIssues),
      review_reason: rowIssues.join(" | "),
      review_decision: "",
      review_value: "",
      review_note: "",
      lock_field: locks.has(lockId("RECIBO", entityKey, "receiptNumber")) ? "yes" : "",
    });
    for (const issue of rowIssues) addIssue("RECIBO", receiptKey, "receipt", issue, receiptNumber, sourceRefs(rows));
  }

  for (const row of clients.values()) {
    const existing = pg.clients.get(String(row.normalized_name));
    const action = row.clean_status !== "ready" ? "needs_review" : existing ? (existing.fullName === row.full_name ? "unchanged" : "update") : "create";
    previews.push({
      review_batch_id: reviewBatchId,
      entity_type: "CLIENTE",
      entity_key: row.client_key,
      action,
      current_value: existing?.fullName ?? "",
      proposed_value: row.full_name,
      reason: action === "needs_review" ? String(row.review_reason) : "",
      clean_status: row.clean_status,
    });
  }
  for (const row of insurers.values()) {
    const existing = pg.insurers.get(String(row.normalized_name));
    const action = row.clean_status !== "ready" ? "needs_review" : existing ? "unchanged" : "create";
    previews.push({
      review_batch_id: reviewBatchId,
      entity_type: "ASEGURADORA",
      entity_key: row.insurer_key,
      action,
      current_value: existing?.name ?? "",
      proposed_value: row.name,
      reason: action === "needs_review" ? String(row.review_reason) : "",
      clean_status: row.clean_status,
    });
  }
  for (const row of policies.values()) {
    const existing = pg.policies.get(String(row.policy_number));
    const differs = existing && (normalizeMasterName(existing.clientName) !== row.client_key || normalizeMasterName(existing.insurerName) !== row.insurer_key);
    const action = row.clean_status !== "ready" ? "needs_review" : existing ? (differs ? "update" : "unchanged") : "create";
    previews.push({
      review_batch_id: reviewBatchId,
      entity_type: "POLIZA",
      entity_key: row.policy_number,
      action,
      current_value: existing ? `${existing.clientName} | ${existing.insurerName}` : "",
      proposed_value: `${row.client_name} | ${row.insurer_name}`,
      reason: action === "needs_review" ? String(row.review_reason) : differs ? "cliente o aseguradora diferente" : "",
      clean_status: row.clean_status,
    });
  }
  for (const row of receipts.values()) {
    const existing = pg.receipts.get(String(row.receipt_key));
    const action = row.clean_status !== "ready" ? "needs_review" : existing ? "unchanged" : "create";
    previews.push({
      review_batch_id: reviewBatchId,
      entity_type: "RECIBO",
      entity_key: row.receipt_key,
      action,
      current_value: existing ? `${existing.policyNumber ?? ""}:${existing.receiptNumber}` : "",
      proposed_value: row.receipt_key,
      reason: action === "needs_review" ? String(row.review_reason) : "",
      clean_status: row.clean_status,
    });
  }

  return {
    clients: Array.from(clients.values()),
    insurers: Array.from(insurers.values()),
    policies: Array.from(policies.values()),
    receipts: Array.from(receipts.values()),
    aliases,
    issues,
    evidence,
    previews,
  };
}

function insertCanonicalCleanRows(db: Database.Database, reviewBatchId: string, clean: ReturnType<typeof buildCanonicalCleanRows>) {
  const insertBatch = db.prepare(`INSERT INTO canonical_review_batch (review_batch_id, source_summary) VALUES (?, ?)`);
  const insertClient = db.prepare(`
    INSERT INTO canonical_client (
      review_batch_id, client_key, full_name, normalized_name, type, referidor_client_key, referidor_name,
      source_refs, source_priority_used, confidence, clean_status, review_reason, review_decision, review_value, review_note, lock_field
    ) VALUES (
      @review_batch_id, @client_key, @full_name, @normalized_name, @type, @referidor_client_key, @referidor_name,
      @source_refs, @source_priority_used, @confidence, @clean_status, @review_reason, @review_decision, @review_value, @review_note, @lock_field
    )
  `);
  const insertInsurer = db.prepare(`
    INSERT INTO canonical_insurer (
      review_batch_id, insurer_key, name, normalized_name, source_refs, source_priority_used, confidence, clean_status,
      review_reason, review_decision, review_value, review_note, lock_field
    ) VALUES (
      @review_batch_id, @insurer_key, @name, @normalized_name, @source_refs, @source_priority_used, @confidence, @clean_status,
      @review_reason, @review_decision, @review_value, @review_note, @lock_field
    )
  `);
  const insertPolicy = db.prepare(`
    INSERT INTO canonical_policy (
      review_batch_id, policy_number, client_key, client_name, insurer_key, insurer_name, policy_type, status,
      start_date, end_date, renewal_date, premium_amount, currency, source_refs, source_priority_used, confidence,
      clean_status, review_reason, review_decision, review_value, review_note, lock_field
    ) VALUES (
      @review_batch_id, @policy_number, @client_key, @client_name, @insurer_key, @insurer_name, @policy_type, @status,
      @start_date, @end_date, @renewal_date, @premium_amount, @currency, @source_refs, @source_priority_used, @confidence,
      @clean_status, @review_reason, @review_decision, @review_value, @review_note, @lock_field
    )
  `);
  const insertReceipt = db.prepare(`
    INSERT INTO canonical_receipt (
      review_batch_id, receipt_key, policy_number, receipt_number, client_key, client_name, insurer_key, insurer_name,
      amount, currency, due_date, status, source_refs, source_priority_used, confidence, clean_status, review_reason,
      review_decision, review_value, review_note, lock_field
    ) VALUES (
      @review_batch_id, @receipt_key, @policy_number, @receipt_number, @client_key, @client_name, @insurer_key, @insurer_name,
      @amount, @currency, @due_date, @status, @source_refs, @source_priority_used, @confidence, @clean_status, @review_reason,
      @review_decision, @review_value, @review_note, @lock_field
    )
  `);
  const insertEvidence = db.prepare(`
    INSERT INTO canonical_document_evidence (review_batch_id, entity_type, entity_key, source, evidence_ref, detail, confidence)
    VALUES (@review_batch_id, @entity_type, @entity_key, @source, @evidence_ref, @detail, @confidence)
  `);
  const insertIssue = db.prepare(`
    INSERT INTO canonical_review_issue (review_batch_id, entity_type, entity_key, field_name, severity, reason, suggested_value, source_refs)
    VALUES (@review_batch_id, @entity_type, @entity_key, @field_name, @severity, @reason, @suggested_value, @source_refs)
  `);
  const insertAlias = db.prepare(`
    INSERT INTO canonical_alias (review_batch_id, entity_type, entity_key, alias_value, normalized_alias, canonical_value, source_refs, confidence)
    VALUES (@review_batch_id, @entity_type, @entity_key, @alias_value, @normalized_alias, @canonical_value, @source_refs, @confidence)
  `);
  const insertPreview = db.prepare(`
    INSERT INTO canonical_promotion_preview (review_batch_id, entity_type, entity_key, action, current_value, proposed_value, reason, clean_status)
    VALUES (@review_batch_id, @entity_type, @entity_key, @action, @current_value, @proposed_value, @reason, @clean_status)
  `);

  const insertAll = db.transaction(() => {
    insertBatch.run(
      reviewBatchId,
      JSON.stringify({
        clients: clean.clients.length,
        insurers: clean.insurers.length,
        policies: clean.policies.length,
        receipts: clean.receipts.length,
      }),
    );
    for (const row of clean.clients) insertClient.run(row);
    for (const row of clean.insurers) insertInsurer.run(row);
    for (const row of clean.policies) insertPolicy.run(row);
    for (const row of clean.receipts) insertReceipt.run(row);
    for (const row of clean.evidence) insertEvidence.run(row);
    for (const row of clean.issues) insertIssue.run(row);
    for (const row of clean.aliases) insertAlias.run(row);
    for (const row of clean.previews) insertPreview.run(row);
  });

  insertAll();
}

function canonicalWorkbook(reviewBatchId: string, clean: ReturnType<typeof buildCanonicalCleanRows>, locks: CanonicalEntityRow[]) {
  const readyRows = [...clean.clients, ...clean.insurers, ...clean.policies, ...clean.receipts].filter((row) => row.clean_status === "ready");
  const reviewRows = [...clean.clients, ...clean.insurers, ...clean.policies, ...clean.receipts].filter((row) => row.clean_status !== "ready");
  const rejectedRows = clean.issues.filter((row) => row.severity === "reject");
  const summaryRows = [
    { grupo: "batch", metrica: "Review batch", valor: reviewBatchId, detalle: "" },
    { grupo: "canonical", metrica: "Clientes", valor: clean.clients.length, detalle: `${clean.clients.filter((row) => row.clean_status === "ready").length} ready` },
    { grupo: "canonical", metrica: "Aseguradoras", valor: clean.insurers.length, detalle: `${clean.insurers.filter((row) => row.clean_status === "ready").length} ready` },
    { grupo: "canonical", metrica: "Polizas", valor: clean.policies.length, detalle: `${clean.policies.filter((row) => row.clean_status === "ready").length} ready` },
    { grupo: "canonical", metrica: "Recibos", valor: clean.receipts.length, detalle: `${clean.receipts.filter((row) => row.clean_status === "ready").length} ready` },
    { grupo: "canonical", metrica: "Promotion creates", valor: clean.previews.filter((row) => row.action === "create").length, detalle: "" },
    { grupo: "canonical", metrica: "Promotion updates", valor: clean.previews.filter((row) => row.action === "update").length, detalle: "" },
    { grupo: "canonical", metrica: "Needs review", valor: clean.previews.filter((row) => row.action === "needs_review").length, detalle: "" },
  ];

  return toWorkbook([
    { nombre: "Resumen", columnas: simpleColumnsFor(["grupo", "metrica", "valor", "detalle"]), filas: summaryRows },
    { nombre: "Clientes limpios", columnas: simpleColumnsFor(Object.keys(clean.clients[0] ?? {})), filas: clean.clients },
    { nombre: "Aseguradoras limpias", columnas: simpleColumnsFor(Object.keys(clean.insurers[0] ?? {})), filas: clean.insurers },
    { nombre: "Polizas limpias", columnas: simpleColumnsFor(Object.keys(clean.policies[0] ?? {})), filas: clean.policies },
    { nombre: "Recibos limpios", columnas: simpleColumnsFor(Object.keys(clean.receipts[0] ?? {})), filas: clean.receipts },
    { nombre: "Listo para importar", columnas: simpleColumnsFor(Object.keys(readyRows[0] ?? {})), filas: readyRows },
    { nombre: "Cambios propuestos vs DB", columnas: simpleColumnsFor(Object.keys(clean.previews[0] ?? {})), filas: clean.previews },
    { nombre: "Promotion preview", columnas: simpleColumnsFor(Object.keys(clean.previews[0] ?? {})), filas: clean.previews },
    { nombre: "Alias detectados", columnas: simpleColumnsFor(Object.keys(clean.aliases[0] ?? {})), filas: clean.aliases },
    { nombre: "Campos bloqueados", columnas: simpleColumnsFor(["lock_id", "entity_type", "entity_key", "field_name", "locked_value", "locked_by", "locked_at", "note"]), filas: locks },
    { nombre: "Requiere revision", columnas: simpleColumnsFor(Object.keys(reviewRows[0] ?? {})), filas: reviewRows },
    { nombre: "Rechazados", columnas: simpleColumnsFor(Object.keys(rejectedRows[0] ?? {})), filas: rejectedRows },
    { nombre: "Evidencia", columnas: simpleColumnsFor(Object.keys(clean.evidence[0] ?? {})), filas: clean.evidence },
    {
      nombre: "Reglas",
      columnas: simpleColumnsFor(["regla", "descripcion"]),
      filas: [
        { regla: "Referidor", descripcion: "Campo dentro de cliente: referidorClientKey y referidorName." },
        { regla: "Poliza", descripcion: "Una fila por policyNumber normalizado." },
        { regla: "Recibo", descripcion: "Valores compuestos se separan en recibos individuales." },
        { regla: "Conservadora", descripcion: "Lo dudoso queda en needs_review." },
      ],
    },
  ]);
}

async function clean() {
  await ensureDataDirs();
  const args = parseCliArgs();
  const outPath = getFlag(args, "out") ?? path.join(exportsDir, `canonical-clean-first-pass-${timestampForFile()}.xlsx`);
  const db = await createDb(false);
  try {
    ensureSchema(db);
    const reviewBatchId = makeReviewBatchId();
    const cleanRows = buildCanonicalCleanRows(db, reviewBatchId);
    insertCanonicalCleanRows(db, reviewBatchId, cleanRows);
    const locks = db.prepare(`SELECT * FROM canonical_field_lock`).all() as CanonicalEntityRow[];
    XLSX.writeFile(canonicalWorkbook(reviewBatchId, cleanRows, locks), outPath, { bookType: "xlsx" });
    db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run("lastCleanBatch", reviewBatchId);
    db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run("lastCleanWorkbook", outPath);
    console.log(`Batch canónico: ${reviewBatchId}`);
    console.log(`Workbook limpio: ${outPath}`);
    console.log(`Clientes: ${cleanRows.clients.length}`);
    console.log(`Aseguradoras: ${cleanRows.insurers.length}`);
    console.log(`Pólizas: ${cleanRows.policies.length}`);
    console.log(`Recibos: ${cleanRows.receipts.length}`);
    console.log(`Listo para importar: ${cleanRows.previews.filter((row) => row.action === "create" || row.action === "update" || row.action === "unchanged").length}`);
    console.log(`Requiere revisión: ${cleanRows.previews.filter((row) => row.action === "needs_review").length}`);
  } finally {
    db.close();
  }
}

async function build() {
  const args = parseCliArgs();
  const sourcePath = getFlag(args, "source");
  const outPath = getFlag(args, "out") ?? DEFAULT_REVIEW_OUT;

  await ensureDataDirs();

  const sourceWorkbookPath =
    sourcePath ? path.resolve(sourcePath) : await latestWorkbookPath(DEFAULT_CLEAN_WORKBOOK_PREFIXES);
  if (!sourceWorkbookPath) {
    throw new Error(
      "No se encontró workbook fuente. Genera primero `npm run clean:four-source-fields` o pasa `--source`.",
    );
  }

  const workbook = XLSX.readFile(sourceWorkbookPath, { cellDates: true });
  const db = await createDb(true);
  try {
    ensureSchema(db);
    const reviewWorkbook = buildWorkbookFromStaging(
      sourceWorkbookPath,
      decisionRowsFromWorkbook(workbook),
      buildEntityResolutionRows(workbook),
      collectSourceRecords(workbook),
      buildReviewQueueRows(decisionRowsFromWorkbook(workbook)),
    );

    upsertStaging(db, workbook, sourceWorkbookPath, outPath);

    await fs.mkdir(path.dirname(outPath), { recursive: true });
    XLSX.writeFile(reviewWorkbook, outPath, { bookType: "xlsx" });

    console.log(`Base staging creada en ${stagingDatabasePath}`);
    console.log(`Workbook de revisión generado en ${outPath}`);
  } finally {
    db.close();
  }
}

async function apply() {
  const args = parseCliArgs();
  const sourcePath = getFlag(args, "source");

  await ensureDataDirs();

  const workbookPath =
    sourcePath ? path.resolve(sourcePath) : await latestWorkbookPath(["canonical-review-"]);
  if (!workbookPath) {
    throw new Error("No se encontró workbook de revisión. Ejecuta primero `npm run staging:build`.");
  }

  const workbook = XLSX.readFile(workbookPath, { cellDates: true });
  const db = await createDb(false);
  try {
    ensureSchema(db);
    updateStagingFromWorkbook(db, workbook);
    db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(
      "lastAppliedWorkbook",
      workbookPath,
    );
    console.log(`Decisiones aplicadas desde ${workbookPath}`);
    console.log(`Base staging actualizada en ${stagingDatabasePath}`);
  } finally {
    db.close();
  }
}

async function main() {
  const args = parseCliArgs();
  const command = (args.positionals[0] ?? "build").toLowerCase();

  if (command === "apply") {
    await apply();
    return;
  }

  if (command === "clean") {
    await clean();
    return;
  }

  await build();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
