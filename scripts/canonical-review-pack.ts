#!/usr/bin/env tsx

import fs from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";
import * as XLSX from "@e965/xlsx";

import {
  databasePath,
  ensureDataDirs,
  exportsDir,
  getFlag,
  parseCliArgs,
  stagingDatabasePath,
  timestampForFile,
  compactText,
} from "./_shared";
import { toWorkbook } from "../src/lib/export";
import { normalizeMasterName, normalizePolicyNumber, normalizeReceiptNumber } from "../src/lib/master-folder";

type LatestBatch = {
  review_batch_id: string;
  imported_at: string;
  summary_json: string;
};

type ReviewRow = Record<string, string | number | boolean>;

type ReviewItem = {
  traceId: string;
  category: string;
  severity: string;
  entityType: string;
  entityKey: string;
  fieldName: string;
  action: string;
  currentValue: string;
  proposedValue: string;
  reason: string;
  sourceRefs: string;
  reviewDecision: string;
  reviewValue: string;
  reviewNote: string;
  lockField: string;
  batchId: string;
  notes: string;
};

type PgIndexes = ReturnType<typeof loadPgIndexes>;

const DEFAULT_OUT = path.join(exportsDir, `canonical-review-pack-${timestampForFile()}.xlsx`);

function columnsFor<T>(keys: Array<keyof T & string>) {
  return keys.map((key) => ({ clave: key, etiqueta: key }));
}

function buildReviewWorkbook(rows: ReviewItem[], summaryRows: ReviewRow[], batchId: string) {
  const sheet = toWorkbook([
    {
      nombre: "Resumen",
      columnas: columnsFor<ReviewRow>(["grupo", "metrica", "valor", "detalle"]),
      filas: [
        { grupo: "Batch", metrica: "Review batch", valor: batchId, detalle: "" },
        { grupo: "Batch", metrica: "Fuente", valor: "Fuente externa", detalle: "Vista limpia de solo excepciones." },
        ...summaryRows,
      ],
    },
    {
      nombre: "Exceptions only",
      columnas: columnsFor<ReviewItem>([
        "traceId",
        "category",
        "severity",
        "entityType",
        "entityKey",
        "fieldName",
        "action",
        "currentValue",
        "proposedValue",
        "reason",
        "sourceRefs",
        "reviewDecision",
        "reviewValue",
        "reviewNote",
        "lockField",
        "batchId",
        "notes",
      ]),
      filas: rows,
    },
  ]);

  const reviewSheet = sheet.Sheets["Exceptions only"];
  if (reviewSheet?.["!ref"]) {
    reviewSheet["!autofilter"] = { ref: reviewSheet["!ref"] };
  }

  return sheet;
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

    return {
      clients,
      insurers,
      policies,
      receipts,
      clientsByKey: new Map(clients.map((client) => [normalizeMasterName(client.fullName), client])),
      insurersByKey: new Map(insurers.map((insurer) => [normalizeMasterName(insurer.name), insurer])),
      policiesByKey: new Map(policies.map((policy) => [normalizePolicyNumber(String(policy.policyNumber ?? "")), policy])),
      receiptsByKey: new Map(receipts.map((receipt) => [`${normalizePolicyNumber(String(receipt.policyNumber ?? ""))}:${normalizeReceiptNumber(String(receipt.receiptNumber ?? ""))}`, receipt])),
    };
  } finally {
    pg.close();
  }
}

function loadLatestBatch(db: Database.Database, requestedBatch?: string) {
  if (requestedBatch) {
    const row = db
      .prepare(`SELECT review_batch_id, imported_at, summary_json FROM external_ledger_import WHERE review_batch_id = ?`)
      .get(requestedBatch) as LatestBatch | undefined;
    return row ?? null;
  }

  const row = db
    .prepare(`SELECT review_batch_id, imported_at, summary_json FROM external_ledger_import WHERE status = 'COMPLETED' ORDER BY imported_at DESC LIMIT 1`)
    .get() as LatestBatch | undefined;
  return row ?? null;
}

