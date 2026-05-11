#!/usr/bin/env tsx

import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { PDFParse } from "pdf-parse";

import { writeActivityLog } from "../src/lib/activity-log";
import { getDb } from "../src/lib/db";
import {
  backupDatabase,
  ensureDataDirs,
  exportsDir,
  getFlag,
  hasFlag,
  parseCliArgs,
  readTabularInput,
  timestampForFile,
  writeCsv,
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

type FileType = "pdf" | "xml" | "spreadsheet" | "image" | "zip" | "other";
type MatchCategory = "matched" | "folder-only" | "db-only" | "ambiguous";
type EvidenceStrength = "hard" | "heuristic";
type EvidenceSourceKind =
  | "folder-top"
  | "folder-subject"
  | "text-label"
  | "text-line"
  | "xml-tag"
  | "spreadsheet-row"
  | "file-name"
  | "path"
  | "receipt-link";

const HARD_EVIDENCE_KINDS = new Set<EvidenceSourceKind>([
  "folder-top",
  "folder-subject",
  "text-label",
  "xml-tag",
  "spreadsheet-row",
  "receipt-link",
]);

const SOFT_EVIDENCE_KINDS = new Set<EvidenceSourceKind>(["text-line", "file-name", "path"]);

type DbClient = {
  id: string;
  fullName: string;
  type: "PERSON" | "COMPANY";
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  referidorId: string | null;
  referidor: { id: string; fullName: string } | null;
};

type DbPolicy = {
  id: string;
  policyNumber: string;
  clientId: string;
  client: { id: string; fullName: string };
  insurer: { id: string; name: string };
};

type FileMeta = {
  path: string;
  relativePath: string;
  fileName: string;
  fileType: FileType;
  isRootOrphan: boolean;
  topLevelFolder: string | null;
  subjectFolder: string | null;
  referidorFolder: string | null;
  folderChain: string[];
  textExtracted: boolean;
  notes: Set<string>;
};

type PolicySignal = {
  policyNumber: string;
  displayPolicyNumber: string;
  evidenceFiles: Set<string>;
  evidenceLocators: Set<string>;
  sourceKinds: Set<EvidenceSourceKind>;
  fileTypes: Set<FileType>;
  topLevelFolders: Set<string>;
  hardEvidenceCount: number;
  heuristicEvidenceCount: number;
  matchedDbPolicyId: string | null;
  matchedDbClientId: string | null;
  matchedDbClientName: string | null;
  insurerName: string | null;
  matchedViaReceipt: boolean;
  clientCandidates: Set<string>;
  referidorCandidates: Set<string>;
  confidence: number;
  reasons: Set<string>;
};

type ClientSignal = {
  normalizedName: string;
  displayName: string;
  evidenceFiles: Set<string>;
  evidenceLocators: Set<string>;
  sourceKinds: Set<EvidenceSourceKind>;
  fileTypes: Set<FileType>;
  topLevelFolders: Set<string>;
  hardEvidenceCount: number;
  heuristicEvidenceCount: number;
  matchedDbClientId: string | null;
  matchedDbClientName: string | null;
  suggestedType: "PERSON" | "COMPANY";
  policyNumbers: Set<string>;
  receiptNumbers: Set<string>;
  referidorNames: Set<string>;
  confidence: number;
  reasons: Set<string>;
};

type DbClientCoverage = {
  hardEvidenceCount: number;
  heuristicEvidenceCount: number;
  evidenceFiles: Set<string>;
  evidenceLocators: Set<string>;
  sourceKinds: Set<EvidenceSourceKind>;
  fileTypes: Set<FileType>;
  topLevelFolders: Set<string>;
  policyNumbers: Set<string>;
  receiptNumbers: Set<string>;
  referidorNames: Set<string>;
  confidence: number;
  reasons: Set<string>;
};

type FileAudit = {
  fileMeta: FileMeta;
  hardPolicyNumbers: Set<string>;
  heuristicPolicyNumbers: Set<string>;
  hardReceiptNumbers: Set<string>;
  heuristicReceiptNumbers: Set<string>;
  hardClientNames: Set<string>;
  heuristicClientNames: Set<string>;
  policySignalNumbers: Set<string>;
  clientSignalNames: Set<string>;
  notes: Set<string>;
};

type PolicyRow = {
  category: MatchCategory;
  policyNumber: string;
  dbPolicyId: string | null;
  dbClientId: string | null;
  dbClientName: string | null;
  insurerName: string | null;
  evidenceFiles: string[];
  evidenceLocators: string[];
  sourceKinds: string[];
  fileTypes: string[];
  topLevelFolders: string[];
  hardEvidenceCount: number;
  heuristicEvidenceCount: number;
  matchedViaReceipt: boolean;
  clientCandidates: string[];
  referidorCandidates: string[];
  confidence: number;
  reason: string[];
};

type ClientRow = {
  category: MatchCategory;
  clientName: string;
  normalizedName: string;
  dbClientId: string | null;
  dbClientName: string | null;
  dbClientType: "PERSON" | "COMPANY" | null;
  dbReferidorName: string | null;
  evidenceFiles: string[];
  evidenceLocators: string[];
  sourceKinds: string[];
  fileTypes: string[];
  topLevelFolders: string[];
  hardEvidenceCount: number;
  heuristicEvidenceCount: number;
  policyNumbers: string[];
  receiptNumbers: string[];
  referidorCandidates: string[];
  confidence: number;
  reason: string[];
};

type FolderBucket = {
  filePaths: Set<string>;
  policyMatched: Set<string>;
  policyFolderOnly: Set<string>;
  policyAmbiguous: Set<string>;
  clientMatched: Set<string>;
  clientFolderOnly: Set<string>;
  clientAmbiguous: Set<string>;
};

type FileTypeBucket = FolderBucket & {
  rootOrphanFiles: Set<string>;
};

type FileRow = {
  scope: "root-orphan" | "top-level-folder";
  topLevelFolder: string | null;
  subjectFolder: string | null;
  referidorFolder: string | null;
  folderChain: string[];
  fileType: FileType;
  fileName: string;
  relativePath: string;
  hardPolicyNumbers: string[];
  heuristicPolicyNumbers: string[];
  hardReceiptNumbers: string[];
  heuristicReceiptNumbers: string[];
  hardClientNames: string[];
  heuristicClientNames: string[];
  policySignals: string[];
  clientSignals: string[];
  policyMatched: number;
  policyFolderOnly: number;
  policyAmbiguous: number;
  clientMatched: number;
  clientFolderOnly: number;
  clientAmbiguous: number;
  notes: string[];
};

const DEFAULT_MASTER_FOLDER = "/Users/pedrogomez/Desktop/Polizas Pedro/Clientes";
const CLIENT_SCORE_THRESHOLD = 70;

function parseArgs() {
  const parsed = parseCliArgs();
  const rootFolder = parsed.positionals[0] ?? getFlag(parsed, "folder", DEFAULT_MASTER_FOLDER) ?? DEFAULT_MASTER_FOLDER;
  const outPath = getFlag(parsed, "out");
  const dryRun = !hasFlag(parsed, "apply");
  const concurrencyValue = Number(getFlag(parsed, "concurrency", "6"));
  const concurrency = Number.isFinite(concurrencyValue) && concurrencyValue > 0 ? Math.floor(concurrencyValue) : 6;
  const folderFilterValue = getFlag(parsed, "folders");
  const folders = folderFilterValue
    ? folderFilterValue
        .split(",")
        .map((value) => normalizeDisplay(value))
        .filter(Boolean)
    : [];

  return { rootFolder, outPath, dryRun, concurrency, folders };
}

function normalizeDisplay(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function guessClientType(displayName: string): "PERSON" | "COMPANY" {
  const normalized = normalizeDisplay(displayName);
  if (
    /\b(SA|S\.A\.|SACV|S\.A\.DE\.C\.V\.|SC|S\.C\.|S\.DE\.R\.L\.|SDERL|CV|SAPI|S\.A\.P\.I\.|SRL|S\.R\.L\.|LLC|INC|CORP|CORPORATION)\b/i.test(
      normalized,
    )
  ) {
    return "COMPANY";
  }

  if (/\b(GRUPO|CONSULTORIA|CONSTRUCCION|CONSTRUCTORA|INMOBILIARIA|HOSPITAL|CLINICA|SERVICIOS|DISTRIBUIDORA|IMPORTADORA|COMERCIAL|INDUSTRIAL|LOGISTICA|TRANSPORTES|FARMACEUTICA|LABORATORIOS)\b/i.test(normalized)) {
    return "COMPANY";
  }

  if (/\b(SOCIEDAD|EMPRESA|EMPRESA\.)\b/i.test(normalized)) {
    return "COMPANY";
  }

  return "PERSON";
}

function toArray(values: Iterable<string>) {
  return Array.from(new Set(Array.from(values).filter(Boolean))).sort((a, b) => a.localeCompare(b, "es"));
}

function classifyFileType(fileName: string): FileType {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".xml") return "xml";
  if (ext === ".xlsx" || ext === ".xls" || ext === ".csv") return "spreadsheet";
  if ([".jpg", ".jpeg", ".png", ".webp", ".heic", ".bmp", ".tif", ".tiff"].includes(ext)) return "image";
  if (ext === ".zip") return "zip";
  return "other";
}

function isRootOrphan(relativePath: string) {
  return path.dirname(relativePath) === ".";
}

function folderChainFromRelativePath(relativePath: string) {
  const relativeDir = path.dirname(relativePath);
  if (relativeDir === ".") return [];
  return relativeDir.split(path.sep).filter(Boolean);
}

function rowToText(row: Record<string, unknown>) {
  return Object.entries(row)
    .map(([key, value]) => `${key}: ${value === null || value === undefined ? "" : String(value)}`)
    .join(" | ");
}

function confidenceForPolicySignal(signal: PolicySignal) {
  return Math.min(
    100,
    signal.hardEvidenceCount * 45 +
      signal.heuristicEvidenceCount * 12 +
      Math.min(25, signal.evidenceFiles.size * 4) +
      (signal.matchedViaReceipt ? 10 : 0),
  );
}

function confidenceForClientSignal(signal: ClientSignal) {
  return Math.min(
    100,
    signal.hardEvidenceCount * 35 +
      signal.heuristicEvidenceCount * 10 +
      Math.min(20, signal.evidenceFiles.size * 4) +
      Math.min(10, signal.policyNumbers.size * 2),
  );
}

function confidenceForDbClientCoverage(coverage: DbClientCoverage) {
  return Math.min(
    100,
    coverage.hardEvidenceCount * 35 +
      coverage.heuristicEvidenceCount * 10 +
      Math.min(20, coverage.evidenceFiles.size * 4) +
      Math.min(10, coverage.policyNumbers.size * 2),
  );
}

function evidenceStrengthForSourceKind(sourceKind: EvidenceSourceKind): EvidenceStrength {
  if (HARD_EVIDENCE_KINDS.has(sourceKind)) return "hard";
  if (SOFT_EVIDENCE_KINDS.has(sourceKind)) return "heuristic";
  return "heuristic";
}

function hardSourceKindForFile(fileType: FileType): EvidenceSourceKind {
  if (fileType === "xml") return "xml-tag";
  if (fileType === "spreadsheet") return "spreadsheet-row";
  return "text-label";
}

function heuristicSourceKindForFile(fileType: FileType): EvidenceSourceKind {
  if (fileType === "zip") return "file-name";
  if (fileType === "image" || fileType === "other") return "path";
  return "text-line";
}

function extractHardPolicyNumbers(text: string) {
  const candidates = new Set<string>();
  const patterns = [
    /(?:no\.?\s*de\s*p[oó]liza|n[oó]?\s*p[oó]liza|n[úu]mero\s*de\s*p[oó]liza|p[oó]liza|policy(?:\s*number)?|policy\s*no\.?)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-\/]{4,})/gi,
    /<(?:NoPoliza|NumPoliza|NumeroPoliza|Poliza|P[oó]liza|PolicyNumber)>\s*([^<]{4,120})\s*<\/(?:NoPoliza|NumPoliza|NumeroPoliza|Poliza|P[oó]liza|PolicyNumber)>/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = normalizePolicyNumber(match[1] ?? "");
      if (value.length >= 6 && /\d/.test(value)) {
        candidates.add(value);
      }
    }
  }

  return Array.from(candidates);
}

