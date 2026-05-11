#!/usr/bin/env tsx

import fs from "node:fs/promises";
import path from "node:path";

import * as XLSX from "@e965/xlsx";

import { exportsDir, ensureDataDirs, getFlag, parseCliArgs, timestampForFile } from "./_shared";
import { normalizeMasterName, normalizePolicyNumber, normalizeReceiptNumber } from "../src/lib/master-folder";

type FieldStatus = "auto" | "review" | "reject";

type CleanRow = {
  sourceSheet: string;
  entityType: string;
  entityKey: string;
  fieldName: string;
  rawValues: string;
  normalizedValue: string;
  verifiedValue: string;
  score: number;
  status: FieldStatus;
  sources: string;
  reason: string;
};

type CrossRow = Record<string, string | number | boolean>;

const DEFAULT_SOURCE_WORKBOOK = path.join(exportsDir, "four-source-reconciliation-2026-05-07-12-04.xlsx");

const CLIENT_NOISE = new Set([
  "CARATULA",
  "RECIBO",
  "RECIBOS",
  "POLIZA",
  "PAGO",
  "PAGOS",
  "VIGENCIA",
  "VENCIMIENTO",
  "PRIMA",
  "TOTAL",
  "ENDOSO",
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
]);

function normalizeDisplay(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function looksLikeClientName(value: string) {
  const display = normalizeDisplay(value);
  if (!display || display.length < 3 || display.length > 120) return false;
  if (/\d/.test(display)) return false;
  const normalized = normalizeMasterName(display);
  if (!normalized) return false;
  if (CLIENT_NOISE.has(normalized)) return false;
  const words = normalized.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 8) return false;
  if (words.some((word) => word.length < 2)) return false;
  return true;
}

function looksLikePolicyNumber(value: string) {
  const normalized = normalizePolicyNumber(value);
  return Boolean(normalized && normalized.length >= 4 && normalized.length <= 30 && /\d/.test(normalized));
}

function looksLikeReceiptNumber(value: string) {
  const normalized = normalizeReceiptNumber(value);
  return Boolean(normalized && normalized.length >= 4 && normalized.length <= 30 && /\d/.test(normalized));
}