function buildExceptions(db: Database.Database, batchId: string, pg: PgIndexes) {
  const issues = db.prepare(`SELECT * FROM canonical_review_issue WHERE review_batch_id = ? ORDER BY severity DESC, entity_type, entity_key`).all(batchId) as Array<Record<string, unknown>>;
  const quarantines = db.prepare(`SELECT * FROM canonical_quarantine WHERE review_batch_id = ? ORDER BY entity_type, entity_key`).all(batchId) as Array<Record<string, unknown>>;
  const merges = db.prepare(`SELECT * FROM canonical_merge_suggestion WHERE review_batch_id = ? ORDER BY score DESC, entity_type, left_key, right_key`).all(batchId) as Array<Record<string, unknown>>;
  const preview = db.prepare(`
    SELECT p.*, 
           COALESCE(c.source_refs, i.source_refs, r.source_refs, '') AS source_refs
    FROM canonical_promotion_preview p
    LEFT JOIN canonical_client c ON c.review_batch_id = p.review_batch_id AND p.entity_type = 'CLIENTE' AND c.client_key = p.entity_key
    LEFT JOIN canonical_insurer i ON i.review_batch_id = p.review_batch_id AND p.entity_type = 'ASEGURADORA' AND i.insurer_key = p.entity_key
    LEFT JOIN canonical_policy r ON r.review_batch_id = p.review_batch_id AND p.entity_type = 'POLIZA' AND r.policy_number = p.entity_key
    LEFT JOIN canonical_receipt rc ON rc.review_batch_id = p.review_batch_id AND p.entity_type = 'RECIBO' AND rc.receipt_key = p.entity_key
    WHERE p.review_batch_id = ? AND p.action <> 'unchanged'
    ORDER BY CASE p.action WHEN 'needs_review' THEN 0 WHEN 'update' THEN 1 WHEN 'create' THEN 2 ELSE 3 END, p.entity_type, p.entity_key
  `).all(batchId) as Array<Record<string, unknown>>;
  const locks = db.prepare(`SELECT * FROM canonical_field_lock ORDER BY entity_type, entity_key, field_name`).all() as Array<Record<string, unknown>>;

  const rows: ReviewItem[] = [];

  for (const row of issues) {
    rows.push({
      traceId: `issue:${row.id}`,
      category: "issue",
      severity: String(row.severity ?? "warning"),
      entityType: String(row.entity_type ?? ""),
      entityKey: String(row.entity_key ?? ""),
      fieldName: String(row.field_name ?? ""),
      action: "review",
      currentValue: "",
      proposedValue: String(row.suggested_value ?? ""),
      reason: String(row.reason ?? ""),
      sourceRefs: String(row.source_refs ?? ""),
      reviewDecision: "",
      reviewValue: "",
      reviewNote: "",
      lockField: "",
      batchId,
      notes: "",
    });
  }

  for (const row of quarantines) {
    rows.push({
      traceId: `quarantine:${row.quarantine_key}`,
      category: "quarantine",
      severity: "warning",
      entityType: String(row.entity_type ?? ""),
      entityKey: String(row.entity_key ?? ""),
      fieldName: "",
      action: "review",
      currentValue: "",
      proposedValue: "",
      reason: String(row.reason ?? ""),
      sourceRefs: String(row.source_refs ?? ""),
      reviewDecision: "",
      reviewValue: "",
      reviewNote: "",
      lockField: "",
      batchId,
      notes: compactText(row.detail_json, 180),
    });
  }

  for (const row of merges) {
    rows.push({
      traceId: `merge:${row.suggestion_key}`,
      category: "merge_suggestion",
      severity: Number(row.score ?? 0) >= 80 ? "warning" : "info",
      entityType: String(row.entity_type ?? ""),
      entityKey: String(row.suggestion_key ?? ""),
      fieldName: "merge",
      action: "approve/reject",
      currentValue: `${row.left_label ?? ""}`,
      proposedValue: `${row.right_label ?? ""}`,
      reason: String(row.reason ?? ""),
      sourceRefs: "",
      reviewDecision: String(row.review_decision ?? ""),
      reviewValue: "",
      reviewNote: String(row.review_note ?? ""),
      lockField: "",
      batchId,
      notes: `score=${row.score ?? 0}`,
    });
  }

  for (const row of preview) {
    const entityType = String(row.entity_type ?? "");
    const entityKey = String(row.entity_key ?? "");
    let sourceRefs = String(row.source_refs ?? "");
    if (!sourceRefs) {
      if (entityType === "CLIENTE" && pg.clientsByKey.has(normalizeMasterName(entityKey))) {
        sourceRefs = "Fuente externa";
      } else if (entityType === "ASEGURADORA" && pg.insurersByKey.has(normalizeMasterName(entityKey))) {
        sourceRefs = "Fuente externa";
      } else if (entityType === "POLIZA" && pg.policiesByKey.has(normalizePolicyNumber(entityKey))) {
        sourceRefs = "Fuente externa";
      } else if (entityType === "RECIBO" && pg.receiptsByKey.has(entityKey)) {
        sourceRefs = "Fuente externa";
      }
    }

    rows.push({
      traceId: `preview:${entityType}:${entityKey}`,
      category: "promotion_preview",
      severity: row.action === "needs_review" ? "critical" : row.action === "update" ? "warning" : "info",
      entityType,
      entityKey,
      fieldName: "",
      action: String(row.action ?? ""),
      currentValue: String(row.current_value ?? ""),
      proposedValue: String(row.proposed_value ?? ""),
      reason: String(row.reason ?? ""),
      sourceRefs,
      reviewDecision: "",
      reviewValue: "",
      reviewNote: "",
      lockField: "",
      batchId,
      notes: String(row.clean_status ?? ""),
    });
  }

  for (const row of locks) {
    rows.push({
      traceId: `lock:${row.lock_id}`,
      category: "field_lock",
      severity: "info",
      entityType: String(row.entity_type ?? ""),
      entityKey: String(row.entity_key ?? ""),
      fieldName: String(row.field_name ?? ""),
      action: "locked",
      currentValue: String(row.locked_value ?? ""),
      proposedValue: String(row.locked_value ?? ""),
      reason: "Campo bloqueado manualmente.",
      sourceRefs: "lock",
      reviewDecision: "",
      reviewValue: "",
      reviewNote: String(row.note ?? ""),
      lockField: String(row.field_name ?? ""),
      batchId,
      notes: String(row.locked_by ?? ""),
    });
  }

  return rows;
}