function extractHeuristicPolicyNumbers(text: string) {
  return toArray(extractPolicyNumbers(text).map((value) => normalizePolicyNumber(value))).filter((value) => value.length >= 6);
}

function extractHardReceiptNumbers(text: string) {
  const candidates = new Set<string>();
  const patterns = [
    /(?:no\.?\s*de\s*recibo|n[oó]?\s*recibo|n[úu]mero\s*de\s*recibo|recibo|receipt(?:\s*number)?|receipt\s*no\.?)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-\/]{3,})/gi,
    /<(?:NoRecibo|NumRecibo|NumeroRecibo|Recibo|ReceiptNumber)>\s*([^<]{3,120})\s*<\/(?:NoRecibo|NumRecibo|NumeroRecibo|Recibo|ReceiptNumber)>/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = normalizeReceiptNumber(match[1] ?? "");
      if (value.length >= 5 && /\d/.test(value)) {
        candidates.add(value);
      }
    }
  }

  return Array.from(candidates);
}

function extractHeuristicReceiptNumbers(text: string) {
  return toArray(extractReceiptNumbers(text).map((value) => normalizeReceiptNumber(value))).filter((value) => value.length >= 5);
}

function extractHardClientNames(text: string) {
  const candidates = new Map<string, string>();
  const patterns = [
    /(?:nombre del asegurado|asegurad[oa](?: principal)?|tomador|contratante|cliente|raz[oó]n social|titular|referidor|referente|agrupador)\s*[:\-]\s*([^\n\r|;/]{3,120})/gi,
    /<(?:NombreCliente|Cliente|Asegurado|Tomador|Contratante|RazonSocial|Raz[oó]nSocial|Nombre|Referidor)>\s*([^<]{3,120})\s*<\/(?:NombreCliente|Cliente|Asegurado|Tomador|Contratante|RazonSocial|Raz[oó]nSocial|Nombre|Referidor)>/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = normalizeDisplay(match[1] ?? "");
      const key = normalizeMasterName(value);
      if (key && !candidates.has(key)) {
        candidates.set(key, value);
      }
    }
  }

  return Array.from(candidates.values());
}

function extractHeuristicClientNames(text: string) {
  return toArray(extractClientNameCandidates(text).map((value) => normalizeDisplay(value)));
}

function extractXmlNames(text: string) {
  const candidates = new Map<string, string>();
  const patterns = [
    /<(?:NombreCliente|Cliente|Asegurado|Tomador|Contratante|RazonSocial|Raz[oó]nSocial|Nombre|Referidor)>([^<]{3,120})<\/(?:NombreCliente|Cliente|Asegurado|Tomador|Contratante|RazonSocial|Raz[oó]nSocial|Nombre|Referidor)>/gi,
    /(?:NombreCliente|Cliente|Asegurado|Tomador|Contratante|RazonSocial|Raz[oó]nSocial|Nombre|Referidor)\s*=\s*"([^"]{3,120})"/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = normalizeDisplay(match[1] ?? "");
      const key = normalizeMasterName(value);
      if (key && !candidates.has(key)) {
        candidates.set(key, value);
      }
    }
  }

  return Array.from(candidates.values());
}

function createPolicySignal(policyNumber: string, displayPolicyNumber: string): PolicySignal {
  return {
    policyNumber,
    displayPolicyNumber,
    evidenceFiles: new Set<string>(),
    evidenceLocators: new Set<string>(),
    sourceKinds: new Set<EvidenceSourceKind>(),
    fileTypes: new Set<FileType>(),
    topLevelFolders: new Set<string>(),
    hardEvidenceCount: 0,
    heuristicEvidenceCount: 0,
    matchedDbPolicyId: null,
    matchedDbClientId: null,
    matchedDbClientName: null,
    insurerName: null,
    matchedViaReceipt: false,
    clientCandidates: new Set<string>(),
    referidorCandidates: new Set<string>(),
    confidence: 0,
    reasons: new Set<string>(),
  };
}

function createClientSignal(normalizedName: string, displayName: string, suggestedType: "PERSON" | "COMPANY"): ClientSignal {
  return {
    normalizedName,
    displayName,
    evidenceFiles: new Set<string>(),
    evidenceLocators: new Set<string>(),
    sourceKinds: new Set<EvidenceSourceKind>(),
    fileTypes: new Set<FileType>(),
    topLevelFolders: new Set<string>(),
    hardEvidenceCount: 0,
    heuristicEvidenceCount: 0,
    matchedDbClientId: null,
    matchedDbClientName: null,
    suggestedType,
    policyNumbers: new Set<string>(),
    receiptNumbers: new Set<string>(),
    referidorNames: new Set<string>(),
    confidence: 0,
    reasons: new Set<string>(),
  };
}