function simplifyInsurerKey(value: string) {
  return normalizeMasterName(value)
    .replace(/\b(SEGUROS?|COMPANIA|COMPAÑIA|DE|MEXICO|MEXICANA|S\.A\.|S\.A|C\.V\.|C V)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreField(fieldName: string, value: string, sources: string[], canonicalLookup?: Map<string, string>) {
  const normalized = normalizeDisplay(value);
  if (!normalized) {
    return { normalizedValue: "", verifiedValue: "", score: 0, status: "reject" as FieldStatus, reason: "vacío" };
  }

  const valid =
    fieldName === "clientName" || fieldName === "referidorName"
      ? looksLikeClientName(normalized)
      : fieldName === "policyNumber"
        ? looksLikePolicyNumber(normalized)
        : fieldName === "receiptNumber"
          ? looksLikeReceiptNumber(normalized)
          : normalized.length >= 2;

  if (!valid) {
    return {
      normalizedValue: normalized,
      verifiedValue: "",
      score: 0,
      status: "reject" as FieldStatus,
      reason: "no pasa validación estructural",
    };
  }

  let score = 0;
  for (const source of sources) {
    switch (source) {
      case "db":
        score += 100;
        break;
      case "saps":
        score += 90;
        break;
      case "master":
        score += 80;
        break;
      case "revisar":
        score += 75;
        break;
      default:
        score += 0;
    }
  }

  if (new Set(sources).size > 1) {
    score += 15;
  }

  let verifiedValue = normalized;
  const canonical = canonicalLookup?.get(normalizeMasterName(normalized));
  if (canonical) {
    verifiedValue = canonical;
    score += 10;
  }

  if (score >= 90) {
    return {
      normalizedValue: normalized,
      verifiedValue,
      score: Math.min(score, 100),
      status: "auto" as FieldStatus,
      reason: canonical ? "canonicalizado" : "consenso fuerte",
    };
  }

  if (score >= 70) {
    return {
      normalizedValue: normalized,
      verifiedValue,
      score: Math.min(score, 100),
      status: "review" as FieldStatus,
      reason: canonical ? "canonicalizado en revisión" : "revisar antes de promover",
    };
  }

  return {
    normalizedValue: normalized,
    verifiedValue: "",
    score: Math.min(score, 100),
    status: "reject" as FieldStatus,
    reason: "score insuficiente",
  };
}

function buildFieldRows(sheetName: string, rows: CrossRow[], canonicalLookups: { clients: Map<string, string>; insurers: Map<string, string> }) {
  const output: CleanRow[] = [];

  for (const row of rows) {
    const entityType = String(row["Entidad"] ?? row["entityType"] ?? "");
    const key = String(row["Clave"] ?? row["key"] ?? "");
    const rawName = String(row["Nombre"] ?? row["Póliza"] ?? row["Cliente"] ?? "");
    const sources = String(row["Fuentes detalle"] ?? row["sourceList"] ?? "").split("|").map((value) => value.trim()).filter(Boolean);
    const referidor = String(row["Referidor"] ?? row["referidorNames"] ?? "");
    const clients = String(row["Clientes"] ?? row["clientNames"] ?? "");
    const insurers = String(row["Aseguradoras"] ?? row["insurerNames"] ?? "");
    const receipts = String(row["Recibos"] ?? row["receiptNumbers"] ?? "");

    const policyDecision = scoreField("policyNumber", key, sources);
    output.push({
      sourceSheet: sheetName,
      entityType,
      entityKey: key,
      fieldName: "policyNumber",
      rawValues: key,
      normalizedValue: policyDecision.normalizedValue,
      verifiedValue: policyDecision.verifiedValue,
      score: policyDecision.score,
      status: policyDecision.status,
      sources: sources.join(" | "),
      reason: policyDecision.reason,
    });

    const clientDecision = scoreField("clientName", rawName || clients, sources, canonicalLookups.clients);
    output.push({
      sourceSheet: sheetName,
      entityType,
      entityKey: key,
      fieldName: "clientName",
      rawValues: [rawName, clients].filter(Boolean).join(" | "),
      normalizedValue: clientDecision.normalizedValue,
      verifiedValue: clientDecision.verifiedValue,
      score: clientDecision.score,
      status: clientDecision.status,
      sources: sources.join(" | "),
      reason: clientDecision.reason,
    });

    const insurerDecision = scoreField("insurerName", insurers, sources, canonicalLookups.insurers);
    output.push({
      sourceSheet: sheetName,
      entityType,
      entityKey: key,
      fieldName: "insurerName",
      rawValues: insurers,
      normalizedValue: insurerDecision.normalizedValue,
      verifiedValue: insurerDecision.verifiedValue,
      score: insurerDecision.score,
      status: insurerDecision.status,
      sources: sources.join(" | "),
      reason: insurerDecision.reason,
    });

    const receiptDecision = scoreField("receiptNumber", receipts, sources);
    output.push({
      sourceSheet: sheetName,
      entityType,
      entityKey: key,
      fieldName: "receiptNumber",
      rawValues: receipts,
      normalizedValue: receiptDecision.normalizedValue,
      verifiedValue: receiptDecision.verifiedValue,
      score: receiptDecision.score,
      status: receiptDecision.status,
      sources: sources.join(" | "),
      reason: receiptDecision.reason,
    });

    const referidorDecision = scoreField("referidorName", referidor, sources, canonicalLookups.clients);
    output.push({
      sourceSheet: sheetName,
      entityType,
      entityKey: key,
      fieldName: "referidorName",
      rawValues: referidor,
      normalizedValue: referidorDecision.normalizedValue,
      verifiedValue: referidorDecision.verifiedValue,
      score: referidorDecision.score,
      status: referidorDecision.status,
      sources: sources.join(" | "),
      reason: referidorDecision.reason,
    });
  }

  return output;
}

function buildCanonicalLookups(dbClients: CrossRow[], dbInsurers: CrossRow[]) {
  const clients = new Map<string, string>();
  const insurers = new Map<string, string>();

  for (const row of dbClients) {
    const name = String(row["clientName"] ?? row["Cliente"] ?? row["Nombre"] ?? "");
    if (name) clients.set(normalizeMasterName(name), name);
  }

  for (const row of dbInsurers) {
    const name = String(row["insurerName"] ?? row["Aseguradora"] ?? row["Nombre"] ?? "");
    if (!name) continue;
    insurers.set(normalizeMasterName(name), name);
    const simplified = simplifyInsurerKey(name);
    if (simplified) insurers.set(simplified, name);
  }

  return { clients, insurers };
}

function latestSourceWorkbookPath(source: string | undefined) {
  if (source) return path.resolve(source);
  return path.resolve(DEFAULT_SOURCE_WORKBOOK);
}

async function main() {
  const args = parseCliArgs();
  const sourcePath = latestSourceWorkbookPath(getFlag(args, "source"));
  const outPath = getFlag(args, "out") ?? path.join(exportsDir, `four-source-field-cleaning-${timestampForFile()}.xlsx`);
  await ensureDataDirs();

  const workbook = XLSX.readFile(sourcePath, { cellDates: true });

  const sheetRows = (name: string) => XLSX.utils.sheet_to_json<CrossRow>(workbook.Sheets[name] ?? {}, { defval: "" });
  const policyRows = sheetRows("Cruce Poliza");
  const clientRows = sheetRows("Cruce Cliente");
  const receiptRows = sheetRows("Cruce Recibo");
  const dbRows = sheetRows("DB crudo");
  const canonicalLookups = buildCanonicalLookups(dbRows, dbRows);

  const cleanedRows = [
    ...buildFieldRows("Cruce Poliza", policyRows, canonicalLookups),
    ...buildFieldRows("Cruce Cliente", clientRows, canonicalLookups),
    ...buildFieldRows("Cruce Recibo", receiptRows, canonicalLookups),
  ];

  const summaryRows = [
    { grupo: "fuente", métrica: "Workbook origen", valor: sourcePath, detalle: "" },
    { grupo: "resumen", métrica: "Campos auto", valor: cleanedRows.filter((row) => row.status === "auto").length, detalle: "" },
    { grupo: "resumen", métrica: "Campos revisar", valor: cleanedRows.filter((row) => row.status === "review").length, detalle: "" },
    { grupo: "resumen", métrica: "Campos rechazar", valor: cleanedRows.filter((row) => row.status === "reject").length, detalle: "" },
  ];

  const cleanSheetRows = cleanedRows.filter((row) => row.status !== "reject");
  const suspiciousRows = cleanedRows.filter((row) => row.status !== "auto");

  const rulesRows = [
    { regla: "Cliente", descripcion: "Solo nombres reales sin ruido, números ni etiquetas técnicas.", umbral: ">= 90 auto / >= 70 revisar" },
    { regla: "Poliza", descripcion: "Debe parecer numero de poliza y contener digitos.", umbral: ">= 90 auto / >= 70 revisar" },
    { regla: "Recibo", descripcion: "Debe parecer numero de recibo o referencia cobrable.", umbral: ">= 90 auto / >= 70 revisar" },
    { regla: "Aseguradora", descripcion: "Se canoniza contra el catálogo de aseguradoras.", umbral: ">= 90 auto / >= 70 revisar" },
    { regla: "Referidor", descripcion: "No debe reemplazar al cliente real; solo complementarlo.", umbral: ">= 90 auto / >= 70 revisar" },
  ];

  const xlsxWorkbook = XLSX.utils.book_new();

  const addSheet = (name: string, rows: Record<string, unknown>[]) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(xlsxWorkbook, ws, name.slice(0, 31));
  };

  addSheet("Resumen", summaryRows);
  addSheet("Campos limpios", cleanSheetRows);
  addSheet("Campos sospechosos", suspiciousRows);
  addSheet("Reglas limpieza", rulesRows);

  // Keep the original consensus sheets for reference in the same workbook.
  for (const name of ["Cruce Poliza", "Cruce Cliente", "Cruce Recibo", "Referidor"]) {
    const sourceSheet = workbook.Sheets[name];
    if (!sourceSheet) continue;
    XLSX.utils.book_append_sheet(xlsxWorkbook, sourceSheet, name.slice(0, 31));
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  XLSX.writeFile(xlsxWorkbook, outPath, { bookType: "xlsx" });

  console.log("Limpieza de campos completada");
  console.log(`Workbook origen: ${sourcePath}`);
  console.log(`Workbook limpio: ${outPath}`);
  console.log(`Campos auto: ${cleanedRows.filter((row) => row.status === "auto").length}`);
  console.log(`Campos revisar: ${cleanedRows.filter((row) => row.status === "review").length}`);
  console.log(`Campos rechazar: ${cleanedRows.filter((row) => row.status === "reject").length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