async function main() {
  await ensureDataDirs();
  const args = parseCliArgs();
  const requestedBatch = getFlag(args, "batch");
  const outPath = getFlag(args, "out") ?? DEFAULT_OUT;
  const db = new Database(stagingDatabasePath, { readonly: true });
  try {
    const latest = loadLatestBatch(db, requestedBatch);
    if (!latest) {
      throw new Error("No se encontró un batch disponible en staging.");
    }

    const pg = loadPgIndexes();
    const exceptions = buildExceptions(db, latest.review_batch_id, pg);
    const summary = JSON.parse(latest.summary_json || "{}") as Record<string, unknown>;
    const issueCount = (db.prepare(`SELECT COUNT(*) AS count FROM canonical_review_issue WHERE review_batch_id = ?`).get(latest.review_batch_id) as { count?: number } | undefined)?.count ?? 0;
    const quarantineCount = (db.prepare(`SELECT COUNT(*) AS count FROM canonical_quarantine WHERE review_batch_id = ?`).get(latest.review_batch_id) as { count?: number } | undefined)?.count ?? 0;
    const mergeSuggestionCount = (db.prepare(`SELECT COUNT(*) AS count FROM canonical_merge_suggestion WHERE review_batch_id = ?`).get(latest.review_batch_id) as { count?: number } | undefined)?.count ?? 0;
    const previewCount = (db.prepare(`SELECT COUNT(*) AS count FROM canonical_promotion_preview WHERE review_batch_id = ? AND action <> 'unchanged'`).get(latest.review_batch_id) as { count?: number } | undefined)?.count ?? 0;
    const lockCount = (db.prepare(`SELECT COUNT(*) AS count FROM canonical_field_lock`).get() as { count?: number } | undefined)?.count ?? 0;
    const summaryRows: ReviewRow[] = [
      { grupo: "Excepciones", metrica: "Total", valor: exceptions.length, detalle: "" },
      { grupo: "Excepciones", metrica: "Issues", valor: issueCount, detalle: "" },
      { grupo: "Excepciones", metrica: "Cuarentena", valor: quarantineCount, detalle: "" },
      { grupo: "Excepciones", metrica: "Mezclas sugeridas", valor: mergeSuggestionCount, detalle: "" },
      { grupo: "Excepciones", metrica: "Promotion preview", valor: previewCount, detalle: "" },
      { grupo: "Control", metrica: "Locks", valor: lockCount, detalle: "" },
      { grupo: "Cobertura", metrica: "Pólizas cubiertas", valor: summary.dbPoliciesCovered ?? 0, detalle: "" },
      { grupo: "Cobertura", metrica: "Recibos cubiertos", valor: summary.dbReceiptsCovered ?? 0, detalle: "" },
      { grupo: "Cobertura", metrica: "Clientes cubiertos", valor: summary.dbClientsCovered ?? 0, detalle: "" },
    ];

    const workbook = buildReviewWorkbook(exceptions, summaryRows, latest.review_batch_id);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    XLSX.writeFile(workbook, outPath, { bookType: "xlsx" });
    console.log(`Review pack: ${outPath}`);
    console.log(`Batch: ${latest.review_batch_id}`);
    console.log(`Excepciones: ${exceptions.length}`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