function createDbClientCoverage(): DbClientCoverage {
  return {
    hardEvidenceCount: 0,
    heuristicEvidenceCount: 0,
    evidenceFiles: new Set<string>(),
    evidenceLocators: new Set<string>(),
    sourceKinds: new Set<EvidenceSourceKind>(),
    fileTypes: new Set<FileType>(),
    topLevelFolders: new Set<string>(),
    policyNumbers: new Set<string>(),
    receiptNumbers: new Set<string>(),
    referidorNames: new Set<string>(),
    confidence: 0,
    reasons: new Set<string>(),
  };
}

function createBucket(): FolderBucket {
  return {
    filePaths: new Set<string>(),
    policyMatched: new Set<string>(),
    policyFolderOnly: new Set<string>(),
    policyAmbiguous: new Set<string>(),
    clientMatched: new Set<string>(),
    clientFolderOnly: new Set<string>(),
    clientAmbiguous: new Set<string>(),
  };
}

function createFileTypeBucket(): FileTypeBucket {
  return {
    ...createBucket(),
    rootOrphanFiles: new Set<string>(),
  };
}

function addPolicySignal(
  signals: Map<string, PolicySignal>,
  policyNumber: string,
  options: {
    displayPolicyNumber?: string;
    strength: EvidenceStrength;
    sourceKind: EvidenceSourceKind;
    fileMeta: FileMeta;
    locator: string;
    clientCandidates?: Iterable<string>;
    referidorCandidates?: Iterable<string>;
    reason?: string;
    matchedDbPolicy?: DbPolicy | null;
    matchedViaReceipt?: boolean;
  },
) {
  const normalized = normalizePolicyNumber(policyNumber);
  if (!normalized) return;

  const existing = signals.get(normalized) ?? createPolicySignal(normalized, options.displayPolicyNumber ?? normalized);
  existing.evidenceFiles.add(options.fileMeta.path);
  existing.evidenceLocators.add(options.locator);
  existing.sourceKinds.add(options.sourceKind);
  existing.fileTypes.add(options.fileMeta.fileType);
  if (!options.fileMeta.isRootOrphan && options.fileMeta.topLevelFolder) {
    existing.topLevelFolders.add(options.fileMeta.topLevelFolder);
  }
  if (options.strength === "hard") {
    existing.hardEvidenceCount += 1;
  } else {
    existing.heuristicEvidenceCount += 1;
  }
  if (options.clientCandidates) {
    for (const candidate of options.clientCandidates) {
      const normalizedCandidate = normalizeDisplay(candidate);
      if (normalizedCandidate) {
        existing.clientCandidates.add(normalizedCandidate);
      }
    }
  }
  if (options.referidorCandidates) {
    for (const candidate of options.referidorCandidates) {
      const normalizedCandidate = normalizeDisplay(candidate);
      if (normalizedCandidate) {
        existing.referidorCandidates.add(normalizedCandidate);
      }
    }
  }
  if (options.reason) {
    existing.reasons.add(options.reason);
  }
  if (options.matchedDbPolicy) {
    existing.matchedDbPolicyId = options.matchedDbPolicy.id;
    existing.matchedDbClientId = options.matchedDbPolicy.clientId;
    existing.matchedDbClientName = options.matchedDbPolicy.client.fullName;
    existing.insurerName = options.matchedDbPolicy.insurer.name;
  }
  if (options.matchedViaReceipt) {
    existing.matchedViaReceipt = true;
  }
  existing.confidence = confidenceForPolicySignal(existing);
  signals.set(normalized, existing);
}

function addClientSignal(
  signals: Map<string, ClientSignal>,
  name: string,
  options: {
    strength: EvidenceStrength;
    sourceKind: EvidenceSourceKind;
    fileMeta: FileMeta;
    locator: string;
    policyNumbers?: Iterable<string>;
    receiptNumbers?: Iterable<string>;
    referidorNames?: Iterable<string>;
    reason?: string;
    matchedDbClient?: DbClient | null;
  },
) {
  const displayName = normalizeDisplay(name);
  const normalizedName = normalizeMasterName(displayName);
  if (!normalizedName) return;

  const existing = signals.get(normalizedName) ?? createClientSignal(normalizedName, displayName, guessClientType(displayName));
  existing.evidenceFiles.add(options.fileMeta.path);
  existing.evidenceLocators.add(options.locator);
  existing.sourceKinds.add(options.sourceKind);
  existing.fileTypes.add(options.fileMeta.fileType);
  if (!options.fileMeta.isRootOrphan && options.fileMeta.topLevelFolder) {
    existing.topLevelFolders.add(options.fileMeta.topLevelFolder);
  }
  if (options.strength === "hard") {
    existing.hardEvidenceCount += 1;
  } else {
    existing.heuristicEvidenceCount += 1;
  }
  if (options.policyNumbers) {
    for (const policyNumber of options.policyNumbers) {
      const normalizedPolicy = normalizePolicyNumber(policyNumber);
      if (normalizedPolicy) {
        existing.policyNumbers.add(normalizedPolicy);
      }
    }
  }
  if (options.receiptNumbers) {
    for (const receiptNumber of options.receiptNumbers) {
      const normalizedReceipt = normalizeReceiptNumber(receiptNumber);
      if (normalizedReceipt) {
        existing.receiptNumbers.add(normalizedReceipt);
      }
    }
  }
  if (options.referidorNames) {
    for (const referidor of options.referidorNames) {
      const normalizedReferidor = normalizeDisplay(referidor);
      if (normalizedReferidor && normalizeMasterName(normalizedReferidor) !== normalizedName) {
        existing.referidorNames.add(normalizedReferidor);
      }
    }
  }
  if (options.reason) {
    existing.reasons.add(options.reason);
  }
  if (options.matchedDbClient) {
    existing.matchedDbClientId = options.matchedDbClient.id;
    existing.matchedDbClientName = options.matchedDbClient.fullName;
  }
  existing.confidence = confidenceForClientSignal(existing);
  signals.set(normalizedName, existing);
}

function getOrCreateDbClientCoverage(coverages: Map<string, DbClientCoverage>, dbClientId: string) {
  const existing = coverages.get(dbClientId) ?? createDbClientCoverage();
  if (!coverages.has(dbClientId)) {
    coverages.set(dbClientId, existing);
  }
  return existing;
}

async function readEvidenceText(filePath: string, fileType: FileType) {
  if (fileType === "pdf") {
    try {
      const stats = await fs.stat(filePath);
      if (stats.size > 10 * 1024 * 1024) {
        return {
          text: "",
          rowTexts: [] as string[],
          notes: [`pdf-too-large:${stats.size}`],
        };
      }

      const buffer = await fs.readFile(filePath);
      const parser = new PDFParse({ data: buffer });
      const result = await Promise.race([
        parser.getText({ first: 1 }),
        new Promise<{ text: string }>((_, reject) => {
          setTimeout(() => reject(new Error("pdf-parse-timeout")), 4000);
        }),
      ]);
      return { text: result.text ?? "", rowTexts: [] as string[], notes: [] as string[] };
    } catch (error) {
      return {
        text: "",
        rowTexts: [],
        notes: [`pdf-parse-failed:${error instanceof Error ? error.message : "unknown"}`],
      };
    }
  }

  if (fileType === "xml") {
    const text = await fs.readFile(filePath, "utf8");
    return { text, rowTexts: [], notes: [] as string[] };
  }

  if (fileType === "spreadsheet") {
    try {
      const rows = await readTabularInput(filePath);
      const rowTexts = rows.map((row, index) => `${index + 1}: ${rowToText(row)}`);
      return {
        text: rowTexts.join("\n"),
        rowTexts,
        notes: [`spreadsheet-rows:${rows.length}`],
      };
    } catch (error) {
      return {
        text: "",
        rowTexts: [],
        notes: [`spreadsheet-parse-failed:${error instanceof Error ? error.message : "unknown"}`],
      };
    }
  }

  if (fileType === "zip") {
    try {
      const listing = execFileSync("unzip", ["-Z1", filePath], {
        encoding: "utf8",
        maxBuffer: 5 * 1024 * 1024,
      });
      const entries = listing
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      return {
        text: entries.join("\n"),
        rowTexts: entries,
        notes: [`zip-entries:${entries.length}`],
      };
    } catch (error) {
      return {
        text: "",
        rowTexts: [],
        notes: [`zip-list-failed:${error instanceof Error ? error.message : "unknown"}`],
      };
    }
  }

  return { text: "", rowTexts: [], notes: [] as string[] };
}

