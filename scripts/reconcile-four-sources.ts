#!/usr/bin/env tsx

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { PDFParse } from "pdf-parse";
import { parse as parseCsv } from "csv-parse/sync";

import { getDb } from "../src/lib/db";
import {
  exportsDir,
  ensureDataDirs,
  getFlag,
  parseCliArgs,
  readTabularInput,
  timestampForFile,
} from "./_shared";
import {
  extractClientNameCandidates,
  extractPolicyNumbers,
  extractReceiptNumbers,
  looksLikeClientFolder,
  normalizeMasterName,
  normalizePolicyNumber,
  normalizeReceiptNumber,
  scanMasterFolder,
} from "../src/lib/master-folder";
import { toWorkbook, workbookToBuffer } from "../src/lib/export";

type SourceName = "revisar" | "saps" | "master" | "db";
type EntityType = "POLIZA" | "CLIENTE" | "RECIBO";
type FileType = "pdf" | "xml" | "spreadsheet" | "image" | "zip" | "other";

type SourcePresence = Record<SourceName, boolean>;

type FileFinding = {
  source: SourceName;
  filePath: string;
  relativePath: string;
  topLevelFolder: string | null;
  subjectFolder: string | null;
  referidorFolder: string | null;
  fileType: FileType;
  policyCandidates: string[];
  clientCandidates: string[];
  receiptCandidates: string[];
  notes: string[];
};

type PolicyRecord = {
  source: SourceName;
  key: string;
  display: string;
  clientName: string;
  insurerName: string;
  receiptNumbers: string[];
  referidorNames: string[];
  evidenceFiles: string[];
  notes: string[];
};

type ClientRecord = {
  source: SourceName;
  key: string;
  display: string;
  referidorName: string;
  policyNumbers: string[];
  receiptNumbers: string[];
  evidenceFiles: string[];
  notes: string[];
};

type ReceiptRecord = {
  source: SourceName;
  key: string;
  display: string;
  policyNumber: string;
  clientName: string;
  insurerName: string;
  evidenceFiles: string[];
  notes: string[];
};

type DbPolicy = {
  id: string;
  policyNumber: string;
  client: { id: string; fullName: string; referidor: { id: string; fullName: string } | null };
  insurer: { id: string; name: string };
  premiumAmount: unknown;
  currency: string;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  renewalDate: Date | null;
};

type DbInsurer = {
  id: string;
  name: string;
  status: string;
};

type DbClient = {
  id: string;
  fullName: string;
  type: string;
  status: string;
  referidor: { id: string; fullName: string } | null;
};

type DbReceipt = {
  id: string;
  receiptNumber: string;
  policy: { id: string; policyNumber: string } | null;
  client: { id: string; fullName: string } | null;
  insurer: { id: string; name: string } | null;
  amount: unknown;
  currency: string;
  status: string;
  dueDate: Date | null;
  paidDate: Date | null;
};

type CrossRow = {
  entityType: EntityType;
  key: string;
  display: string;
  sourceCount: number;
  revisar: boolean;
  saps: boolean;
  master: boolean;
  db: boolean;
  sourceList: string;
  exactAll: boolean;
  clientNames: string;
  insurerNames: string;
  referidorNames: string;
  receiptNumbers: string;
  evidenceFiles: number;
  notes: string;
  status: string;
};

type RawSourceSummary = {
  source: SourceName;
  totalFiles?: number;
  pdfFiles?: number;
  rows?: number;
  policyCandidates: number;
  clientCandidates: number;
  receiptCandidates: number;
};

type FieldAuditStatus = "auto" | "review" | "reject";

type FieldAuditRow = {
  entityType: EntityType;
  entityKey: string;
  fieldName: string;
  rawValues: string;
  normalizedValue: string;
  verifiedValue: string;
  score: number;
  status: FieldAuditStatus;
  evidenceSources: string;
  reason: string;
};

const DEFAULT_REVISAR_ROOT = "/Users/pedrogomez/Desktop/revisar";
const DEFAULT_SAPS_PATH = "/Users/pedrogomez/Desktop/DescargaSAPS.csv";
const DEFAULT_MASTER_ROOT = "/Users/pedrogomez/Desktop/Polizas Pedro/Clientes";

function normalizeDisplay(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function uniqSorted(values: Iterable<string>) {
  return Array.from(new Set(Array.from(values).map(normalizeDisplay).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "es"),
  );
}

const CLIENT_NAME_NOISE = new Set([
  "CARATULA",
  "RECIBO",
  "RECIBOS",
  "POLIZA",
  "POLIZA",
  "PAGO",
  "PAGOS",
  "VIGENCIA",
  "VENCIMIENTO",
  "PRIMA",
  "TOTAL",
  "ENDOSO",
  "ENDOSOS",
  "COMPROBANTE",
  "FACTURA",
  "FOLIO",
  "NUMERO",
  "NOMBRE",
  "CLIENTE",
  "ASEGURADO",
  "TOMADOR",
  "CONTRATANTE",
  "BENEFICIARIO",
  "RENOVACION",
  "RENOVACIONES",
  "MOVIMIENTO",
  "MOVIMIENTOS",
  "DOCUMENTO",
  "DOCUMENTOS",
]);

function isLikelyClientName(value: string) {
  const display = normalizeDisplay(value);
  if (!display || display.length < 3 || display.length > 120) return false;
  if (/\d/.test(display)) return false;
  const normalized = normalizeMasterName(display);
  if (!normalized) return false;
  if (CLIENT_NAME_NOISE.has(normalized)) return false;
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length < 2 || tokens.length > 8) return false;
  if (tokens.some((token) => token.length < 2)) return false;
  const noiseTokens = tokens.filter((token) => CLIENT_NAME_NOISE.has(token));
  if (noiseTokens.length >= tokens.length) return false;
  if (tokens.length >= 3 && noiseTokens.length >= tokens.length - 1) return false;
  return true;
}

function isLikelyPolicyNumber(value: string) {
  const normalized = normalizePolicyNumber(value);
  if (!normalized) return false;
  if (normalized.length < 4 || normalized.length > 30) return false;
  if (!/\d/.test(normalized)) return false;
  if (/^[A-Z]{1,3}$/.test(normalized)) return false;
  return true;
}

function isLikelyReceiptNumber(value: string) {
  const normalized = normalizeReceiptNumber(value);
  if (!normalized) return false;
  if (normalized.length < 4 || normalized.length > 30) return false;
  if (!/\d/.test(normalized)) return false;
  return true;
}

function normalizeFieldValue(fieldName: string, value: string) {
  if (fieldName === "policyNumber" || fieldName === "receiptNumber") {
    return normalizePolicyNumber(value);
  }

  if (fieldName === "insurerName") {
    return normalizeDisplay(value);
  }

  return normalizeDisplay(value);
}

function fileTypeFromName(fileName: string): FileType {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".xml") return "xml";
  if (ext === ".xls" || ext === ".xlsx" || ext === ".csv" || ext === ".tsv" || ext === ".ods") {
    return "spreadsheet";
  }
  if (ext === ".jpg" || ext === ".jpeg" || ext === ".png" || ext === ".webp" || ext === ".heic" || ext === ".bmp" || ext === ".tif" || ext === ".tiff") {
    return "image";
  }
  if (ext === ".zip") return "zip";
  return "other";
}

function sourceList(presence: SourcePresence) {
  return (["revisar", "saps", "master", "db"] as const).filter((source) => presence[source]).join(" | ");
}

function countPresence(presence: SourcePresence) {
  return (Object.values(presence) as boolean[]).filter(Boolean).length;
}

function pickDisplay(preferred: Array<string | undefined>) {
  for (const candidate of preferred) {
    const value = candidate && normalizeDisplay(candidate);
    if (value) return value;
  }
  return "";
}

function parseArgs() {
  const args = parseCliArgs();
  const revisaRoot = getFlag(args, "revisar", DEFAULT_REVISAR_ROOT) ?? DEFAULT_REVISAR_ROOT;
  const sapsPath = getFlag(args, "saps", DEFAULT_SAPS_PATH) ?? DEFAULT_SAPS_PATH;
  const masterRoot = getFlag(args, "master", DEFAULT_MASTER_ROOT) ?? DEFAULT_MASTER_ROOT;
  const outPath = getFlag(args, "out");
  return { revisaRoot, sapsPath, masterRoot, outPath };
}

function rowToText(row: Record<string, unknown>) {
  return Object.entries(row)
    .map(([key, value]) => `${key}: ${value === null || value === undefined ? "" : String(value)}`)
    .join(" | ");
}

