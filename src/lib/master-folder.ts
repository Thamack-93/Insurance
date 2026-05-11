import fs from "node:fs/promises";
import path from "node:path";

export type MasterFolderFileKind = "pdf" | "xml" | "spreadsheet" | "zip" | "image" | "other";

export type MasterFolderFileContext = {
  absolutePath: string;
  relativePath: string;
  fileName: string;
  extension: string;
  kind: MasterFolderFileKind;
  pathSegments: string[];
  topLevelFolder: string;
  subjectFolder: string | null;
  referidorFolder: string | null;
  groupFolders: string[];
};

const TECHNICAL_FOLDER_KEYS = new Set([
  "poliza",
  "polizas",
  "documento",
  "documentos",
  "documentacion",
  "documentacioncliente",
  "recibo",
  "recibos",
  "pago",
  "pagos",
  "factura",
  "facturas",
  "comprobante",
  "comprobantes",
  "archivo",
  "archivos",
  "carpeta",
  "carpetas",
  "expediente",
  "expedientes",
  "anexo",
  "anexos",
  "adjunto",
  "adjuntos",
  "cliente",
  "clientes",
  "foto",
  "fotos",
  "imagen",
  "imagenes",
  "renovacion",
  "renovaciones",
  "endoso",
  "endosos",
  "siniestro",
  "siniestros",
  "bupa",
  "axa",
  "gnp",
  "qualitas",
  "qualtias",
  "mapfre",
  "zurich",
  "chubb",
  "banorte",
  "metlife",
  "sura",
  "ptqualitas",
  "accpersonales",
  "accidentespersonales",
  "dsstore",
  "thumbsdb",
  "desktopini",
  "macosx",
  "gitkeep",
]);

const SPREADSHEET_EXTENSIONS = new Set([".xls", ".xlsx", ".xlsm", ".xlsb", ".ods", ".csv", ".tsv"]);
const ZIP_EXTENSIONS = new Set([".zip"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".bmp", ".tif", ".tiff"]);

const CLIENT_SUFFIX_RE = /\b(SA|S\.A\.|SACV|S\.A\.DE\.C\.V\.|SC|S\.C\.|S\.DE\.R\.L\.|SDERL|CV|SAPI|S\.A\.P\.I\.)\b/i;

const NAME_LINE_RE = /^[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñüÜ'’.-]+(?:\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñüÜ'’.-]+){1,7}$/;
const ALL_CAPS_NAME_RE = /^[A-ZÁÉÍÓÚÑ]{2,}(?:\s+[A-ZÁÉÍÓÚÑ]{2,}){1,7}$/;

const CLIENT_NAME_NOISE_PHRASES = new Set([
  "NOMBRE",
  "NOMBRE COMPLETO",
  "NOMBRE COMERCIAL",
  "NOMBRE DEL ASEGURADO",
  "NOMBRE DEL CONTRATANTE",
  "NOMBRE DEL CLIENTE",
  "NOMBRE DEL TITULAR",
  "RAZON SOCIAL",
  "RAZON SOCIAL DEL ASEGURADO",
  "ASEGURADO",
  "ASEGURADA",
  "ASEGURADO PRINCIPAL",
  "CONTRATANTE",
  "TOMADOR",
  "TITULAR",
  "BENEFICIARIO",
  "PROPIETARIO",
  "CLIENTE",
  "POLIZA",
  "RECIBO",
  "ENDOSO",
  "RENOVACION",
  "COTIZACION",
  "COMPROBANTE",
  "FACTURA",
  "DOCUMENTO",
  "DOCUMENTOS",
  "CARTA RESPONSIVA",
  "AVISO DE PRIVACIDAD",
  "SOLICITUD",
  "DECLARACION",
  "COMPROBANTE DE PAGO",
  "SINIESTRO",
  "AGENTE",
  "ASEGURADORA",
  "VIGENCIA",
  "VENCIMIENTO",
  "PRIMA",
  "MONTO",
  "TOTAL",
  "SUBTOTAL",
  "IMPORTE",
  "IVA",
  "FOLIO",
  "NUMERO",
]);