function buildFileMeta(rootFolder: string, filePath: string): FileMeta {
  const relativePath = path.relative(rootFolder, filePath);
  const fileName = path.basename(filePath);
  const fileType = classifyFileType(fileName);
  const folderChain = folderChainFromRelativePath(relativePath);
  const isRootOrphanFile = isRootOrphan(relativePath);
  const topLevelFolder = isRootOrphanFile ? null : folderChain[0] ?? null;
  const subjectFolder = folderChain.filter((segment) => looksLikeClientFolder(segment)).at(-1) ?? null;
  const referidorFolder = folderChain.filter((segment) => looksLikeClientFolder(segment))[0] ?? null;

  return {
    path: filePath,
    relativePath,
    fileName,
    fileType,
    isRootOrphan: isRootOrphanFile,
    topLevelFolder,
    subjectFolder,
    referidorFolder,
    folderChain,
    textExtracted: false,
    notes: new Set<string>(),
  };
}

function extractFolderClientCandidates(fileMeta: FileMeta) {
  const folderCandidates: Array<{
    name: string;
    sourceKind: EvidenceSourceKind;
    referidorNames: string[];
    isHard: boolean;
  }> = [];

  const clientLikeFolders = fileMeta.folderChain.filter((segment) => looksLikeClientFolder(segment));
  if (clientLikeFolders.length === 0) {
    return folderCandidates;
  }

  const topLevel = clientLikeFolders[0];
  const subject = clientLikeFolders[clientLikeFolders.length - 1];

  folderCandidates.push({
    name: topLevel,
    sourceKind: "folder-top",
    referidorNames: subject && normalizeMasterName(subject) !== normalizeMasterName(topLevel) ? [topLevel] : [],
    isHard: true,
  });

  if (subject && normalizeMasterName(subject) !== normalizeMasterName(topLevel)) {
    folderCandidates.push({
      name: subject,
      sourceKind: "folder-subject",
      referidorNames: [topLevel],
      isHard: true,
    });
  }

  for (const extra of clientLikeFolders.slice(1, -1)) {
    folderCandidates.push({
      name: extra,
      sourceKind: "folder-subject",
      referidorNames: [topLevel],
      isHard: true,
    });
  }

  return folderCandidates;
}

function buildPolicyRow(
  signal: PolicySignal,
  category: MatchCategory,
  extra: {
    dbPolicyId: string | null;
    dbClientId: string | null;
    dbClientName: string | null;
    insurerName: string | null;
  },
): PolicyRow {
  const confidence = signal.confidence;
  return {
    category,
    policyNumber: signal.displayPolicyNumber,
    dbPolicyId: extra.dbPolicyId,
    dbClientId: extra.dbClientId,
    dbClientName: extra.dbClientName,
    insurerName: extra.insurerName,
    evidenceFiles: toArray(signal.evidenceFiles),
    evidenceLocators: toArray(signal.evidenceLocators),
    sourceKinds: toArray(signal.sourceKinds),
    fileTypes: toArray(signal.fileTypes),
    topLevelFolders: toArray(signal.topLevelFolders),
    hardEvidenceCount: signal.hardEvidenceCount,
    heuristicEvidenceCount: signal.heuristicEvidenceCount,
    matchedViaReceipt: signal.matchedViaReceipt,
    clientCandidates: toArray(signal.clientCandidates),
    referidorCandidates: toArray(signal.referidorCandidates),
    confidence,
    reason: toArray(signal.reasons),
  };
}

function buildClientRow(
  signal: ClientSignal,
  category: MatchCategory,
  extra: {
    dbClientId: string | null;
    dbClientName: string | null;
    dbClientType: "PERSON" | "COMPANY" | null;
    dbReferidorName: string | null;
  },
): ClientRow {
  return {
    category,
    clientName: signal.displayName,
    normalizedName: signal.normalizedName,
    dbClientId: extra.dbClientId,
    dbClientName: extra.dbClientName,
    dbClientType: extra.dbClientType,
    dbReferidorName: extra.dbReferidorName,
    evidenceFiles: toArray(signal.evidenceFiles),
    evidenceLocators: toArray(signal.evidenceLocators),
    sourceKinds: toArray(signal.sourceKinds),
    fileTypes: toArray(signal.fileTypes),
    topLevelFolders: toArray(signal.topLevelFolders),
    hardEvidenceCount: signal.hardEvidenceCount,
    heuristicEvidenceCount: signal.heuristicEvidenceCount,
    policyNumbers: toArray(signal.policyNumbers),
    receiptNumbers: toArray(signal.receiptNumbers),
    referidorCandidates: toArray(signal.referidorNames),
    confidence: signal.confidence,
    reason: toArray(signal.reasons),
  };
}

function buildDbClientRow(
  dbClient: DbClient,
  coverage: DbClientCoverage | undefined,
): ClientRow {
  if (!coverage) {
    return {
      category: "db-only",
      clientName: dbClient.fullName,
      normalizedName: normalizeMasterName(dbClient.fullName),
      dbClientId: dbClient.id,
      dbClientName: dbClient.fullName,
      dbClientType: dbClient.type,
      dbReferidorName: dbClient.referidor?.fullName ?? null,
      evidenceFiles: [],
      evidenceLocators: [],
      sourceKinds: [],
      fileTypes: [],
      topLevelFolders: [],
      hardEvidenceCount: 0,
      heuristicEvidenceCount: 0,
      policyNumbers: [],
      receiptNumbers: [],
      referidorCandidates: [],
      confidence: 0,
      reason: ["no-folder-evidence"],
    };
  }

  const category: MatchCategory = coverage.hardEvidenceCount > 0 ? "matched" : "ambiguous";
  return {
    category,
    clientName: dbClient.fullName,
    normalizedName: normalizeMasterName(dbClient.fullName),
    dbClientId: dbClient.id,
    dbClientName: dbClient.fullName,
    dbClientType: dbClient.type,
    dbReferidorName: dbClient.referidor?.fullName ?? null,
    evidenceFiles: toArray(coverage.evidenceFiles),
    evidenceLocators: toArray(coverage.evidenceLocators),
    sourceKinds: toArray(coverage.sourceKinds),
    fileTypes: toArray(coverage.fileTypes),
    topLevelFolders: toArray(coverage.topLevelFolders),
    hardEvidenceCount: coverage.hardEvidenceCount,
    heuristicEvidenceCount: coverage.heuristicEvidenceCount,
    policyNumbers: toArray(coverage.policyNumbers),
    receiptNumbers: toArray(coverage.receiptNumbers),
    referidorCandidates: toArray(coverage.referidorNames),
    confidence: coverage.confidence,
    reason: toArray(coverage.reasons),
  };
}

function bucketFromMap<T extends FolderBucket>(map: Map<string, T>, key: string, factory: () => T) {
  const existing = map.get(key) ?? factory();
  if (!map.has(key)) {
    map.set(key, existing);
  }
  return existing;
}

async function processInBatches<T>(
  items: T[],
  concurrency: number,
  handler: (item: T, index: number) => Promise<void>,
) {
  const queue = [...items];
  const limit = Math.max(1, Math.min(concurrency, queue.length || 1));
  let index = 0;

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) continue;
      const currentIndex = index;
      index += 1;
      await handler(item, currentIndex);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
}

function countRowsByCategory(rows: Array<{ category: MatchCategory }>) {
  return {
    matched: rows.filter((row) => row.category === "matched").length,
    folderOnly: rows.filter((row) => row.category === "folder-only").length,
    dbOnly: rows.filter((row) => row.category === "db-only").length,
    ambiguous: rows.filter((row) => row.category === "ambiguous").length,
  };
}

function renderBucketRow(
  key: string,
  bucket: FolderBucket,
  rootOrphanFiles = 0,
) {
  return {
    key,
    files: bucket.filePaths.size,
    rootOrphanFiles,
    policyMatched: bucket.policyMatched.size,
    policyFolderOnly: bucket.policyFolderOnly.size,
    policyAmbiguous: bucket.policyAmbiguous.size,
    clientMatched: bucket.clientMatched.size,
    clientFolderOnly: bucket.clientFolderOnly.size,
    clientAmbiguous: bucket.clientAmbiguous.size,
  };
}