async function readEvidenceText(filePath: string, fileType: FileType) {
  if (fileType === "pdf") {
    try {
      const buffer = await fs.readFile(filePath);
      const parser = new PDFParse({ data: buffer });
      const result = await Promise.race([
        parser.getText({ first: 1 }),
        new Promise<{ text: string }>((_, reject) => setTimeout(() => reject(new Error("pdf-parse-timeout")), 5000)),
      ]);
      return { text: result.text ?? "", notes: [] as string[] };
    } catch (error) {
      return { text: "", notes: [`pdf-parse-failed:${error instanceof Error ? error.message : "unknown"}`] };
    }
  }

  if (fileType === "xml") {
    try {
      return { text: await fs.readFile(filePath, "utf8"), notes: [] as string[] };
    } catch (error) {
      return { text: "", notes: [`xml-read-failed:${error instanceof Error ? error.message : "unknown"}`] };
    }
  }

  if (fileType === "spreadsheet") {
    try {
      const rows = await readTabularInput(filePath);
      return {
        text: rows.map((row, index) => `${index + 1}: ${rowToText(row)}`).join("\n"),
        notes: [`spreadsheet-rows:${rows.length}`],
      };
    } catch (error) {
      return {
        text: "",
        notes: [`spreadsheet-read-failed:${error instanceof Error ? error.message : "unknown"}`],
      };
    }
  }

  if (fileType === "zip") {
    try {
      const listing = execFileSync("unzip", ["-Z1", filePath], { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 });
      const entries = listing
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      return { text: entries.join("\n"), notes: [`zip-entries:${entries.length}`] };
    } catch (error) {
      return { text: "", notes: [`zip-list-failed:${error instanceof Error ? error.message : "unknown"}`] };
    }
  }

  return { text: "", notes: [] as string[] };
}

function makePolicyRecord(
  source: SourceName,
  key: string,
  display: string,
  clientName: string,
  insurerName: string,
  receiptNumbers: string[],
  referidorNames: string[],
  evidenceFiles: string[],
  notes: string[],
): PolicyRecord {
  return {
    source,
    key,
    display,
    clientName,
    insurerName,
    receiptNumbers: uniqSorted(receiptNumbers),
    referidorNames: uniqSorted(referidorNames),
    evidenceFiles: uniqSorted(evidenceFiles),
    notes: uniqSorted(notes),
  };
}

function makeClientRecord(
  source: SourceName,
  key: string,
  display: string,
  referidorName: string,
  policyNumbers: string[],
  receiptNumbers: string[],
  evidenceFiles: string[],
  notes: string[],
): ClientRecord {
  return {
    source,
    key,
    display,
    referidorName,
    policyNumbers: uniqSorted(policyNumbers),
    receiptNumbers: uniqSorted(receiptNumbers),
    evidenceFiles: uniqSorted(evidenceFiles),
    notes: uniqSorted(notes),
  };
}

function makeReceiptRecord(
  source: SourceName,
  key: string,
  display: string,
  policyNumber: string,
  clientName: string,
  insurerName: string,
  evidenceFiles: string[],
  notes: string[],
): ReceiptRecord {
  return {
    source,
    key,
    display,
    policyNumber,
    clientName,
    insurerName,
    evidenceFiles: uniqSorted(evidenceFiles),
    notes: uniqSorted(notes),
  };
}

function extractFileCandidates(filePath: string, fileName: string, text: string) {
  const policyCandidates = uniqSorted([
    ...extractPolicyNumbers(text),
    ...extractPolicyNumbers(filePath, "path"),
    ...extractPolicyNumbers(fileName, "path"),
  ].map((value) => normalizePolicyNumber(value)));

  const receiptCandidates = uniqSorted([
    ...extractReceiptNumbers(text),
    ...extractReceiptNumbers(filePath, "path"),
    ...extractReceiptNumbers(fileName, "path"),
  ].map((value) => normalizeReceiptNumber(value)));

  const clientCandidates = uniqSorted(
    extractClientNameCandidates(text)
      .map(normalizeDisplay)
      .filter((value) => isLikelyClientName(value)),
  );

  return { policyCandidates, receiptCandidates, clientCandidates };
}

function extractFolderClientCandidates(folderNames: Array<string | null | undefined>) {
  const candidates = new Set<string>();
  for (const folderName of folderNames) {
    if (!folderName) continue;
    const display = normalizeDisplay(folderName);
    if (looksLikeClientFolder(display)) {
      candidates.add(display);
    }
  }
  return Array.from(candidates);
}

function extractReferidorNames(folderNames: Array<string | null | undefined>) {
  const candidates = new Set<string>();
  for (const folderName of folderNames) {
    if (!folderName) continue;
    const display = normalizeDisplay(folderName);
    if (looksLikeClientFolder(display)) {
      candidates.add(display);
    }
  }
  return Array.from(candidates);
}

async function scanFolderSource(rootFolder: string, source: "revisar" | "master") {
  const contexts = await scanMasterFolder(rootFolder);
  const fileFindings: FileFinding[] = [];
  const policyRecords: PolicyRecord[] = [];
  const clientRecords: ClientRecord[] = [];
  const receiptRecords: ReceiptRecord[] = [];
  let pdfFiles = 0;

  for (const context of contexts) {
    const filePath = context.absolutePath;
    const fileType = fileTypeFromName(context.fileName);
    if (fileType === "pdf") pdfFiles += 1;

    const { text, notes: readNotes } = await readEvidenceText(filePath, fileType);
    const extracted = extractFileCandidates(filePath, context.fileName, text);
    const folderClientCandidates = extractFolderClientCandidates([
      context.topLevelFolder,
      context.subjectFolder,
      context.referidorFolder,
      ...context.groupFolders,
    ]);
    const referidorCandidates = extractReferidorNames([context.referidorFolder, context.topLevelFolder]);
    const policyCandidates = uniqSorted([...extracted.policyCandidates]);
    const receiptCandidates = uniqSorted([...extracted.receiptCandidates]);
    const clientCandidates = uniqSorted([...extracted.clientCandidates, ...folderClientCandidates]);
    const notes = uniqSorted([
      ...readNotes,
      ...(context.relativePath.startsWith(".") ? ["root-orphan"] : []),
      ...(context.topLevelFolder ? [`top:${context.topLevelFolder}`] : []),
      ...(context.subjectFolder ? [`subject:${context.subjectFolder}`] : []),
    ]);

    fileFindings.push({
      source,
      filePath,
      relativePath: context.relativePath,
      topLevelFolder: context.topLevelFolder,
      subjectFolder: context.subjectFolder,
      referidorFolder: context.referidorFolder,
      fileType,
      policyCandidates,
      clientCandidates,
      receiptCandidates,
      notes,
    });

    for (const policy of policyCandidates) {
      policyRecords.push(
        makePolicyRecord(
          source,
          normalizePolicyNumber(policy),
          policy,
          clientCandidates[0] ?? "",
          "",
          receiptCandidates,
          referidorCandidates,
          [filePath],
          notes,
        ),
      );
    }

    for (const client of clientCandidates) {
      clientRecords.push(
        makeClientRecord(
          source,
          normalizeMasterName(client),
          client,
          referidorCandidates.find((value) => normalizeMasterName(value) !== normalizeMasterName(client)) ?? "",
          policyCandidates,
          receiptCandidates,
          [filePath],
          notes,
        ),
      );
    }

    for (const receipt of receiptCandidates) {
      receiptRecords.push(
        makeReceiptRecord(
          source,
          normalizeReceiptNumber(receipt),
          receipt,
          policyCandidates[0] ?? "",
          clientCandidates[0] ?? "",
          "",
          [filePath],
          notes,
        ),
      );
    }
  }

  return {
    fileFindings,
    policyRecords,
    clientRecords,
    receiptRecords,
    summary: {
      source,
      totalFiles: contexts.length,
      pdfFiles,
      policyCandidates: policyRecords.length,
      clientCandidates: clientRecords.length,
      receiptCandidates: receiptRecords.length,
    } as RawSourceSummary,
  };
}

type SapsRecord = {
  policyNumber: string;
  receiptNumber: string;
  clientName: string;
  insurerName: string;
  policyType: string;
  startDate: string;
  endDate: string;
  receiptStartDate: string;
  receiptEndDate: string;
  paymentFrequency: string;
  status: string;
  primaNeta: string;
  primaTotal: string;
};