const CLIENT_NAME_NOISE_TOKENS = new Set([
  "NOMBRE",
  "RAZON",
  "SOCIAL",
  "ASEGURADO",
  "ASEGURADA",
  "CONTRATANTE",
  "TOMADOR",
  "TITULAR",
  "BENEFICIARIO",
  "PROPIETARIO",
  "CLIENTE",
  "POLIZA",
  "RECIBO",
  "ENDOSO",
  "RENOVACION",
  "COTIZACION",
  "COMPROBANTE",
  "FACTURA",
  "DOCUMENTO",
  "DOCUMENTOS",
  "CARTA",
  "RESPONSIVA",
  "AVISO",
  "PRIVACIDAD",
  "SOLICITUD",
  "DECLARACION",
  "SINIESTRO",
  "AGENTE",
  "ASEGURADORA",
  "VIGENCIA",
  "VENCIMIENTO",
  "PRIMA",
  "MONTO",
  "TOTAL",
  "SUBTOTAL",
  "IMPORTE",
  "IVA",
  "FOLIO",
  "NUMERO",
  "PAGO",
  "PAGOS",
  "CONCEPTO",
  "DESCRIPCION",
  "DETALLE",
  "DETALLES",
  "RESUMEN",
  "MOVIMIENTO",
  "MOVIMIENTOS",
  "REFERENCIA",
  "SALDO",
  "ABONO",
  "CARGO",
  "ESTATUS",
  "CONTADO",
  "EFECTIVO",
  "TRANSFERENCIA",
  "TARJETA",
  "CHEQUE",
  "CREDITO",
  "RFC",
  "CURP",
  "CIF",
  "NIT",
  "CP",
  "TEL",
  "TELEFONO",
  "CORREO",
  "EMAIL",
  "DIRECCION",
  "DOMICILIO",
  "MARCA",
  "MODELO",
  "SERIE",
  "PLACA",
  "MOTOR",
  "CHASIS",
  "RAMO",
  "FECHA",
]);

const CLIENT_LABEL_PREFIX_RE = /^(?:NOMBRE(?:\s+COMERCIAL|\s+DEL\s+(?:ASEGURADO|CONTRATANTE|CLIENTE|TITULAR|TOMADOR))?|RAZON\s+SOCIAL|ASEGURAD[OA](?:\s+PRINCIPAL)?|CONTRATANTE|TOMADOR|CLIENTE|TITULAR|BENEFICIARIO|PROPIETARIO|POLIZA|RECIBO|ENDOSO|RENOVACION|COTIZACION|FACTURA|COMPROBANTE|CARTA\s+RESPONSIVA|AVISO\s+DE\s+PRIVACIDAD|SOLICITUD|DECLARACION|SINIESTRO|AGENTE|ASEGURADORA|VIGENCIA|VENCIMIENTO|PRIMA|MONTO|TOTAL|SUBTOTAL|IMPORTE|IVA|FOLIO|NUMERO)\b/i;

function removeDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeMasterKey(value: string) {
  return removeDiacritics(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

export function normalizeMasterName(value: string) {
  return removeDiacritics(value)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDisplayText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

type EvidenceSourceProfile = "pdf" | "xml" | "spreadsheet";

function looksLikeXmlSource(text: string) {
  return /<\?xml\b/i.test(text) || /<\/?[A-Za-z][^>]*>/.test(text);
}

function looksLikeSpreadsheetSource(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;

  const tabularLines = lines.filter((line) => line.includes("\t") && line.split("\t").length >= 3);
  return tabularLines.length >= 2;
}

function getEvidenceSourceProfile(text: string): EvidenceSourceProfile {
  if (looksLikeXmlSource(text)) return "xml";
  if (looksLikeSpreadsheetSource(text)) return "spreadsheet";
  return "pdf";
}

export function normalizePolicyNumber(value: string) {
  return value
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[-./]/g, "")
    .replace(/^0+/, "");
}

export function normalizeReceiptNumber(value: string) {
  return normalizePolicyNumber(value);
}

export function isSpreadsheetFile(fileName: string) {
  return SPREADSHEET_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

export function isZipArchiveFile(fileName: string) {
  return ZIP_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

export function looksLikeClientFolder(value: string) {
  const trimmed = normalizeDisplayText(value);
  if (!trimmed) return false;
  if (/^[._]/.test(trimmed)) return false;

  const key = normalizeMasterKey(trimmed).toLowerCase();
  if (!key) return false;
  if (TECHNICAL_FOLDER_KEYS.has(key)) return false;
  if (/^\d{4}$/.test(key)) return false;

  const hasDigits = /\d/.test(trimmed);
  if (hasDigits && !CLIENT_SUFFIX_RE.test(trimmed)) {
    return false;
  }

  const words = normalizeMasterName(trimmed).split(" ").filter(Boolean);
  if (isGenericClientHeading(trimmed, words)) return false;
  if (words.length >= 2) return true;
  if (CLIENT_SUFFIX_RE.test(trimmed)) return true;

  return false;
}

function classifyFileKind(fileName: string): MasterFolderFileKind {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".xml") return "xml";
  if (SPREADSHEET_EXTENSIONS.has(ext)) return "spreadsheet";
  if (ZIP_EXTENSIONS.has(ext)) return "zip";
  if (IMAGE_EXTENSIONS.has(ext)) {
    return "image";
  }
  return "other";
}

export function deriveMasterFolderContext(rootFolder: string, absolutePath: string): MasterFolderFileContext {
  const relativePath = path.relative(rootFolder, absolutePath);
  const relativeDir = path.dirname(relativePath);
  const pathSegments = relativeDir === "." ? [] : relativeDir.split(path.sep).filter(Boolean);
  const fileName = path.basename(absolutePath);
  const extension = path.extname(fileName).toLowerCase();
  const kind = classifyFileKind(fileName);
  const topLevelFolder = pathSegments[0] ?? path.basename(rootFolder);

  const meaningfulFolders = pathSegments.filter((segment, index) => {
    if (isTechnicalFolder(segment)) return false;
    return index === 0 || looksLikeClientFolder(segment);
  });
  const referidorFolder = pathSegments.length > 0 ? meaningfulFolders[0] ?? null : null;
  const subjectFolder = meaningfulFolders.length > 1 ? meaningfulFolders[meaningfulFolders.length - 1] : null;
  const groupFolders = pathSegments.filter((segment) => {
    if (isTechnicalFolder(segment)) return false;
    if (/^\d{4}$/.test(segment)) return true;
    if (segment === referidorFolder) return false;
    if (subjectFolder && segment === subjectFolder) return false;
    return !looksLikeClientFolder(segment);
  });

  return {
    absolutePath,
    relativePath,
    fileName,
    extension,
    kind,
    pathSegments,
    topLevelFolder,
    subjectFolder,
    referidorFolder,
    groupFolders,
  };
}

export async function scanMasterFolder(rootFolder: string) {
  const results: MasterFolderFileContext[] = [];

  async function walk(currentDir: string) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      results.push(deriveMasterFolderContext(rootFolder, absolutePath));
    }
  }

  await walk(rootFolder);
  return results;
}

function isYearToken(value: string) {
  return /^\d{4}$/.test(value.trim());
}

function cleanCapturedName(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\b(RFC|CURP|CIF|NIT|C\.\s*P\.)\b.*$/i, "")
    .replace(/[\|\[\]\(\){}<>]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function scoreDisplayCandidate(value: string) {
  const display = normalizeDisplayText(value);
  if (!display) return -Infinity;

  let score = 0;
  if (/[a-záéíóúñü]/.test(display)) score += 4;
  if (/[A-ZÁÉÍÓÚÑ]/.test(display)) score += 1;
  if (display === display.toUpperCase()) score -= 1;
  if (/[.&'’\-]/.test(display)) score += 1;
  if (display.length >= 8 && display.length <= 60) score += 1;

  return score;
}

function chooseBetterDisplayCandidate(existing: string, candidate: string) {
  if (!existing) return normalizeDisplayText(candidate);
  if (!candidate) return normalizeDisplayText(existing);

  const existingScore = scoreDisplayCandidate(existing);
  const candidateScore = scoreDisplayCandidate(candidate);
  if (candidateScore > existingScore) return normalizeDisplayText(candidate);
  if (candidateScore < existingScore) return normalizeDisplayText(existing);
  return normalizeDisplayText(existing).length <= normalizeDisplayText(candidate).length
    ? normalizeDisplayText(existing)
    : normalizeDisplayText(candidate);
}

function isGenericClientHeading(value: string, words?: string[]) {
  const normalized = normalizeMasterName(value);
  if (!normalized) return true;
  if (CLIENT_NAME_NOISE_PHRASES.has(normalized)) return true;
  if (CLIENT_LABEL_PREFIX_RE.test(normalized)) return true;

  const tokens = words ?? normalized.split(" ").filter(Boolean);
  if (tokens.length < 2) return false;

  const noiseTokenCount = tokens.filter((token) => CLIENT_NAME_NOISE_TOKENS.has(token)).length;
  if (noiseTokenCount === tokens.length) return true;
  if (tokens.length >= 3 && noiseTokenCount >= tokens.length - 1) return true;
  if (tokens.length >= 4 && noiseTokenCount >= Math.ceil(tokens.length * 0.75)) return true;

  return false;
}

function isLikelyNameLine(value: string, sourceProfile: EvidenceSourceProfile = "pdf") {
  const trimmed = normalizeDisplayText(value);
  if (!trimmed || trimmed.length < 4 || trimmed.length > 120) return false;
  if (/\d/.test(trimmed)) return false;

  const normalized = normalizeMasterName(trimmed);
  if (!normalized || normalized.length < 4) return false;
  if (isGenericClientHeading(trimmed)) return false;

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length < 2 || tokens.length > 8) return false;
  if (tokens.some((token) => token.length < 2)) return false;

  const noiseTokenCount = tokens.filter((token) => CLIENT_NAME_NOISE_TOKENS.has(token)).length;
  if (noiseTokenCount >= tokens.length) return false;
  if (tokens.length >= 3 && noiseTokenCount >= tokens.length - 1) return false;

  if (/^(poliza|póliza|recibo|documento|factura|endoso|renovacion|renovación)$/i.test(trimmed)) {
    return false;
  }

  const hasNameShape = NAME_LINE_RE.test(trimmed) || ALL_CAPS_NAME_RE.test(trimmed) || CLIENT_SUFFIX_RE.test(trimmed);
  if (sourceProfile === "pdf") {
    return hasNameShape;
  }

  return hasNameShape || Boolean(tokens.join(" "));
}

function collectMatches(text: string, regexes: RegExp[]) {
  const matches = new Set<string>();
  for (const regex of regexes) {
    for (const match of text.matchAll(regex)) {
      const captured = cleanCapturedName(match[1] ?? match[0] ?? "");
      if (captured) matches.add(captured);
    }
  }
  return Array.from(matches);
}

type ExtractionMode = "text" | "path";

export function extractPolicyNumbers(text: string, mode: ExtractionMode = "text") {
  return extractPolicyNumbersFromSource(text, mode);
}

function extractPolicyNumbersFromSource(text: string, mode: ExtractionMode) {
  const candidates = new Set<string>();
  const structuredSource = looksLikeXmlSource(text) || looksLikeSpreadsheetSource(text);

  collectMatches(text, [
    /(?:no\.?\s*de\s*p[oó]liza|n[oó]?\s*p[oó]liza|n[uú]mero\s*de\s*p[oó]liza|poliza|p[oó]liza|certificado)\s*[:#\-]?\s*([A-Z0-9\-\/]*\d[A-Z0-9\-\/]*)/gi,
    /(?:poliza|p[oó]liza|certificado)\s+([A-Z0-9\-\/]*\d[A-Z0-9\-\/]*)/gi,
  ]).forEach((value) => candidates.add(normalizePolicyNumber(value)));

  if (mode === "path" || structuredSource) {
    const normalizedText = normalizeMasterName(text);
    const tokens = normalizedText.split(/\s+/).filter(Boolean);

    for (const token of tokens) {
      if (token.length < 6) continue;
      if (/^\d{4}$/.test(token)) continue;
      if (/^\d{8}$/.test(token) && /^20\d{6}$/.test(token)) continue;
      if (mode === "path" && /^\d{7,15}$/.test(token)) {
        candidates.add(token);
        continue;
      }
      if (structuredSource && /[A-Z]/.test(token) && /\d/.test(token) && token.length >= 6) {
        candidates.add(token);
      }
    }
  }

  return Array.from(candidates)
    .map((value) => normalizePolicyNumber(value))
    .filter((value) => value.length >= 6);
}

export function extractReceiptNumbers(text: string, mode: ExtractionMode = "text") {
  return extractReceiptNumbersFromSource(text, mode);
}

function extractReceiptNumbersFromSource(text: string, mode: ExtractionMode) {
  const candidates = new Set<string>();
  const structuredSource = looksLikeXmlSource(text) || looksLikeSpreadsheetSource(text);

  collectMatches(text, [
    /(?:no\.?\s*de\s*recibo|n[oó]?\s*recibo|n[uú]mero\s*de\s*recibo|recibo)\s*[:#\-]?\s*([A-Z0-9\-\/]*\d[A-Z0-9\-\/]*)/gi,
    /(?:recibo)\s+([A-Z0-9\-\/]*\d[A-Z0-9\-\/]*)/gi,
  ]).forEach((value) => candidates.add(normalizeReceiptNumber(value)));

  if (mode === "path" || structuredSource) {
    const normalizedText = normalizeMasterName(text);
    const tokens = normalizedText.split(/\s+/).filter(Boolean);

    for (const token of tokens) {
      if (token.length < 5) continue;
      if (/^\d{4}$/.test(token)) continue;
      if (mode === "path" && /^\d{6,15}$/.test(token)) {
        candidates.add(token);
        continue;
      }
      if (structuredSource && /[A-Z]/.test(token) && /\d/.test(token) && token.length >= 5) {
        candidates.add(token);
      }
    }
  }

  return Array.from(candidates)
    .map((value) => normalizeReceiptNumber(value))
    .filter((value) => value.length >= 5);
}

export function extractEvidenceCandidates(text: string, mode: ExtractionMode = "text") {
  return {
    policyNumbers: extractPolicyNumbers(text, mode),
    receiptNumbers: extractReceiptNumbers(text, mode),
    clientNameCandidates: extractClientNameCandidates(text),
  };
}

export function extractClientNameCandidates(text: string) {
  const candidates = new Map<string, string>();
  const sourceProfile = getEvidenceSourceProfile(text);

  collectMatches(text, [
    /(?:nombre del asegurado|asegurad[oa](?: principal)?|tomador|contratante|cliente|raz[oó]n social|titular)\s*[:\-]\s*([^\n\r|;/]{3,120})/gi,
    /(?:asegurad[oa](?: principal)?|tomador|contratante|cliente|raz[oó]n social|titular)\s+([^\n\r|;/]{3,120})/gi,
  ]).forEach((value) => {
    if (isLikelyNameLine(value, sourceProfile)) {
      const normalized = normalizeMasterName(value);
      const display = normalizeDisplayText(value);
      if (normalized) {
        candidates.set(normalized, chooseBetterDisplayCandidate(candidates.get(normalized) ?? "", display));
      }
    }
  });

  for (const rawLine of text.split(/\r?\n/)) {
    const line = cleanCapturedName(rawLine);
    if (!isLikelyNameLine(line, sourceProfile)) continue;
    const normalized = normalizeMasterName(line);
    if (normalized) {
      candidates.set(normalized, chooseBetterDisplayCandidate(candidates.get(normalized) ?? "", line));
    }
  }

  return Array.from(candidates.values());
}

export function isTechnicalFolder(value: string) {
  const key = normalizeMasterKey(value).toLowerCase();
  return TECHNICAL_FOLDER_KEYS.has(key) || isYearToken(value);
}