function renderFileRow(
  fileAudit: FileAudit,
  policyRowByNumber: Map<string, PolicyRow>,
  clientRowByName: Map<string, ClientRow>,
): FileRow {
  const policyStatusCounts = {
    matched: 0,
    folderOnly: 0,
    ambiguous: 0,
  };

  for (const policyNumber of fileAudit.policySignalNumbers) {
    const row = policyRowByNumber.get(policyNumber);
    if (!row) continue;
    if (row.category === "matched") policyStatusCounts.matched += 1;
    else if (row.category === "folder-only") policyStatusCounts.folderOnly += 1;
    else if (row.category === "ambiguous") policyStatusCounts.ambiguous += 1;
  }

  const clientStatusCounts = {
    matched: 0,
    folderOnly: 0,
    ambiguous: 0,
  };

  for (const clientName of fileAudit.clientSignalNames) {
    const row = clientRowByName.get(normalizeMasterName(clientName));
    if (!row) continue;
    if (row.category === "matched") clientStatusCounts.matched += 1;
    else if (row.category === "folder-only") clientStatusCounts.folderOnly += 1;
    else if (row.category === "ambiguous") clientStatusCounts.ambiguous += 1;
  }

  return {
    scope: fileAudit.fileMeta.isRootOrphan ? "root-orphan" : "top-level-folder",
    topLevelFolder: fileAudit.fileMeta.topLevelFolder,
    subjectFolder: fileAudit.fileMeta.subjectFolder,
    referidorFolder: fileAudit.fileMeta.referidorFolder,
    folderChain: fileAudit.fileMeta.folderChain,
    fileType: fileAudit.fileMeta.fileType,
    fileName: fileAudit.fileMeta.fileName,
    relativePath: fileAudit.fileMeta.relativePath,
    hardPolicyNumbers: toArray(fileAudit.hardPolicyNumbers),
    heuristicPolicyNumbers: toArray(fileAudit.heuristicPolicyNumbers),
    hardReceiptNumbers: toArray(fileAudit.hardReceiptNumbers),
    heuristicReceiptNumbers: toArray(fileAudit.heuristicReceiptNumbers),
    hardClientNames: toArray(fileAudit.hardClientNames),
    heuristicClientNames: toArray(fileAudit.heuristicClientNames),
    policySignals: toArray(fileAudit.policySignalNumbers),
    clientSignals: toArray(fileAudit.clientSignalNames),
    policyMatched: policyStatusCounts.matched,
    policyFolderOnly: policyStatusCounts.folderOnly,
    policyAmbiguous: policyStatusCounts.ambiguous,
    clientMatched: clientStatusCounts.matched,
    clientFolderOnly: clientStatusCounts.folderOnly,
    clientAmbiguous: clientStatusCounts.ambiguous,
    notes: toArray(fileAudit.notes),
  };
}