function parseSapsCsv(csvPath: string): SapsRecord[] {
  const raw = fsSync.readFileSync(csvPath, "utf8");
  const rows = parseCsv(raw, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
  }) as Record<string, string>[];

  return rows.map((row) => ({
    policyNumber: normalizePolicyNumber(row["No. de Póliza"] ?? row["No. Póliza"] ?? row["No. Póliza "] ?? ""),
    receiptNumber: normalizeReceiptNumber(row["No. Recibo"] ?? row["No. de Recibo"] ?? ""),
    clientName: normalizeDisplay(row["Cliente"] ?? ""),
    insurerName: normalizeDisplay(row["Compañía"] ?? row["Compania"] ?? ""),
    policyType: normalizeDisplay(row["Tipo Póliza"] ?? row["Tipo Poliza"] ?? ""),
    startDate: normalizeDisplay(row["Inicio Vigencia Póliza"] ?? row["Ini Vigencia Póliza"] ?? ""),
    endDate: normalizeDisplay(row["Fin Vigencia"] ?? row["Fin Vigencia Póliza"] ?? ""),
    receiptStartDate: normalizeDisplay(row["Ini Vigencia Rec"] ?? ""),
    receiptEndDate: normalizeDisplay(row["Fin Vigencia Rec"] ?? ""),
    paymentFrequency: normalizeDisplay(row["Frecuencia Pago"] ?? ""),
    status: normalizeDisplay(row["Estatus"] ?? ""),
    primaNeta: normalizeDisplay(row["Prima Neta Recibo"] ?? ""),
    primaTotal: normalizeDisplay(row["Prima Total Recibo"] ?? ""),
  }));
}

function buildSapsRecords(rows: SapsRecord[]) {
  const fileFindings: FileFinding[] = [];
  const policyRecords: PolicyRecord[] = [];
  const clientRecords: ClientRecord[] = [];
  const receiptRecords: ReceiptRecord[] = [];

  for (const [index, row] of rows.entries()) {
    const evidenceFile = `SAPS[row:${index + 1}]`;
    const notes = uniqSorted([
      row.status ? `status:${row.status}` : "",
      row.paymentFrequency ? `freq:${row.paymentFrequency}` : "",
      row.policyType ? `type:${row.policyType}` : "",
    ]);

    fileFindings.push({
      source: "saps",
      filePath: evidenceFile,
      relativePath: evidenceFile,
      topLevelFolder: null,
      subjectFolder: null,
      referidorFolder: null,
      fileType: "spreadsheet",
      policyCandidates: row.policyNumber ? [row.policyNumber] : [],
      clientCandidates: row.clientName ? [row.clientName] : [],
      receiptCandidates: row.receiptNumber ? [row.receiptNumber] : [],
      notes,
    });

    if (row.policyNumber) {
      policyRecords.push(
        makePolicyRecord(
          "saps",
          row.policyNumber,
          row.policyNumber,
          row.clientName,
          row.insurerName,
          row.receiptNumber ? [row.receiptNumber] : [],
          [],
          [evidenceFile],
          notes,
        ),
      );
    }

    if (row.clientName) {
      clientRecords.push(
        makeClientRecord(
          "saps",
          normalizeMasterName(row.clientName),
          row.clientName,
          "",
          row.policyNumber ? [row.policyNumber] : [],
          row.receiptNumber ? [row.receiptNumber] : [],
          [evidenceFile],
          notes,
        ),
      );
    }

    if (row.receiptNumber) {
      receiptRecords.push(
        makeReceiptRecord(
          "saps",
          row.receiptNumber,
          row.receiptNumber,
          row.policyNumber,
          row.clientName,
          row.insurerName,
          [evidenceFile],
          notes,
        ),
      );
    }
  }

  return {
    fileFindings,
    policyRecords,
    clientRecords,
    receiptRecords,
    summary: {
      source: "saps",
      rows: rows.length,
      policyCandidates: policyRecords.length,
      clientCandidates: clientRecords.length,
      receiptCandidates: receiptRecords.length,
    } as RawSourceSummary,
  };
}

async function loadDbRecords() {
  const db = getDb();
  const [policies, clients, receipts, insurers] = await Promise.all([
    db.policy.findMany({
      include: {
        client: { include: { referidor: true } },
        insurer: true,
      },
      orderBy: { policyNumber: "asc" },
    }),
    db.client.findMany({
      include: { referidor: true },
      orderBy: { fullName: "asc" },
    }),
    db.receipt.findMany({
      include: {
        policy: true,
        client: true,
        insurer: true,
      },
      orderBy: { receiptNumber: "asc" },
    }),
    db.insurer.findMany({
      orderBy: { name: "asc" },
    }),
  ]);

  return { db, policies, clients, receipts, insurers };
}

function buildDbRecords(policies: DbPolicy[], clients: DbClient[], receipts: DbReceipt[]) {
  const fileFindings: FileFinding[] = [];
  const policyRecords: PolicyRecord[] = [];
  const clientRecords: ClientRecord[] = [];
  const receiptRecords: ReceiptRecord[] = [];

  for (const policy of policies) {
    const notes = uniqSorted([
      policy.status ? `status:${policy.status}` : "",
      policy.startDate ? `start:${policy.startDate.toISOString()}` : "",
      policy.endDate ? `end:${policy.endDate.toISOString()}` : "",
      policy.renewalDate ? `renewal:${policy.renewalDate.toISOString()}` : "",
    ]);
    policyRecords.push(
      makePolicyRecord(
        "db",
        normalizePolicyNumber(policy.policyNumber),
        policy.policyNumber,
        policy.client.fullName,
        policy.insurer.name,
        [],
        policy.client.referidor?.fullName ? [policy.client.referidor.fullName] : [],
        [`db-policy:${policy.id}`],
        notes,
      ),
    );
  }

  for (const client of clients) {
    clientRecords.push(
      makeClientRecord(
        "db",
        normalizeMasterName(client.fullName),
        client.fullName,
        client.referidor?.fullName ?? "",
        [],
        [],
        [`db-client:${client.id}`],
        [client.status ? `status:${client.status}` : ""],
      ),
    );
  }

  for (const receipt of receipts) {
    receiptRecords.push(
      makeReceiptRecord(
        "db",
        normalizeReceiptNumber(receipt.receiptNumber),
        receipt.receiptNumber,
        receipt.policy?.policyNumber ?? "",
        receipt.client?.fullName ?? "",
        receipt.insurer?.name ?? "",
        [`db-receipt:${receipt.id}`],
        [
          receipt.status ? `status:${receipt.status}` : "",
          receipt.dueDate ? `due:${receipt.dueDate.toISOString()}` : "",
          receipt.paidDate ? `paid:${receipt.paidDate.toISOString()}` : "",
        ],
      ),
    );
  }

  return { fileFindings, policyRecords, clientRecords, receiptRecords };
}