async function main() {
  const { rootFolder, outPath, dryRun, concurrency, folders } = parseArgs();
  const db = getDb();

  try {
    await ensureDataDirs();

    const [dbClients, dbPolicies, dbReceipts] = await Promise.all([
      db.client.findMany({
        select: {
          id: true,
          fullName: true,
          type: true,
          status: true,
          referidorId: true,
          referidor: {
            select: {
              id: true,
              fullName: true,
            },
          },
        },
      }),
      db.policy.findMany({
        select: {
          id: true,
          policyNumber: true,
          clientId: true,
          client: {
            select: {
              id: true,
              fullName: true,
            },
          },
          insurer: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      db.receipt.findMany({
        select: {
          id: true,
          receiptNumber: true,
          policyId: true,
        },
      }),
    ]);

    const dbClientByName = new Map(dbClients.map((client) => [normalizeMasterName(client.fullName), client]));
    const dbPolicyByNumber = new Map(dbPolicies.map((policy) => [normalizePolicyNumber(policy.policyNumber), policy]));
    const dbReceiptByNumber = new Map(dbReceipts.map((receipt) => [normalizeReceiptNumber(receipt.receiptNumber), receipt]));
    const dbPolicyById = new Map(dbPolicies.map((policy) => [policy.id, policy]));
    const dbClientCoverageById = new Map<string, DbClientCoverage>();

    const allFiles = await scanMasterFolder(rootFolder);
    const folderFilterSet = folders.length > 0 ? new Set(folders.map((value) => normalizeMasterName(value))) : null;
    const files =
      folderFilterSet === null
        ? allFiles
        : allFiles.filter((file) => {
            if (path.dirname(file.relativePath) === ".") return true;
            const normalizedTopLevel = normalizeMasterName(file.topLevelFolder ?? "");
            return folderFilterSet.has(normalizedTopLevel);
          });

    const fileAudits = new Map<string, FileAudit>();
    const policySignals = new Map<string, PolicySignal>();
    const clientSignals = new Map<string, ClientSignal>();

    await processInBatches(files, concurrency, async (file) => {
      const fileMeta = buildFileMeta(rootFolder, file.absolutePath);
      const fileAudit: FileAudit = {
        fileMeta,
        hardPolicyNumbers: new Set<string>(),
        heuristicPolicyNumbers: new Set<string>(),
        hardReceiptNumbers: new Set<string>(),
        heuristicReceiptNumbers: new Set<string>(),
        hardClientNames: new Set<string>(),
        heuristicClientNames: new Set<string>(),
        policySignalNumbers: new Set<string>(),
        clientSignalNames: new Set<string>(),
        notes: new Set<string>(),
      };

      if (fileMeta.isRootOrphan) {
        fileAudit.notes.add("root-orphan");
      }
      if (fileMeta.fileType === "image") {
        fileAudit.notes.add("image-no-text-extraction");
      }
      if (fileMeta.fileType === "zip") {
        fileAudit.notes.add("zip-no-text-extraction");
      }

      const evidence = await readEvidenceText(file.absolutePath, fileMeta.fileType);
      fileMeta.textExtracted = evidence.text.length > 0;
      for (const note of evidence.notes) {
        fileMeta.notes.add(note);
        fileAudit.notes.add(note);
      }

      const hardEvidenceTextParts: string[] = [];
      if (fileMeta.fileType === "pdf" || fileMeta.fileType === "xml" || fileMeta.fileType === "spreadsheet") {
        hardEvidenceTextParts.push(evidence.text);
      }
      if (fileMeta.fileType === "spreadsheet" && evidence.rowTexts.length > 0) {
        hardEvidenceTextParts.push(evidence.rowTexts.join("\n"));
      }

      const heuristicEvidenceTextParts: string[] = [fileMeta.fileName, fileMeta.relativePath];
      if (fileMeta.fileType === "zip" || fileMeta.fileType === "image" || fileMeta.fileType === "other") {
        heuristicEvidenceTextParts.push(evidence.text);
      }
      if (fileMeta.fileType === "pdf" || fileMeta.fileType === "xml" || fileMeta.fileType === "spreadsheet") {
        heuristicEvidenceTextParts.push(evidence.text);
      }

      const hardEvidenceText = hardEvidenceTextParts.filter(Boolean).join("\n");
      const heuristicEvidenceText = heuristicEvidenceTextParts.filter(Boolean).join("\n");

      const hardPolicyNumbers = new Set<string>([
        ...extractHardPolicyNumbers(hardEvidenceText),
      ].map((value) => normalizePolicyNumber(value)).filter((value) => value.length >= 6));
      const heuristicPolicyNumbers = new Set<string>([
        ...extractHeuristicPolicyNumbers(heuristicEvidenceText),
      ].map((value) => normalizePolicyNumber(value)).filter((value) => value.length >= 6));

      const hardReceiptNumbers = new Set<string>([
        ...extractHardReceiptNumbers(hardEvidenceText),
      ].map((value) => normalizeReceiptNumber(value)).filter((value) => value.length >= 5));
      const heuristicReceiptNumbers = new Set<string>([
        ...extractHeuristicReceiptNumbers(heuristicEvidenceText),
      ].map((value) => normalizeReceiptNumber(value)).filter((value) => value.length >= 5));

      const hardClientNames = new Set<string>();
      for (const value of extractHardClientNames(hardEvidenceText)) {
        const normalized = normalizeDisplay(value);
        if (normalized) hardClientNames.add(normalized);
      }
      for (const value of extractXmlNames(hardEvidenceText)) {
        const normalized = normalizeDisplay(value);
        if (normalized) hardClientNames.add(normalized);
      }
      for (const folderCandidate of extractFolderClientCandidates(fileMeta)) {
        const normalized = normalizeDisplay(folderCandidate.name);
        if (normalized) hardClientNames.add(normalized);
      }

      const heuristicClientNames = new Set<string>();
      for (const value of extractHeuristicClientNames(heuristicEvidenceText)) {
        const normalized = normalizeDisplay(value);
        if (normalized && !Array.from(hardClientNames).some((item) => normalizeMasterName(item) === normalizeMasterName(normalized))) {
          heuristicClientNames.add(normalized);
        }
      }

      const spreadsheetRows = fileMeta.fileType === "spreadsheet" && evidence.rowTexts.length > 0 ? evidence.rowTexts : [];
      const hasRowLevelEvidence = spreadsheetRows.length > 0;

      for (const policyNumber of hardPolicyNumbers) {
        fileAudit.hardPolicyNumbers.add(policyNumber);
        fileAudit.policySignalNumbers.add(policyNumber);
      }
      for (const policyNumber of heuristicPolicyNumbers) {
        if (!hardPolicyNumbers.has(policyNumber)) {
          fileAudit.heuristicPolicyNumbers.add(policyNumber);
          fileAudit.policySignalNumbers.add(policyNumber);
        }
      }

      for (const receiptNumber of hardReceiptNumbers) {
        fileAudit.hardReceiptNumbers.add(receiptNumber);
      }
      for (const receiptNumber of heuristicReceiptNumbers) {
        if (!hardReceiptNumbers.has(receiptNumber)) {
          fileAudit.heuristicReceiptNumbers.add(receiptNumber);
        }
      }

      for (const clientName of hardClientNames) {
        fileAudit.hardClientNames.add(clientName);
        fileAudit.clientSignalNames.add(clientName);
      }
      for (const clientName of heuristicClientNames) {
        const normalized = normalizeMasterName(clientName);
        if (!Array.from(hardClientNames).some((item) => normalizeMasterName(item) === normalized)) {
          fileAudit.heuristicClientNames.add(clientName);
          fileAudit.clientSignalNames.add(clientName);
        }
      }

      const folderCandidates = extractFolderClientCandidates(fileMeta);
      const referidorFolderNames = folderCandidates.length > 0 ? [folderCandidates[0].name] : [];

      for (const policyNumber of fileAudit.hardPolicyNumbers) {
        const matchedDbPolicy = dbPolicyByNumber.get(policyNumber) ?? null;
        const sourceKind = hardSourceKindForFile(fileMeta.fileType);
        addPolicySignal(policySignals, policyNumber, {
          displayPolicyNumber: policyNumber,
          strength: evidenceStrengthForSourceKind(sourceKind),
          sourceKind,
          fileMeta,
          locator: hasRowLevelEvidence ? `${fileMeta.relativePath}` : fileMeta.relativePath,
          clientCandidates: fileAudit.clientSignalNames,
          referidorCandidates: referidorFolderNames,
          reason: matchedDbPolicy ? "hard-db-policy-hit" : "hard-folder-only-policy",
          matchedDbPolicy,
        });
      }

      for (const policyNumber of fileAudit.heuristicPolicyNumbers) {
        if (fileAudit.hardPolicyNumbers.has(policyNumber)) continue;
        const matchedDbPolicy = dbPolicyByNumber.get(policyNumber) ?? null;
        const sourceKind = heuristicSourceKindForFile(fileMeta.fileType);
        addPolicySignal(policySignals, policyNumber, {
          displayPolicyNumber: policyNumber,
          strength: evidenceStrengthForSourceKind(sourceKind),
          sourceKind,
          fileMeta,
          locator: fileMeta.relativePath,
          clientCandidates: fileAudit.clientSignalNames,
          referidorCandidates: referidorFolderNames,
          reason: matchedDbPolicy ? "heuristic-db-policy-hit" : "heuristic-ocr-policy",
          matchedDbPolicy,
        });
      }

      for (const receiptNumber of fileAudit.hardReceiptNumbers) {
        const matchedReceipt = dbReceiptByNumber.get(receiptNumber) ?? null;
        if (!matchedReceipt) continue;
        const matchedPolicy = dbPolicyById.get(matchedReceipt.policyId) ?? null;
        if (!matchedPolicy) continue;
        fileAudit.policySignalNumbers.add(normalizePolicyNumber(matchedPolicy.policyNumber));
        const sourceKind = hardSourceKindForFile(fileMeta.fileType);
        addPolicySignal(policySignals, matchedPolicy.policyNumber, {
          displayPolicyNumber: matchedPolicy.policyNumber,
          strength: evidenceStrengthForSourceKind(sourceKind),
          sourceKind: "receipt-link",
          fileMeta,
          locator: `${fileMeta.relativePath}#receipt:${receiptNumber}`,
          clientCandidates: fileAudit.clientSignalNames,
          referidorCandidates: referidorFolderNames,
          reason: "hard-receipt-linked-policy",
          matchedDbPolicy: matchedPolicy,
          matchedViaReceipt: true,
        });
      }

      for (const receiptNumber of fileAudit.heuristicReceiptNumbers) {
        if (fileAudit.hardReceiptNumbers.has(receiptNumber)) continue;
        const matchedReceipt = dbReceiptByNumber.get(receiptNumber) ?? null;
        if (!matchedReceipt) continue;
        const matchedPolicy = dbPolicyById.get(matchedReceipt.policyId) ?? null;
        if (!matchedPolicy) continue;
        fileAudit.policySignalNumbers.add(normalizePolicyNumber(matchedPolicy.policyNumber));
        const sourceKind = heuristicSourceKindForFile(fileMeta.fileType);
        addPolicySignal(policySignals, matchedPolicy.policyNumber, {
          displayPolicyNumber: matchedPolicy.policyNumber,
          strength: evidenceStrengthForSourceKind(sourceKind),
          sourceKind: "receipt-link",
          fileMeta,
          locator: `${fileMeta.relativePath}#receipt:${receiptNumber}`,
          clientCandidates: fileAudit.clientSignalNames,
          referidorCandidates: referidorFolderNames,
          reason: "heuristic-receipt-linked-policy",
          matchedDbPolicy: matchedPolicy,
          matchedViaReceipt: true,
        });
      }

      for (const clientName of fileAudit.hardClientNames) {
        const matchedDbClient = dbClientByName.get(normalizeMasterName(clientName)) ?? null;
        const sourceKind = folderCandidates.some((candidate) => normalizeMasterName(candidate.name) === normalizeMasterName(clientName))
          ? "folder-top"
          : hardSourceKindForFile(fileMeta.fileType);
        addClientSignal(clientSignals, clientName, {
          strength: evidenceStrengthForSourceKind(sourceKind),
          sourceKind,
          fileMeta,
          locator: fileMeta.fileType === "spreadsheet" && hasRowLevelEvidence ? `${fileMeta.relativePath}` : fileMeta.relativePath,
          policyNumbers: fileAudit.policySignalNumbers,
          receiptNumbers: fileAudit.hardReceiptNumbers,
          referidorNames: referidorFolderNames,
          reason: matchedDbClient ? "hard-db-client-hit" : "hard-folder-or-label-client",
          matchedDbClient,
        });
      }

      for (const clientName of fileAudit.heuristicClientNames) {
        if (Array.from(fileAudit.hardClientNames).some((item) => normalizeMasterName(item) === normalizeMasterName(clientName))) continue;
        const matchedDbClient = dbClientByName.get(normalizeMasterName(clientName)) ?? null;
        const sourceKind = heuristicSourceKindForFile(fileMeta.fileType);
        addClientSignal(clientSignals, clientName, {
          strength: evidenceStrengthForSourceKind(sourceKind),
          sourceKind,
          fileMeta,
          locator: fileMeta.relativePath,
          policyNumbers: fileAudit.policySignalNumbers,
          receiptNumbers: fileAudit.heuristicReceiptNumbers,
          referidorNames: referidorFolderNames,
          reason: matchedDbClient ? "heuristic-db-client-hit" : "heuristic-ocr-client",
          matchedDbClient,
        });
      }

      fileAudits.set(fileMeta.path, fileAudit);
    });

    const policyRows: PolicyRow[] = [];

    for (const dbPolicy of dbPolicies) {
      const signal = policySignals.get(normalizePolicyNumber(dbPolicy.policyNumber)) ?? null;
      if (!signal) {
        policyRows.push({
          category: "db-only",
          policyNumber: dbPolicy.policyNumber,
          dbPolicyId: dbPolicy.id,
          dbClientId: dbPolicy.clientId,
          dbClientName: dbPolicy.client.fullName,
          insurerName: dbPolicy.insurer.name,
          evidenceFiles: [],
          evidenceLocators: [],
          sourceKinds: [],
          fileTypes: [],
          topLevelFolders: [],
          hardEvidenceCount: 0,
          heuristicEvidenceCount: 0,
          matchedViaReceipt: false,
          clientCandidates: [],
          referidorCandidates: [],
          confidence: 0,
          reason: ["no-folder-evidence"],
        });
        continue;
      }

      const category: MatchCategory = signal.hardEvidenceCount > 0 ? "matched" : "ambiguous";
      const policyRow = buildPolicyRow(signal, category, {
        dbPolicyId: dbPolicy.id,
        dbClientId: dbPolicy.clientId,
        dbClientName: dbPolicy.client.fullName,
        insurerName: dbPolicy.insurer.name,
      });
      if (category === "matched") {
        policyRow.reason = signal.matchedViaReceipt ? ["hard-evidence", "receipt-linked"] : ["hard-evidence"];
      } else {
        policyRow.reason = ["heuristic-ocr-only"];
      }
      policyRows.push(policyRow);
    }

    for (const signal of policySignals.values()) {
      if (dbPolicyByNumber.has(signal.policyNumber)) continue;
      const category: MatchCategory = signal.hardEvidenceCount > 0 ? "folder-only" : "ambiguous";
      policyRows.push(
        buildPolicyRow(signal, category, {
          dbPolicyId: null,
          dbClientId: null,
          dbClientName: null,
          insurerName: null,
        }),
      );
    }

    const policyRowByNumber = new Map(policyRows.map((row) => [normalizePolicyNumber(row.policyNumber), row]));

    for (const policyRow of policyRows) {
      if (!policyRow.dbClientId) continue;
      const dbClient = dbClients.find((client) => client.id === policyRow.dbClientId) ?? null;
      if (!dbClient) continue;
      const coverage = getOrCreateDbClientCoverage(dbClientCoverageById, dbClient.id);
      for (const filePath of policyRow.evidenceFiles) {
        coverage.evidenceFiles.add(filePath);
      }
      for (const locator of policyRow.evidenceLocators) {
        coverage.evidenceLocators.add(locator);
      }
      for (const sourceKind of policyRow.sourceKinds) {
        coverage.sourceKinds.add(sourceKind as EvidenceSourceKind);
      }
      for (const fileType of policyRow.fileTypes) {
        coverage.fileTypes.add(fileType as FileType);
      }
      for (const topLevelFolder of policyRow.topLevelFolders) {
        coverage.topLevelFolders.add(topLevelFolder);
      }
      coverage.policyNumbers.add(policyRow.policyNumber);
      for (const referidorCandidate of policyRow.referidorCandidates) {
        coverage.referidorNames.add(referidorCandidate);
      }
      if (policyRow.category === "matched") {
        coverage.hardEvidenceCount += 1;
      } else if (policyRow.category === "ambiguous") {
        coverage.heuristicEvidenceCount += 1;
      }
      coverage.confidence = confidenceForDbClientCoverage(coverage);
    }

    const clientRows: ClientRow[] = [];

    for (const signal of clientSignals.values()) {
      const dbClient = dbClientByName.get(signal.normalizedName) ?? null;
      if (dbClient) {
        const coverage = getOrCreateDbClientCoverage(dbClientCoverageById, dbClient.id);
        for (const filePath of signal.evidenceFiles) {
          coverage.evidenceFiles.add(filePath);
        }
        for (const locator of signal.evidenceLocators) {
          coverage.evidenceLocators.add(locator);
        }
        for (const sourceKind of signal.sourceKinds) {
          coverage.sourceKinds.add(sourceKind);
        }
        for (const fileType of signal.fileTypes) {
          coverage.fileTypes.add(fileType);
        }
        for (const topLevelFolder of signal.topLevelFolders) {
          coverage.topLevelFolders.add(topLevelFolder);
        }
        for (const policyNumber of signal.policyNumbers) {
          coverage.policyNumbers.add(policyNumber);
        }
        for (const receiptNumber of signal.receiptNumbers) {
          coverage.receiptNumbers.add(receiptNumber);
        }
        for (const referidorName of signal.referidorNames) {
          coverage.referidorNames.add(referidorName);
        }
        if (signal.hardEvidenceCount > 0) {
          coverage.hardEvidenceCount += 1;
        } else {
          coverage.heuristicEvidenceCount += 1;
        }
        coverage.confidence = confidenceForDbClientCoverage(coverage);
        continue;
      }

      const category: MatchCategory = signal.hardEvidenceCount > 0 ? "folder-only" : "ambiguous";
      clientRows.push(
        buildClientRow(signal, category, {
          dbClientId: null,
          dbClientName: null,
          dbClientType: null,
          dbReferidorName: null,
        }),
      );
    }

    for (const dbClient of dbClients) {
      const coverage = dbClientCoverageById.get(dbClient.id) ?? null;
      clientRows.push(buildDbClientRow(dbClient, coverage ?? undefined));
    }

    const folderBuckets = new Map<string, FolderBucket>();
    const fileTypeBuckets = new Map<FileType, FileTypeBucket>();
    const fileMetaByPath = new Map<string, FileMeta>();
    const fileRows: FileRow[] = [];

    for (const audit of fileAudits.values()) {
      fileMetaByPath.set(audit.fileMeta.path, audit.fileMeta);
      const fileRow = renderFileRow(audit, policyRowByNumber, new Map(clientRows.map((row) => [normalizeMasterName(row.clientName), row])));
      fileRows.push(fileRow);

      const fileTypeBucket = bucketFromMap(fileTypeBuckets, fileRow.fileType, createFileTypeBucket);
      fileTypeBucket.filePaths.add(audit.fileMeta.path);
      if (audit.fileMeta.isRootOrphan) {
        fileTypeBucket.rootOrphanFiles.add(audit.fileMeta.path);
      }

      if (!audit.fileMeta.isRootOrphan && audit.fileMeta.topLevelFolder) {
        const folderBucket = bucketFromMap(folderBuckets, audit.fileMeta.topLevelFolder, createBucket);
        folderBucket.filePaths.add(audit.fileMeta.path);
      }
    }

    for (const row of policyRows) {
      for (const filePath of row.evidenceFiles) {
        const fileMeta = fileMetaByPath.get(filePath);
        if (!fileMeta || fileMeta.isRootOrphan) {
          continue;
        }
        const bucket = bucketFromMap(folderBuckets, fileMeta.topLevelFolder ?? "unknown", createBucket);
        bucket.filePaths.add(filePath);
        const typeBucket = bucketFromMap(fileTypeBuckets, fileMeta.fileType, createFileTypeBucket);
        typeBucket.filePaths.add(filePath);
        const rowId = `policy:${row.policyNumber}`;
        if (row.category === "matched") {
          bucket.policyMatched.add(rowId);
          typeBucket.policyMatched.add(rowId);
        } else if (row.category === "folder-only") {
          bucket.policyFolderOnly.add(rowId);
          typeBucket.policyFolderOnly.add(rowId);
        } else if (row.category === "ambiguous") {
          bucket.policyAmbiguous.add(rowId);
          typeBucket.policyAmbiguous.add(rowId);
        }
      }
    }

    for (const row of clientRows) {
      for (const filePath of row.evidenceFiles) {
        const fileMeta = fileMetaByPath.get(filePath);
        if (!fileMeta) continue;
        const rowId = `client:${row.normalizedName}`;
        const typeBucket = bucketFromMap(fileTypeBuckets, fileMeta.fileType, createFileTypeBucket);
        typeBucket.filePaths.add(filePath);
        if (fileMeta.isRootOrphan) {
          typeBucket.rootOrphanFiles.add(filePath);
        } else if (fileMeta.topLevelFolder) {
          const bucket = bucketFromMap(folderBuckets, fileMeta.topLevelFolder, createBucket);
          bucket.filePaths.add(filePath);
          if (row.category === "matched") {
            bucket.clientMatched.add(rowId);
          } else if (row.category === "folder-only") {
            bucket.clientFolderOnly.add(rowId);
          } else if (row.category === "ambiguous") {
            bucket.clientAmbiguous.add(rowId);
          }
        }
        if (row.category === "matched") {
          typeBucket.clientMatched.add(rowId);
        } else if (row.category === "folder-only") {
          typeBucket.clientFolderOnly.add(rowId);
        } else if (row.category === "ambiguous") {
          typeBucket.clientAmbiguous.add(rowId);
        }
      }
    }

    const policyCounts = countRowsByCategory(policyRows);
    const clientCounts = countRowsByCategory(clientRows);
    const rootOrphanRows = fileRows.filter((row) => row.scope === "root-orphan");

    const folderSummaryRows = Array.from(folderBuckets.entries())
      .sort(([a], [b]) => a.localeCompare(b, "es"))
      .map(([folder, bucket]) => renderBucketRow(folder, bucket));

    const fileTypeSummaryRows = Array.from(fileTypeBuckets.entries())
      .sort(([a], [b]) => a.localeCompare(b, "es"))
      .map(([fileType, bucket]) => renderBucketRow(fileType, bucket, bucket.rootOrphanFiles.size));

    const reportTimestamp = timestampForFile();
    const reportBaseName = `master-folder-cross-check-${reportTimestamp}`;
    const reportRoot = outPath ? path.resolve(outPath) : path.join(exportsDir, reportBaseName);
    const jsonPath = reportRoot.endsWith(".json") ? reportRoot : `${reportRoot}.json`;
    const mdPath = reportRoot.endsWith(".md") ? reportRoot : `${reportRoot}.md`;
    const policiesCsvPath = `${reportRoot}-policies.csv`;
    const clientsCsvPath = `${reportRoot}-clients.csv`;
    const filesCsvPath = `${reportRoot}-files.csv`;
    const foldersCsvPath = `${reportRoot}-top-level-folders.csv`;
    const fileTypesCsvPath = `${reportRoot}-file-types.csv`;
    const referidorCsvPath = `${reportRoot}-referidor-graph.csv`;

    const referidorGraphRows = clientRows
      .filter((row) => row.category !== "db-only")
      .map((row) => ({
        clientName: row.clientName,
        clientStatus: row.category,
        referidorCandidates: row.referidorCandidates.join(" | "),
        dbReferidorName: row.dbReferidorName ?? "",
        sourceFiles: row.evidenceFiles.join(" | "),
        policyNumbers: row.policyNumbers.join(" | "),
      }));

    const summary = {
      generatedAt: new Date().toISOString(),
      rootFolder,
      mode: dryRun ? "read-only" : "apply-missing-clients",
      counts: {
        files: files.length,
        rootOrphanFiles: rootOrphanRows.length,
        db: {
          clients: dbClients.length,
          policies: dbPolicies.length,
          receipts: dbReceipts.length,
        },
        policies: policyCounts,
        clients: clientCounts,
      },
    };

    await fs.writeFile(
      jsonPath,
      JSON.stringify(
        {
          summary,
          policies: policyRows,
          clients: clientRows,
          files: fileRows,
          topLevelFolders: folderSummaryRows,
          fileTypes: fileTypeSummaryRows,
          rootOrphans: {
            files: rootOrphanRows.length,
            byFileType: fileTypeSummaryRows.filter((row) => row.rootOrphanFiles > 0),
          },
          referidorGraph: referidorGraphRows,
        },
        null,
        2,
      ),
      "utf8",
    );

    const mdLines = [
      "# Master Folder Cross-Check",
      "",
      `- Root folder: \`${rootFolder}\``,
      `- Generated at: ${summary.generatedAt}`,
      `- Mode: ${summary.mode}`,
      "",
      "## Summary",
      "",
      `- Files scanned: ${summary.counts.files}`,
      `- Root-orphan files: ${summary.counts.rootOrphanFiles}`,
      `- DB clients: ${summary.counts.db.clients}`,
      `- DB policies: ${summary.counts.db.policies}`,
      `- DB receipts: ${summary.counts.db.receipts}`,
      `- Policy matched: ${summary.counts.policies.matched}`,
      `- Policy folder-only: ${summary.counts.policies.folderOnly}`,
      `- Policy db-only: ${summary.counts.policies.dbOnly}`,
      `- Policy ambiguous: ${summary.counts.policies.ambiguous}`,
      `- Client matched: ${summary.counts.clients.matched}`,
      `- Client folder-only: ${summary.counts.clients.folderOnly}`,
      `- Client db-only: ${summary.counts.clients.dbOnly}`,
      `- Client ambiguous: ${summary.counts.clients.ambiguous}`,
      "",
      "## Notes",
      "",
      "- `matched` only uses hard policy evidence.",
      "- `folder-only` is reserved for hard evidence not found in DB.",
      "- `ambiguous` captures OCR-only or low-confidence signals.",
      "- `root-orphans` are tracked separately and do not count toward the top-level folder total.",
      "",
      "## Top-level folders",
      "",
      ...folderSummaryRows.slice(0, 25).map((row) => `- ${row.key}: files=${row.files}, policies(m/f/a)=${row.policyMatched}/${row.policyFolderOnly}/${row.policyAmbiguous}, clients(m/f/a)=${row.clientMatched}/${row.clientFolderOnly}/${row.clientAmbiguous}`),
      ...(folderSummaryRows.length > 25 ? [`- ... and ${folderSummaryRows.length - 25} more folders`] : []),
      "",
      "## Root orphans",
      "",
      ...(rootOrphanRows.length > 0
        ? rootOrphanRows.slice(0, 25).map((row) => `- ${row.relativePath} [${row.fileType}]`)
        : ["- none"]),
    ].join("\n");

    await fs.writeFile(mdPath, mdLines, "utf8");

    await writeCsv(policiesCsvPath, policyRows);
    await writeCsv(clientsCsvPath, clientRows);
    await writeCsv(filesCsvPath, fileRows);
    await writeCsv(foldersCsvPath, folderSummaryRows);
    await writeCsv(fileTypesCsvPath, fileTypeSummaryRows);
    await writeCsv(referidorCsvPath, referidorGraphRows);

    if (!dryRun) {
      const backupPath = await backupDatabase();
      if (backupPath) {
        console.log(`Backup creado: ${backupPath}`);
      }

      let createdClients = 0;

      for (const row of clientRows) {
        if (row.category !== "folder-only") continue;
        if (row.confidence < CLIENT_SCORE_THRESHOLD) continue;

        const normalizedName = normalizeMasterName(row.clientName);
        const existingDbClient = dbClientByName.get(normalizedName) ?? null;
        if (existingDbClient) continue;

        const referidorCandidates = row.referidorCandidates
          .map((value) => dbClientByName.get(normalizeMasterName(value)) ?? null)
          .filter((value): value is DbClient => Boolean(value) && normalizeMasterName(value.fullName) !== normalizedName);
        const uniqueReferidorIds = Array.from(new Set(referidorCandidates.map((value) => value.id)));
        const resolvedReferidorId = uniqueReferidorIds.length === 1 ? uniqueReferidorIds[0] : null;

        const created = await db.client.create({
          data: {
            fullName: row.clientName,
            type: row.dbClientType ?? "PERSON",
            status: "ACTIVE",
            referidorId: resolvedReferidorId,
            notes: resolvedReferidorId
              ? "Creado desde la conciliacion de carpeta maestra."
              : `Creado desde la conciliacion de carpeta maestra. Referidor pendiente: ${row.referidorCandidates.join(", ") || "no detectado"}.`,
          },
        });

        await writeActivityLog({
          entityType: "Client",
          entityId: created.id,
          action: "CLIENT_CREATE_FROM_MASTER_FOLDER",
          newValue: {
            fullName: row.clientName,
            referidorId: resolvedReferidorId,
            confidence: row.confidence,
            sourceFiles: row.evidenceFiles,
          },
        });

        createdClients += 1;
      }

      console.log(`Clientes creados desde conciliacion: ${createdClients}`);
    }

    console.log("Conciliacion de carpeta maestra completada.");
    console.log(`Informe JSON: ${jsonPath}`);
    console.log(`Informe MD: ${mdPath}`);
    console.log(`CSV policies: ${policiesCsvPath}`);
    console.log(`CSV clients: ${clientsCsvPath}`);
    console.log(`CSV files: ${filesCsvPath}`);
    console.log(`CSV folders: ${foldersCsvPath}`);
    console.log(`CSV file types: ${fileTypesCsvPath}`);
    console.log(`CSV referidor graph: ${referidorCsvPath}`);
    console.log("");
    console.log(`Policy rows: ${policyRows.length}`);
    console.log(`Client rows: ${clientRows.length}`);
    console.log(`Root-orphan files: ${rootOrphanRows.length}`);
    console.log(`Top-level folders: ${folderSummaryRows.length}`);
    console.log(`Mode: ${dryRun ? "solo lectura" : "aplicar clientes nuevos"}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