function simplifyInsurerKey(value: string) {
  return normalizeMasterName(value)
    .replace(/\b(SEGUROS?|COMPANIA|COMPAÑIA|DE|MEXICO|MEXICANA|S\.A\.|S\.A|C\.V\.|C V)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCanonicalLookups(clients: DbClient[], insurers: DbInsurer[]) {
  const clientLookup = new Map<string, string>();
  const insurerLookup = new Map<string, string>();

  for (const client of clients) {
    clientLookup.set(normalizeMasterName(client.fullName), client.fullName);
  }

  for (const insurer of insurers) {
    const normalized = normalizeMasterName(insurer.name);
    insurerLookup.set(normalized, insurer.name);
    const simplified = simplifyInsurerKey(insurer.name);
    if (simplified) insurerLookup.set(simplified, insurer.name);
  }

  return { clients: clientLookup, insurers: insurerLookup };
}

function groupRecords<T extends { source: SourceName; key: string }>(records: T[]) {
  const grouped = new Map<string, T[]>();
  for (const record of records) {
    const existing = grouped.get(record.key) ?? [];
    existing.push(record);
    grouped.set(record.key, existing);
  }
  return grouped;
}

function buildCrossRows(
  entityType: EntityType,
  grouped: Map<string, Array<PolicyRecord | ClientRecord | ReceiptRecord>>,
): CrossRow[] {
  const rows: CrossRow[] = [];

  for (const [key, records] of grouped.entries()) {
    const sources: SourcePresence = {
      revisar: records.some((record) => record.source === "revisar"),
      saps: records.some((record) => record.source === "saps"),
      master: records.some((record) => record.source === "master"),
      db: records.some((record) => record.source === "db"),
    };
    const sourceCount = countPresence(sources);
    const sourceValues = sourceList(sources);

    const display = pickDisplay([
      records.find((record) => record.source === "db")?.display,
      records.find((record) => record.source === "saps")?.display,
      records.find((record) => record.source === "master")?.display,
      records.find((record) => record.source === "revisar")?.display,
      key,
    ]);

    const clientNames = uniqSorted(
      records.flatMap((record) => {
        if ("clientName" in record) return [record.clientName];
        return [];
      }),
    );

    const insurerNames = uniqSorted(
      records.flatMap((record) => {
        if ("insurerName" in record) return [record.insurerName];
        return [];
      }),
    );

    const referidorNames = uniqSorted(
      records.flatMap((record) => {
        if ("referidorNames" in record) return record.referidorNames;
        if ("referidorName" in record) return record.referidorName ? [record.referidorName] : [];
        return [];
      }),
    );

    const receiptNumbers = uniqSorted(
      records.flatMap((record) => {
        if ("receiptNumbers" in record) return record.receiptNumbers;
        if ("policyNumber" in record && record.policyNumber) return [];
        return [];
      }),
    );

    const evidenceFiles = new Set<string>();
    for (const record of records) {
      for (const file of record.evidenceFiles) evidenceFiles.add(file);
    }

    const notes = new Set<string>();
    for (const record of records) {
      for (const note of record.notes) {
        if (note) notes.add(note);
      }
    }

    const conflicts: string[] = [];
    if (clientNames.length > 1) conflicts.push(`cliente-conflict:${clientNames.join(" <> ")}`);
    if (insurerNames.length > 1) conflicts.push(`aseguradora-conflict:${insurerNames.join(" <> ")}`);
    if (referidorNames.length > 1) conflicts.push(`referidor-conflict:${referidorNames.join(" <> ")}`);
    if (sourceCount < 4) {
      const missing = (["revisar", "saps", "master", "db"] as const).filter((source) => !sources[source]);
      if (missing.length) conflicts.push(`faltan-fuentes:${missing.join(",")}`);
    }

    const exactAll = sourceCount === 4 && conflicts.length === 0;
    const status =
      exactAll
        ? "IGUALES_EXACTOS"
        : sourceCount === 1
          ? `SOLO_${sourceValues.toUpperCase()}`
          : conflicts.length > 0
            ? "AMBIGUO"
            : "PARCIAL";

    rows.push({
      entityType,
      key,
      display,
      sourceCount,
      revisar: sources.revisar,
      saps: sources.saps,
      master: sources.master,
      db: sources.db,
      sourceList: sourceValues,
      exactAll,
      clientNames: clientNames.join(" | "),
      insurerNames: insurerNames.join(" | "),
      referidorNames: referidorNames.join(" | "),
      receiptNumbers: receiptNumbers.join(" | "),
      evidenceFiles: evidenceFiles.size,
      notes: uniqSorted([...notes, ...conflicts]).join(" | "),
      status,
    });
  }

  return rows.sort((left, right) => left.display.localeCompare(right.display, "es"));
}

function buildReferidorRows(rows: CrossRow[]) {
  const referidorRows: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    if (row.entityType !== "CLIENTE") continue;
    if (!row.referidorNames) continue;
    for (const referidor of row.referidorNames.split(" | ").filter(Boolean)) {
      referidorRows.push({
        cliente: row.display,
        referidor,
        fuentes: row.sourceList,
        igualExacto: row.exactAll ? "sí" : "no",
        notas: row.notes,
      });
    }
  }
  return referidorRows;
}

function buildSummaryRows(
  sourceSummaries: RawSourceSummary[],
  policyRows: CrossRow[],
  clientRows: CrossRow[],
  receiptRows: CrossRow[],
  fileFindingsBySource: Map<SourceName, FileFinding[]>,
) {
  const rows: Array<Record<string, unknown>> = [];

  for (const summary of sourceSummaries) {
    rows.push({
      grupo: "fuente",
      métrica: `${summary.source.toUpperCase()} total`,
      valor: summary.totalFiles ?? summary.rows ?? 0,
      detalle: summary.source === "saps" ? `filas: ${summary.rows ?? 0}` : `archivos: ${summary.totalFiles ?? 0}`,
    });
    if (summary.pdfFiles !== undefined) {
      rows.push({
        grupo: "fuente",
        métrica: `${summary.source.toUpperCase()} PDFs`,
        valor: summary.pdfFiles,
        detalle: "solo para carpetas",
      });
    }
    rows.push({
      grupo: "fuente",
      métrica: `${summary.source.toUpperCase()} candidatos póliza`,
      valor: summary.policyCandidates,
      detalle: "",
    });
    rows.push({
      grupo: "fuente",
      métrica: `${summary.source.toUpperCase()} candidatos cliente`,
      valor: summary.clientCandidates,
      detalle: "",
    });
    rows.push({
      grupo: "fuente",
      métrica: `${summary.source.toUpperCase()} candidatos recibo`,
      valor: summary.receiptCandidates,
      detalle: "",
    });
  }

  const exactPolicies = policyRows.filter((row) => row.exactAll).length;
  const exactClients = clientRows.filter((row) => row.exactAll).length;
  const exactReceipts = receiptRows.filter((row) => row.exactAll).length;

  rows.push({ grupo: "consenso", métrica: "Pólizas exactas 4/4", valor: exactPolicies, detalle: "presencia completa y sin conflictos" });
  rows.push({ grupo: "consenso", métrica: "Clientes exactos 4/4", valor: exactClients, detalle: "presencia completa y sin conflictos" });
  rows.push({ grupo: "consenso", métrica: "Recibos exactos 4/4", valor: exactReceipts, detalle: "presencia completa y sin conflictos" });

  rows.push(
    ...[
      ["Pólizas 3/4", policyRows.filter((row) => row.sourceCount === 3).length],
      ["Pólizas 2/4", policyRows.filter((row) => row.sourceCount === 2).length],
      ["Pólizas 1/4", policyRows.filter((row) => row.sourceCount === 1).length],
      ["Clientes 3/4", clientRows.filter((row) => row.sourceCount === 3).length],
      ["Clientes 2/4", clientRows.filter((row) => row.sourceCount === 2).length],
      ["Clientes 1/4", clientRows.filter((row) => row.sourceCount === 1).length],
      ["Recibos 3/4", receiptRows.filter((row) => row.sourceCount === 3).length],
      ["Recibos 2/4", receiptRows.filter((row) => row.sourceCount === 2).length],
      ["Recibos 1/4", receiptRows.filter((row) => row.sourceCount === 1).length],
    ].map(([métrica, valor]) => ({
      grupo: "consenso",
      métrica,
      valor,
      detalle: "",
    })),
  );

  rows.push({
    grupo: "calidad",
    métrica: "Polizas ambiguas",
    valor: policyRows.filter((row) => row.status === "AMBIGUO").length,
    detalle: "requieren revisión manual",
  });
  rows.push({
    grupo: "calidad",
    métrica: "Clientes ambiguos",
    valor: clientRows.filter((row) => row.status === "AMBIGUO").length,
    detalle: "requieren revisión manual",
  });
  rows.push({
    grupo: "calidad",
    métrica: "Recibos ambiguos",
    valor: receiptRows.filter((row) => row.status === "AMBIGUO").length,
    detalle: "requieren revisión manual",
  });

  rows.push({
    grupo: "archivos",
    métrica: "Revisar archivos sin candidatos",
    valor: (fileFindingsBySource.get("revisar") ?? []).filter((row) => !row.policyCandidates.length && !row.clientCandidates.length && !row.receiptCandidates.length).length,
    detalle: "posible ruido o evidencia no extraíble",
  });

  return rows;
}

function rowsForStatus(rows: CrossRow[], status: string) {
  return rows.filter((row) => row.status === status);
}

function rowsForSource(rows: CrossRow[], source: SourceName) {
  const flag = source;
  return rows.filter((row) => row[flag]);
}

function policyCrossColumns() {
  return [
    { clave: "entityType", etiqueta: "Entidad" },
    { clave: "key", etiqueta: "Clave" },
    { clave: "display", etiqueta: "Póliza" },
    { clave: "status", etiqueta: "Estatus" },
    { clave: "sourceCount", etiqueta: "Fuentes" },
    { clave: "sourceList", etiqueta: "Fuentes detalle" },
    { clave: "revisar", etiqueta: "Revisar", formatear: (value: unknown) => (value ? "sí" : "no") },
    { clave: "saps", etiqueta: "SAPS", formatear: (value: unknown) => (value ? "sí" : "no") },
    { clave: "master", etiqueta: "Master", formatear: (value: unknown) => (value ? "sí" : "no") },
    { clave: "db", etiqueta: "DB", formatear: (value: unknown) => (value ? "sí" : "no") },
    { clave: "clientNames", etiqueta: "Clientes" },
    { clave: "insurerNames", etiqueta: "Aseguradoras" },
    { clave: "referidorNames", etiqueta: "Referidor" },
    { clave: "receiptNumbers", etiqueta: "Recibos" },
    { clave: "evidenceFiles", etiqueta: "Evidencias" },
    { clave: "notes", etiqueta: "Notas" },
  ];
}

function genericCrossColumns() {
  return [
    { clave: "entityType", etiqueta: "Entidad" },
    { clave: "key", etiqueta: "Clave" },
    { clave: "display", etiqueta: "Nombre" },
    { clave: "status", etiqueta: "Estatus" },
    { clave: "sourceCount", etiqueta: "Fuentes" },
    { clave: "sourceList", etiqueta: "Fuentes detalle" },
    { clave: "revisar", etiqueta: "Revisar", formatear: (value: unknown) => (value ? "sí" : "no") },
    { clave: "saps", etiqueta: "SAPS", formatear: (value: unknown) => (value ? "sí" : "no") },
    { clave: "master", etiqueta: "Master", formatear: (value: unknown) => (value ? "sí" : "no") },
    { clave: "db", etiqueta: "DB", formatear: (value: unknown) => (value ? "sí" : "no") },
    { clave: "clientNames", etiqueta: "Clientes" },
    { clave: "insurerNames", etiqueta: "Aseguradoras" },
    { clave: "referidorNames", etiqueta: "Referidor" },
    { clave: "receiptNumbers", etiqueta: "Recibos" },
    { clave: "evidenceFiles", etiqueta: "Evidencias" },
    { clave: "notes", etiqueta: "Notas" },
  ];
}

function clientCrossColumns() {
  return [
    { clave: "entityType", etiqueta: "Entidad" },
    { clave: "key", etiqueta: "Clave" },
    { clave: "display", etiqueta: "Cliente" },
    { clave: "status", etiqueta: "Estatus" },
    { clave: "sourceCount", etiqueta: "Fuentes" },
    { clave: "sourceList", etiqueta: "Fuentes detalle" },
    { clave: "revisar", etiqueta: "Revisar", formatear: (value: unknown) => (value ? "sí" : "no") },
    { clave: "saps", etiqueta: "SAPS", formatear: (value: unknown) => (value ? "sí" : "no") },
    { clave: "master", etiqueta: "Master", formatear: (value: unknown) => (value ? "sí" : "no") },
    { clave: "db", etiqueta: "DB", formatear: (value: unknown) => (value ? "sí" : "no") },
    { clave: "clientNames", etiqueta: "Clientes" },
    { clave: "referidorNames", etiqueta: "Referidor" },
    { clave: "receiptNumbers", etiqueta: "Recibos" },
    { clave: "evidenceFiles", etiqueta: "Evidencias" },
    { clave: "notes", etiqueta: "Notas" },
  ];
}

function receiptCrossColumns() {
  return [
    { clave: "entityType", etiqueta: "Entidad" },
    { clave: "key", etiqueta: "Clave" },
    { clave: "display", etiqueta: "Recibo" },
    { clave: "status", etiqueta: "Estatus" },
    { clave: "sourceCount", etiqueta: "Fuentes" },
    { clave: "sourceList", etiqueta: "Fuentes detalle" },
    { clave: "revisar", etiqueta: "Revisar", formatear: (value: unknown) => (value ? "sí" : "no") },
    { clave: "saps", etiqueta: "SAPS", formatear: (value: unknown) => (value ? "sí" : "no") },
    { clave: "master", etiqueta: "Master", formatear: (value: unknown) => (value ? "sí" : "no") },
    { clave: "db", etiqueta: "DB", formatear: (value: unknown) => (value ? "sí" : "no") },
    { clave: "clientNames", etiqueta: "Clientes" },
    { clave: "insurerNames", etiqueta: "Aseguradoras" },
    { clave: "receiptNumbers", etiqueta: "Recibos" },
    { clave: "evidenceFiles", etiqueta: "Evidencias" },
    { clave: "notes", etiqueta: "Notas" },
  ];
}

function simpleColumns(keys: Array<[string, string]>) {
  return keys.map(([clave, etiqueta]) => ({ clave, etiqueta }));
}

function chooseRows(rows: Record<string, unknown>[], limit = 500) {
  return rows.slice(0, limit);
}

function sheetRowsFromFileFindings(findings: FileFinding[]) {
  return findings.map((finding) => ({
    fuente: finding.source,
    archivo: finding.filePath,
    rutaRelativa: finding.relativePath,
    topLevelFolder: finding.topLevelFolder ?? "",
    subjectFolder: finding.subjectFolder ?? "",
    referidorFolder: finding.referidorFolder ?? "",
    tipoArchivo: finding.fileType,
    candidatosPoliza: finding.policyCandidates.join(" | "),
    candidatosCliente: finding.clientCandidates.join(" | "),
    candidatosRecibo: finding.receiptCandidates.join(" | "),
    notas: finding.notes.join(" | "),
  }));
}

function sheetRowsFromSaps(records: SapsRecord[]) {
  return records.map((row) => ({
    policyNumber: row.policyNumber,
    receiptNumber: row.receiptNumber,
    clientName: row.clientName,
    insurerName: row.insurerName,
    policyType: row.policyType,
    startDate: row.startDate,
    endDate: row.endDate,
    receiptStartDate: row.receiptStartDate,
    receiptEndDate: row.receiptEndDate,
    paymentFrequency: row.paymentFrequency,
    status: row.status,
    primaNeta: row.primaNeta,
    primaTotal: row.primaTotal,
  }));
}

function sheetRowsFromDbPolicies(policies: DbPolicy[]) {
  return policies.map((policy) => ({
    policyNumber: policy.policyNumber,
    clientName: policy.client.fullName,
    referidor: policy.client.referidor?.fullName ?? "",
    insurerName: policy.insurer.name,
    status: policy.status,
    currency: policy.currency,
    premiumAmount: policy.premiumAmount ?? "",
    startDate: policy.startDate ? policy.startDate.toISOString() : "",
    endDate: policy.endDate ? policy.endDate.toISOString() : "",
    renewalDate: policy.renewalDate ? policy.renewalDate.toISOString() : "",
  }));
}

function sheetRowsFromReferidor(referidorRows: Array<Record<string, unknown>>) {
  return referidorRows;
}

type FieldCandidateBucket = {
  value: string;
  normalized: string;
  sources: Set<SourceName>;
  evidence: Set<string>;
  notes: Set<string>;
};

function createFieldCandidateBucket(value: string) {
  return {
    value: normalizeDisplay(value),
    normalized: normalizeDisplay(value),
    sources: new Set<SourceName>(),
    evidence: new Set<string>(),
    notes: new Set<string>(),
  } satisfies FieldCandidateBucket;
}

function addFieldCandidate(
  buckets: Map<string, FieldCandidateBucket>,
  value: string,
  source: SourceName,
  evidence: string,
  note?: string,
) {
  const normalized = normalizeDisplay(value);
  if (!normalized) return;

  const key = normalizeMasterName(normalized);
  const bucket = buckets.get(key) ?? createFieldCandidateBucket(normalized);
  bucket.sources.add(source);
  if (evidence) bucket.evidence.add(evidence);
  if (note) bucket.notes.add(note);
  if (!bucket.value || bucket.value.length < normalized.length) {
    bucket.value = normalized;
  }
  buckets.set(key, bucket);
}

function sourceWeight(source: SourceName) {
  switch (source) {
    case "db":
      return 100;
    case "saps":
      return 90;
    case "master":
      return 80;
    case "revisar":
      return 75;
    default:
      return 0;
  }
}

function scoreFieldCandidate(
  fieldName: string,
  bucket: FieldCandidateBucket,
  canonicalLookup?: Map<string, string>,
) {
  let score = 0;
  const reason: string[] = [];
  let verified = bucket.value;

  const valid =
    fieldName === "clientName" || fieldName === "referidorName"
      ? isLikelyClientName(bucket.value)
      : fieldName === "policyNumber"
        ? isLikelyPolicyNumber(bucket.value)
        : fieldName === "receiptNumber"
          ? isLikelyReceiptNumber(bucket.value)
          : fieldName === "insurerName"
            ? normalizeDisplay(bucket.value).length >= 2
            : normalizeDisplay(bucket.value).length >= 2;

  if (!valid) {
    return {
      verifiedValue: "",
      score: 0,
      status: "reject" as FieldAuditStatus,
      reason: "no pasa validacion estructural",
    };
  }

  for (const source of bucket.sources) {
    score += sourceWeight(source);
  }

  if (bucket.sources.size > 1) {
    score += Math.min(20, (bucket.sources.size - 1) * 10);
    reason.push("multi-source");
  }

  if (canonicalLookup) {
    const canonical = canonicalLookup.get(normalizeMasterName(bucket.value));
    if (canonical) {
      verified = canonical;
      score += 15;
      reason.push("canonical-match");
    }
  }

  if (bucket.notes.size > 0) {
    reason.push(...bucket.notes);
  }

  if (score >= 90) {
    return {
      verifiedValue: verified,
      score: Math.min(score, 100),
      status: "auto" as FieldAuditStatus,
      reason: reason.join(" | ") || "confidence alta",
    };
  }

  if (score >= 70) {
    return {
      verifiedValue: verified,
      score: Math.min(score, 100),
      status: "review" as FieldAuditStatus,
      reason: reason.join(" | ") || "revisar antes de promover",
    };
  }

  return {
    verifiedValue: "",
    score: Math.min(score, 100),
    status: "reject" as FieldAuditStatus,
    reason: reason.join(" | ") || "score insuficiente",
  };
}

function buildFieldAuditRows(
  groupedPolicies: Map<string, PolicyRecord[]>,
  groupedClients: Map<string, ClientRecord[]>,
  groupedReceipts: Map<string, ReceiptRecord[]>,
  canonicalLookups: {
    clients: Map<string, string>;
    insurers: Map<string, string>;
  },
) {
  const rows: FieldAuditRow[] = [];

  for (const [key, records] of groupedPolicies.entries()) {
    const policyBuckets = new Map<string, FieldCandidateBucket>();
    const clientBuckets = new Map<string, FieldCandidateBucket>();
    const insurerBuckets = new Map<string, FieldCandidateBucket>();
    const receiptBuckets = new Map<string, FieldCandidateBucket>();
    const referidorBuckets = new Map<string, FieldCandidateBucket>();

    addFieldCandidate(policyBuckets, key, "db", `policy:${key}`);
    for (const record of records) {
      addFieldCandidate(policyBuckets, record.display, record.source, record.evidenceFiles.join(" | "));
      addFieldCandidate(clientBuckets, record.clientName, record.source, record.evidenceFiles.join(" | "));
      addFieldCandidate(insurerBuckets, record.insurerName, record.source, record.evidenceFiles.join(" | "));
      for (const referidorName of record.referidorNames) {
        addFieldCandidate(referidorBuckets, referidorName, record.source, record.evidenceFiles.join(" | "));
      }
      for (const receipt of record.receiptNumbers) {
        addFieldCandidate(receiptBuckets, receipt, record.source, record.evidenceFiles.join(" | "));
      }
    }

    const policyDecision = chooseBestField("policyNumber", policyBuckets);
    rows.push({
      entityType: "POLIZA",
      entityKey: key,
      fieldName: "policyNumber",
      rawValues: [...policyBuckets.values()].map((bucket) => bucket.value).join(" | "),
      normalizedValue: normalizePolicyNumber(key),
      verifiedValue: policyDecision.verifiedValue,
      score: policyDecision.score,
      status: policyDecision.status,
      evidenceSources: [...new Set(records.map((record) => record.source))].join(" | "),
      reason: policyDecision.reason,
    });

    const clientDecision = chooseBestField("clientName", clientBuckets, canonicalLookups.clients);
    rows.push({
      entityType: "POLIZA",
      entityKey: key,
      fieldName: "clientName",
      rawValues: [...clientBuckets.values()].map((bucket) => bucket.value).join(" | "),
      normalizedValue: clientDecision.normalizedValue,
      verifiedValue: clientDecision.verifiedValue,
      score: clientDecision.score,
      status: clientDecision.status,
      evidenceSources: [...new Set(records.map((record) => record.source))].join(" | "),
      reason: clientDecision.reason,
    });

    const insurerDecision = chooseBestField("insurerName", insurerBuckets, canonicalLookups.insurers);
    rows.push({
      entityType: "POLIZA",
      entityKey: key,
      fieldName: "insurerName",
      rawValues: [...insurerBuckets.values()].map((bucket) => bucket.value).join(" | "),
      normalizedValue: insurerDecision.normalizedValue,
      verifiedValue: insurerDecision.verifiedValue,
      score: insurerDecision.score,
      status: insurerDecision.status,
      evidenceSources: [...new Set(records.map((record) => record.source))].join(" | "),
      reason: insurerDecision.reason,
    });

    const receiptDecision = chooseBestField("receiptNumber", receiptBuckets);
    rows.push({
      entityType: "POLIZA",
      entityKey: key,
      fieldName: "receiptNumber",
      rawValues: [...receiptBuckets.values()].map((bucket) => bucket.value).join(" | "),
      normalizedValue: receiptDecision.normalizedValue,
      verifiedValue: receiptDecision.verifiedValue,
      score: receiptDecision.score,
      status: receiptDecision.status,
      evidenceSources: [...new Set(records.map((record) => record.source))].join(" | "),
      reason: receiptDecision.reason,
    });

    const referidorDecision = chooseBestField("referidorName", referidorBuckets, canonicalLookups.clients);
    rows.push({
      entityType: "POLIZA",
      entityKey: key,
      fieldName: "referidorName",
      rawValues: [...referidorBuckets.values()].map((bucket) => bucket.value).join(" | "),
      normalizedValue: referidorDecision.normalizedValue,
      verifiedValue: referidorDecision.verifiedValue,
      score: referidorDecision.score,
      status: referidorDecision.status,
      evidenceSources: [...new Set(records.map((record) => record.source))].join(" | "),
      reason: referidorDecision.reason,
    });
  }

  for (const [key, records] of groupedClients.entries()) {
    const clientBuckets = new Map<string, FieldCandidateBucket>();
    const referidorBuckets = new Map<string, FieldCandidateBucket>();
    const policyBuckets = new Map<string, FieldCandidateBucket>();
    const receiptBuckets = new Map<string, FieldCandidateBucket>();

    for (const record of records) {
      addFieldCandidate(clientBuckets, record.display, record.source, record.evidenceFiles.join(" | "));
      addFieldCandidate(referidorBuckets, record.referidorName, record.source, record.evidenceFiles.join(" | "));
      for (const policy of record.policyNumbers) addFieldCandidate(policyBuckets, policy, record.source, record.evidenceFiles.join(" | "));
      for (const receipt of record.receiptNumbers) addFieldCandidate(receiptBuckets, receipt, record.source, record.evidenceFiles.join(" | "));
    }

    const clientDecision = chooseBestField("clientName", clientBuckets, canonicalLookups.clients);
    rows.push({
      entityType: "CLIENTE",
      entityKey: key,
      fieldName: "clientName",
      rawValues: [...clientBuckets.values()].map((bucket) => bucket.value).join(" | "),
      normalizedValue: clientDecision.normalizedValue,
      verifiedValue: clientDecision.verifiedValue,
      score: clientDecision.score,
      status: clientDecision.status,
      evidenceSources: [...new Set(records.map((record) => record.source))].join(" | "),
      reason: clientDecision.reason,
    });

    const referidorDecision = chooseBestField("referidorName", referidorBuckets, canonicalLookups.clients);
    rows.push({
      entityType: "CLIENTE",
      entityKey: key,
      fieldName: "referidorName",
      rawValues: [...referidorBuckets.values()].map((bucket) => bucket.value).join(" | "),
      normalizedValue: referidorDecision.normalizedValue,
      verifiedValue: referidorDecision.verifiedValue,
      score: referidorDecision.score,
      status: referidorDecision.status,
      evidenceSources: [...new Set(records.map((record) => record.source))].join(" | "),
      reason: referidorDecision.reason,
    });

    const policyDecision = chooseBestField("policyNumber", policyBuckets);
    rows.push({
      entityType: "CLIENTE",
      entityKey: key,
      fieldName: "policyNumber",
      rawValues: [...policyBuckets.values()].map((bucket) => bucket.value).join(" | "),
      normalizedValue: policyDecision.normalizedValue,
      verifiedValue: policyDecision.verifiedValue,
      score: policyDecision.score,
      status: policyDecision.status,
      evidenceSources: [...new Set(records.map((record) => record.source))].join(" | "),
      reason: policyDecision.reason,
    });

    const receiptDecision = chooseBestField("receiptNumber", receiptBuckets);
    rows.push({
      entityType: "CLIENTE",
      entityKey: key,
      fieldName: "receiptNumber",
      rawValues: [...receiptBuckets.values()].map((bucket) => bucket.value).join(" | "),
      normalizedValue: receiptDecision.normalizedValue,
      verifiedValue: receiptDecision.verifiedValue,
      score: receiptDecision.score,
      status: receiptDecision.status,
      evidenceSources: [...new Set(records.map((record) => record.source))].join(" | "),
      reason: receiptDecision.reason,
    });
  }

  for (const [key, records] of groupedReceipts.entries()) {
    const receiptBuckets = new Map<string, FieldCandidateBucket>();
    const policyBuckets = new Map<string, FieldCandidateBucket>();
    const clientBuckets = new Map<string, FieldCandidateBucket>();
    const insurerBuckets = new Map<string, FieldCandidateBucket>();

    for (const record of records) {
      addFieldCandidate(receiptBuckets, record.display, record.source, record.evidenceFiles.join(" | "));
      addFieldCandidate(policyBuckets, record.policyNumber, record.source, record.evidenceFiles.join(" | "));
      addFieldCandidate(clientBuckets, record.clientName, record.source, record.evidenceFiles.join(" | "));
      addFieldCandidate(insurerBuckets, record.insurerName, record.source, record.evidenceFiles.join(" | "));
    }

    const receiptDecision = chooseBestField("receiptNumber", receiptBuckets);
    rows.push({
      entityType: "RECIBO",
      entityKey: key,
      fieldName: "receiptNumber",
      rawValues: [...receiptBuckets.values()].map((bucket) => bucket.value).join(" | "),
      normalizedValue: receiptDecision.normalizedValue,
      verifiedValue: receiptDecision.verifiedValue,
      score: receiptDecision.score,
      status: receiptDecision.status,
      evidenceSources: [...new Set(records.map((record) => record.source))].join(" | "),
      reason: receiptDecision.reason,
    });

    const policyDecision = chooseBestField("policyNumber", policyBuckets);
    rows.push({
      entityType: "RECIBO",
      entityKey: key,
      fieldName: "policyNumber",
      rawValues: [...policyBuckets.values()].map((bucket) => bucket.value).join(" | "),
      normalizedValue: policyDecision.normalizedValue,
      verifiedValue: policyDecision.verifiedValue,
      score: policyDecision.score,
      status: policyDecision.status,
      evidenceSources: [...new Set(records.map((record) => record.source))].join(" | "),
      reason: policyDecision.reason,
    });

    const clientDecision = chooseBestField("clientName", clientBuckets, canonicalLookups.clients);
    rows.push({
      entityType: "RECIBO",
      entityKey: key,
      fieldName: "clientName",
      rawValues: [...clientBuckets.values()].map((bucket) => bucket.value).join(" | "),
      normalizedValue: clientDecision.normalizedValue,
      verifiedValue: clientDecision.verifiedValue,
      score: clientDecision.score,
      status: clientDecision.status,
      evidenceSources: [...new Set(records.map((record) => record.source))].join(" | "),
      reason: clientDecision.reason,
    });

    const insurerDecision = chooseBestField("insurerName", insurerBuckets, canonicalLookups.insurers);
    rows.push({
      entityType: "RECIBO",
      entityKey: key,
      fieldName: "insurerName",
      rawValues: [...insurerBuckets.values()].map((bucket) => bucket.value).join(" | "),
      normalizedValue: insurerDecision.normalizedValue,
      verifiedValue: insurerDecision.verifiedValue,
      score: insurerDecision.score,
      status: insurerDecision.status,
      evidenceSources: [...new Set(records.map((record) => record.source))].join(" | "),
      reason: insurerDecision.reason,
    });
  }

  return rows;
}

function chooseBestField(
  fieldName: string,
  buckets: Map<string, FieldCandidateBucket>,
  canonicalLookup?: Map<string, string>,
) {
  const scored = Array.from(buckets.values())
    .map((bucket) => {
      const result = scoreFieldCandidate(fieldName, bucket, canonicalLookup);
      return {
        bucket,
        ...result,
      };
    })
    .sort((left, right) => right.score - left.score);

  const best = scored[0];
  const runnerUp = scored[1];
  if (!best) {
    return {
      normalizedValue: "",
      verifiedValue: "",
      score: 0,
      status: "reject" as FieldAuditStatus,
      reason: "sin candidatos",
    };
  }

  if (best.score < 70) {
    return {
      normalizedValue: normalizeFieldValue(fieldName, best.bucket.value),
      verifiedValue: "",
      score: best.score,
      status: "reject" as FieldAuditStatus,
      reason: best.reason,
    };
  }

  if (runnerUp && best.score - runnerUp.score < 10) {
    return {
      normalizedValue: normalizeFieldValue(fieldName, best.bucket.value),
      verifiedValue: "",
      score: best.score,
      status: "review" as FieldAuditStatus,
      reason: `conflicto:${best.bucket.value} vs ${runnerUp.bucket.value} | ${best.reason}`,
    };
  }

  return {
    normalizedValue: normalizeFieldValue(fieldName, best.bucket.value),
    verifiedValue: best.verifiedValue || normalizeFieldValue(fieldName, best.bucket.value),
    score: best.score,
    status: best.status,
    reason: best.reason,
  };
}

async function main() {
  const { revisaRoot, sapsPath, masterRoot, outPath } = parseArgs();
  await ensureDataDirs();

  const [revisarScan, masterScan, sapsRows, dbData] = await Promise.all([
    scanFolderSource(revisaRoot, "revisar"),
    scanFolderSource(masterRoot, "master"),
    Promise.resolve(parseSapsCsv(sapsPath)),
    loadDbRecords(),
  ]);

  const sapsScan = buildSapsRecords(sapsRows);
  const dbScan = buildDbRecords(dbData.policies as DbPolicy[], dbData.clients as DbClient[], dbData.receipts as DbReceipt[]);
  const canonicalLookups = buildCanonicalLookups(dbData.clients as DbClient[], dbData.insurers as DbInsurer[]);

  const allPolicyRecords = [...revisarScan.policyRecords, ...masterScan.policyRecords, ...sapsScan.policyRecords, ...dbScan.policyRecords];
  const allClientRecords = [...revisarScan.clientRecords, ...masterScan.clientRecords, ...sapsScan.clientRecords, ...dbScan.clientRecords];
  const allReceiptRecords = [...revisarScan.receiptRecords, ...masterScan.receiptRecords, ...sapsScan.receiptRecords, ...dbScan.receiptRecords];

  const groupedPolicies = groupRecords(allPolicyRecords);
  const groupedClients = groupRecords(allClientRecords);
  const groupedReceipts = groupRecords(allReceiptRecords);

  const policyRows = buildCrossRows("POLIZA", groupedPolicies);
  const clientRows = buildCrossRows("CLIENTE", groupedClients);
  const receiptRows = buildCrossRows("RECIBO", groupedReceipts);
  const fieldAuditRows = buildFieldAuditRows(groupedPolicies, groupedClients, groupedReceipts, canonicalLookups);
  const cleanedFieldRows = fieldAuditRows.filter((row) => row.status !== "reject");
  const suspiciousFieldRows = fieldAuditRows.filter((row) => row.status !== "auto");

  const reviewPdfRows = sheetRowsFromFileFindings(revisarScan.fileFindings).filter((row) => String(row.tipoArchivo) === "pdf");
  const masterFileRows = sheetRowsFromFileFindings(masterScan.fileFindings);
  const sapsSheetRows = sheetRowsFromSaps(sapsRows);
  const dbPolicyRows = sheetRowsFromDbPolicies(dbData.policies as DbPolicy[]);
  const referidorRows = buildReferidorRows(clientRows);
  const ambiguousRows = [
    ...policyRows.filter((row) => row.status === "AMBIGUO"),
    ...clientRows.filter((row) => row.status === "AMBIGUO"),
    ...receiptRows.filter((row) => row.status === "AMBIGUO"),
  ];
  const fieldRulesRows = [
    { regla: "policyNumber", descripcion: "Debe parecer numero de poliza, contener digitos y pasar normalizacion estructural.", umbral: ">= 90 auto / >= 70 revisar" },
    { regla: "receiptNumber", descripcion: "Debe parecer numero de recibo o referencia de cobranza con digitos y longitud razonable.", umbral: ">= 90 auto / >= 70 revisar" },
    { regla: "clientName", descripcion: "Debe parecer nombre real; se rechazan etiquetas, tecnicismos y texto con digitos.", umbral: ">= 90 auto / >= 70 revisar" },
    { regla: "insurerName", descripcion: "Se canoniza contra el catalogo de aseguradoras y alias simplificados.", umbral: ">= 90 auto / >= 70 revisar" },
    { regla: "referidorName", descripcion: "Solo se acepta si no colisiona con el cliente real y existe evidencia comercial coherente.", umbral: ">= 90 auto / >= 70 revisar" },
  ];

  const summaryRows = buildSummaryRows(
    [revisarScan.summary, sapsScan.summary, masterScan.summary, { source: "db", policyCandidates: dbData.policies.length, clientCandidates: dbData.clients.length, receiptCandidates: dbData.receipts.length }],
    policyRows,
    clientRows,
    receiptRows,
    new Map([
      ["revisar", revisarScan.fileFindings],
      ["master", masterScan.fileFindings],
    ]),
  );

  const workbook = toWorkbook([
    {
      nombre: "Resumen",
      columnas: simpleColumns([
        ["grupo", "Grupo"],
        ["métrica", "Métrica"],
        ["valor", "Valor"],
        ["detalle", "Detalle"],
      ]),
      filas: summaryRows,
    },
    {
      nombre: "Iguales exactos",
      columnas: genericCrossColumns(),
      filas: [...rowsForStatus(policyRows, "IGUALES_EXACTOS"), ...rowsForStatus(clientRows, "IGUALES_EXACTOS"), ...rowsForStatus(receiptRows, "IGUALES_EXACTOS")],
    },
    {
      nombre: "Solo Revisar",
      columnas: genericCrossColumns(),
      filas: [
        ...rowsForSource(policyRows, "revisar").filter((row) => row.sourceCount === 1),
        ...rowsForSource(clientRows, "revisar").filter((row) => row.sourceCount === 1),
        ...rowsForSource(receiptRows, "revisar").filter((row) => row.sourceCount === 1),
      ],
    },
    {
      nombre: "Solo SAPS",
      columnas: genericCrossColumns(),
      filas: [
        ...rowsForSource(policyRows, "saps").filter((row) => row.sourceCount === 1),
        ...rowsForSource(clientRows, "saps").filter((row) => row.sourceCount === 1),
        ...rowsForSource(receiptRows, "saps").filter((row) => row.sourceCount === 1),
      ],
    },
    {
      nombre: "Solo Master",
      columnas: genericCrossColumns(),
      filas: [
        ...rowsForSource(policyRows, "master").filter((row) => row.sourceCount === 1),
        ...rowsForSource(clientRows, "master").filter((row) => row.sourceCount === 1),
        ...rowsForSource(receiptRows, "master").filter((row) => row.sourceCount === 1),
      ],
    },
    {
      nombre: "Solo DB",
      columnas: genericCrossColumns(),
      filas: [
        ...rowsForSource(policyRows, "db").filter((row) => row.sourceCount === 1),
        ...rowsForSource(clientRows, "db").filter((row) => row.sourceCount === 1),
        ...rowsForSource(receiptRows, "db").filter((row) => row.sourceCount === 1),
      ],
    },
    {
      nombre: "Cruce Poliza",
      columnas: policyCrossColumns(),
      filas: policyRows,
    },
    {
      nombre: "Cruce Cliente",
      columnas: clientCrossColumns(),
      filas: clientRows,
    },
    {
      nombre: "Cruce Recibo",
      columnas: receiptCrossColumns(),
      filas: receiptRows,
    },
    {
      nombre: "Revisar PDFs",
      columnas: simpleColumns([
        ["fuente", "Fuente"],
        ["archivo", "Archivo"],
        ["rutaRelativa", "Ruta relativa"],
        ["topLevelFolder", "Top folder"],
        ["subjectFolder", "Carpeta sujeto"],
        ["referidorFolder", "Referidor"],
        ["tipoArchivo", "Tipo"],
        ["candidatosPoliza", "Pólizas"],
        ["candidatosCliente", "Clientes"],
        ["candidatosRecibo", "Recibos"],
        ["notas", "Notas"],
      ]),
      filas: reviewPdfRows,
    },
    {
      nombre: "Master Clientes",
      columnas: simpleColumns([
        ["fuente", "Fuente"],
        ["archivo", "Archivo"],
        ["rutaRelativa", "Ruta relativa"],
        ["topLevelFolder", "Top folder"],
        ["subjectFolder", "Carpeta sujeto"],
        ["referidorFolder", "Referidor"],
        ["tipoArchivo", "Tipo"],
        ["candidatosPoliza", "Pólizas"],
        ["candidatosCliente", "Clientes"],
        ["candidatosRecibo", "Recibos"],
        ["notas", "Notas"],
      ]),
      filas: masterFileRows,
    },
    {
      nombre: "SAPS crudo",
      columnas: simpleColumns([
        ["policyNumber", "No. Póliza"],
        ["receiptNumber", "No. Recibo"],
        ["clientName", "Cliente"],
        ["insurerName", "Aseguradora"],
        ["policyType", "Tipo Póliza"],
        ["startDate", "Inicio Póliza"],
        ["endDate", "Fin Póliza"],
        ["receiptStartDate", "Inicio Recibo"],
        ["receiptEndDate", "Fin Recibo"],
        ["paymentFrequency", "Frecuencia"],
        ["status", "Estatus"],
        ["primaNeta", "Prima Neta"],
        ["primaTotal", "Prima Total"],
      ]),
      filas: chooseRows(sapsSheetRows, 5000),
    },
    {
      nombre: "DB crudo",
      columnas: simpleColumns([
        ["policyNumber", "No. Póliza"],
        ["clientName", "Cliente"],
        ["referidor", "Referidor"],
        ["insurerName", "Aseguradora"],
        ["status", "Estatus"],
        ["currency", "Moneda"],
        ["premiumAmount", "Prima"],
        ["startDate", "Inicio"],
        ["endDate", "Fin"],
        ["renewalDate", "Renovación"],
      ]),
      filas: dbPolicyRows,
    },
    {
      nombre: "Ambiguos",
      columnas: genericCrossColumns(),
      filas: ambiguousRows,
    },
    {
      nombre: "Referidor",
      columnas: simpleColumns([
        ["cliente", "Cliente"],
        ["referidor", "Referidor"],
        ["fuentes", "Fuentes"],
        ["igualExacto", "Exacto"],
        ["notas", "Notas"],
      ]),
      filas: sheetRowsFromReferidor(referidorRows),
    },
    {
      nombre: "Campos limpios",
      columnas: simpleColumns([
        ["entityType", "Entidad"],
        ["entityKey", "Clave"],
        ["fieldName", "Campo"],
        ["rawValues", "Valores brutos"],
        ["normalizedValue", "Normalizado"],
        ["verifiedValue", "Verificado"],
        ["score", "Score"],
        ["status", "Estado"],
        ["evidenceSources", "Fuentes"],
        ["reason", "Motivo"],
      ]),
      filas: cleanedFieldRows,
    },
    {
      nombre: "Campos sospechosos",
      columnas: simpleColumns([
        ["entityType", "Entidad"],
        ["entityKey", "Clave"],
        ["fieldName", "Campo"],
        ["rawValues", "Valores brutos"],
        ["normalizedValue", "Normalizado"],
        ["verifiedValue", "Verificado"],
        ["score", "Score"],
        ["status", "Estado"],
        ["evidenceSources", "Fuentes"],
        ["reason", "Motivo"],
      ]),
      filas: suspiciousFieldRows,
    },
    {
      nombre: "Reglas limpieza",
      columnas: simpleColumns([
        ["regla", "Regla"],
        ["descripcion", "Descripcion"],
        ["umbral", "Umbral"],
      ]),
      filas: fieldRulesRows,
    },
  ]);

  const timestamp = timestampForFile();
  const targetPath =
    outPath ?? path.join(exportsDir, `four-source-reconciliation-${timestamp}.xlsx`);

  // Wide, readable defaults for the audit workbook.
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet["!ref"]) continue;
    const maxCols = 12;
    const widths = Array.from({ length: maxCols }, (_, index) => ({ wch: index < 2 ? 22 : 18 }));
    sheet["!cols"] = widths;
  }

  const buffer = workbookToBuffer(workbook);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, buffer);

  const exactPolicies = policyRows.filter((row) => row.exactAll).length;
  const exactClients = clientRows.filter((row) => row.exactAll).length;
  const exactReceipts = receiptRows.filter((row) => row.exactAll).length;

  console.log("Cruce de 4 fuentes completado");
  console.log(`Workbook: ${targetPath}`);
  console.log(`Iguales exactos - Pólizas: ${exactPolicies}`);
  console.log(`Iguales exactos - Clientes: ${exactClients}`);
  console.log(`Iguales exactos - Recibos: ${exactReceipts}`);
  console.log(`Ambiguos - Pólizas: ${policyRows.filter((row) => row.status === "AMBIGUO").length}`);
  console.log(`Ambiguos - Clientes: ${clientRows.filter((row) => row.status === "AMBIGUO").length}`);
  console.log(`Ambiguos - Recibos: ${receiptRows.filter((row) => row.status === "AMBIGUO").length}`);

  const topRows = [
    { entity: "Pólizas", exact: exactPolicies, total: policyRows.length },
    { entity: "Clientes", exact: exactClients, total: clientRows.length },
    { entity: "Recibos", exact: exactReceipts, total: receiptRows.length },
  ];
  console.table(topRows);

  await dbData.db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
