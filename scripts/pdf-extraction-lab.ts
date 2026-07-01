import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { reconstructPdfTextFromTextContent } from "@/lib/pdf-text-reconstruction";
import { extractPolicyPdfDraftFromText, type PolicyPdfCaptureDraft } from "@/lib/policy-pdf-capture.shared";

type LabArgs = {
  pdfPath: string | null;
  baselinePath: string | null;
  baselineDir: string;
  label: string | null;
  writeBaseline: boolean;
  showText: boolean;
  json: boolean;
  help: boolean;
};

type LabObservedFields = PolicyPdfCaptureDraft & {
  clientType: "PERSON" | "COMPANY";
  clientRfc: string | null;
  clientAddress: string | null;
};

type BaselineRecord = {
  version: 1;
  familyKey: string;
  sourcePdf: string;
  createdAt: string;
  observed: LabObservedFields;
  draft: PolicyPdfCaptureDraft;
};

type DiffRow = {
  field: keyof LabObservedFields;
  expected: unknown;
  actual: unknown;
};

const DEFAULT_BASELINE_DIR = path.join(os.homedir(), ".codex", "policy-pdf-lab", "baselines");
const COMPARE_FIELDS: Array<keyof LabObservedFields> = [
  "policyNumber",
  "clientName",
  "clientType",
  "clientRfc",
  "clientAddress",
  "insurerName",
  "policyType",
  "serialNumber",
  "startDate",
  "endDate",
  "issueDate",
  "paymentFrequency",
  "paymentPlan",
  "premiumAmount",
  "sourcePolicyNumber",
];

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeKey(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function parseArgs(argv = process.argv.slice(2)): LabArgs {
  const result: LabArgs = {
    pdfPath: null,
    baselinePath: null,
    baselineDir: DEFAULT_BASELINE_DIR,
    label: null,
    writeBaseline: false,
    showText: false,
    json: false,
    help: false,
  };

  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }

    const [flag, inlineValue] = token.replace(/^--?/, "").split("=");
    const value = inlineValue ?? argv[index + 1];
    const nextIsValue = value !== undefined && !String(value).startsWith("-");

    switch (flag) {
      case "pdf":
        result.pdfPath = nextIsValue ? String(value) : result.pdfPath;
        if (nextIsValue && inlineValue === undefined) index += 1;
        break;
      case "baseline":
        result.baselinePath = nextIsValue ? String(value) : result.baselinePath;
        if (nextIsValue && inlineValue === undefined) index += 1;
        break;
      case "baseline-dir":
        result.baselineDir = nextIsValue ? String(value) : result.baselineDir;
        if (nextIsValue && inlineValue === undefined) index += 1;
        break;
      case "label":
        result.label = nextIsValue ? String(value) : result.label;
        if (nextIsValue && inlineValue === undefined) index += 1;
        break;
      case "write-baseline":
      case "update-baseline":
        result.writeBaseline = true;
        break;
      case "show-text":
      case "text":
        result.showText = true;
        break;
      case "json":
        result.json = true;
        break;
      case "help":
      case "h":
        result.help = true;
        break;
      default:
        break;
    }
  }

  if (!result.pdfPath && positionals[0]) {
    result.pdfPath = positionals[0];
  }
  if (!result.baselinePath && positionals[1]) {
    result.baselinePath = positionals[1];
  }

  return result;
}

function printHelp() {
  console.log([
    "PDF Extraction Lab",
    "",
    "Uso:",
    "  npm run pdf:lab -- --pdf /ruta/al/archivo.pdf",
    "  npm run pdf:lab -- /ruta/al/archivo.pdf",
    "",
    "Opciones:",
    "  --baseline <ruta>        Compara contra este JSON local.",
    "  --baseline-dir <ruta>    Carpeta raiz para baselines automaticos.",
    "  --label <nombre>         Sobrescribe el nombre del baseline local.",
    "  --write-baseline         Guarda el resultado observado en el baseline.",
    "  --show-text              Imprime el texto reconstruido.",
    "  --json                   Imprime el reporte final como JSON.",
  ].join("\n"));
}

async function extractPdfTextFromFile(pdfPath: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await fs.readFile(pdfPath));
  const standardFontDataUrl = pathToFileURL(path.join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts")).href + "/";

  const loadingTask = pdfjs.getDocument({
    data,
    standardFontDataUrl,
  });

  const pdf = await loadingTask.promise;
  try {
    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = reconstructPdfTextFromTextContent(textContent);
      if (pageText.trim()) {
        pageTexts.push(pageText);
      }
    }

    return {
      text: pageTexts.join("\n"),
      pageCount: pdf.numPages,
    };
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

function extractInsuredSection(text: string) {
  const lines = text.split(/\r?\n/).map((line) => compact(line)).filter(Boolean);
  const startIndex = lines.findIndex((line) => normalizeKey(line).includes(normalizeKey("Información del asegurado")));
  if (startIndex < 0) return null;

  const endIndexCandidates = [
    lines.findIndex((line, index) => index > startIndex && normalizeKey(line).includes(normalizeKey("Descripción del vehículo asegurado"))),
    lines.findIndex((line, index) => index > startIndex && normalizeKey(line).includes(normalizeKey("Información importante"))),
    lines.findIndex((line, index) => index > startIndex && normalizeKey(line).includes(normalizeKey("Oficina de atención de servicio"))),
  ].filter((index) => index > startIndex);

  const endIndex = endIndexCandidates.length > 0 ? Math.min(...endIndexCandidates) : lines.length;
  return lines.slice(startIndex, endIndex).join("\n");
}

function extractClientRfc(text: string) {
  const source = extractInsuredSection(text) || text;
  const lines = source.split(/\r?\n/).map((line) => compact(line)).filter(Boolean);

  for (const line of lines) {
    const normalizedLine = line.replace(/[^A-Z0-9&Ñ]+/gi, "").toUpperCase();
    const candidate = normalizedLine.match(/[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}/)?.[0];
    if (!candidate) continue;
    if (/(r\.?\s*f\.?\s*c\.?|registro federal de contribuyentes|rfc)/i.test(line) || candidate.length >= 12) {
      return candidate.toUpperCase();
    }
  }

  const stripped = source.replace(/[^A-Z0-9&Ñ]+/gi, "").toUpperCase();
  const fallback = stripped.match(/[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}/)?.[0];
  return fallback?.toUpperCase() ?? null;
}

function extractClientAddress(text: string) {
  const source = extractInsuredSection(text) || text;
  const lines = source.split(/\r?\n/).map((line) => compact(line)).filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/(domicilio|direcci[oó]n|direccion)/i.test(line)) continue;

    const start = line.replace(/^.*?(?:domicilio|direcci[oó]n|direccion)\s*[:\-]?\s*/i, "");
    const lineCandidate = start
      .replace(/\bR\.?\s*F\.?\s*C\.?\s*[:\-]?.*$/i, "")
      .replace(/\bC\.?\s*P\.?\s*[:\-]?.*$/i, "")
      .replace(/\bMunicipio.*$/i, "")
      .replace(/\bEstado.*$/i, "")
      .replace(/\bColonia.*$/i, "")
      .trim();
    if (lineCandidate) return lineCandidate;

    const nextParts: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextLine = lines[cursor];
      if (/(r\.?\s*f\.?\s*c\.?|c\.?\s*p\.?|municipio|estado|colonia|telefono|tel[eé]fono|informaci[oó]n importante|descripci[oó]n del veh[ií]culo asegurado)/i.test(nextLine)) {
        break;
      }
      nextParts.push(nextLine);
    }
    const candidate = compact(nextParts.join(" "));
    if (candidate) return candidate;
  }

  const fallback = source.match(
    /(?:domicilio|direccion|dirección)\s*[:\-]?\s*([\s\S]*?)(?=\b(?:r\.?\s*f\.?\s*c\.?|c\.?p\.?|municipio|estado|colonia|telefono|tel[eé]fono|informaci[oó]n importante|oficina de atenci[oó]n de servicio)\b|$)/i,
  );
  const candidate = compact(fallback?.[1] ?? "");
  return candidate || null;
}

function monthNameToNumber(token: string) {
  const normalized = normalizeKey(token);
  const months: Record<string, string> = {
    enero: "01",
    ene: "01",
    january: "01",
    jan: "01",
    febrero: "02",
    feb: "02",
    march: "03",
    mar: "03",
    abril: "04",
    abr: "04",
    april: "04",
    may: "05",
    mayo: "05",
    junio: "06",
    jun: "06",
    july: "07",
    jul: "07",
    agosto: "08",
    ago: "08",
    september: "09",
    sep: "09",
    sept: "09",
    octubre: "10",
    oct: "10",
    november: "11",
    nov: "11",
    diciembre: "12",
    dic: "12",
  };
  return months[normalized] ?? null;
}

function extractIssueDate(text: string) {
  const source = extractInsuredSection(text) || text;
  const explicit =
    source.match(/(?:fecha de emisi[oó]n|emisi[oó]n|expedici[oó]n)\s*[:\-]?\s*(\d{2}[/-]\d{2}[/-]\d{4})/i) ??
    text.match(/(?:fecha de emisi[oó]n|emisi[oó]n|expedici[oó]n)\s*[:\-]?\s*(\d{2}[/-]\d{2}[/-]\d{4})/i);
  if (explicit?.[1]) {
    const [day, month, year] = explicit[1].split(/[/-]/);
    return `${year}-${month}-${day}`;
  }

  const longForm =
    source.match(/\b(?:a\s+)?(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,15})\s+de\s+(\d{4})\b/i) ??
    text.match(/\b(?:a\s+)?(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,15})\s+de\s+(\d{4})\b/i);
  if (longForm) {
    const [, day, monthToken, year] = longForm;
    const month = monthNameToNumber(monthToken);
    if (month) return `${year}-${month}-${day.padStart(2, "0")}`;
  }

  return null;
}

function parseMoney(value: string | null | undefined) {
  if (!value) return null;

  const raw = compact(value).replace(/[^\d,.-]/g, "");
  if (!raw) return null;

  let normalized = raw;
  const commaIndex = normalized.lastIndexOf(",");
  const dotIndex = normalized.lastIndexOf(".");

  if (commaIndex >= 0 && dotIndex >= 0) {
    if (commaIndex > dotIndex) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (commaIndex >= 0) {
    const decimalCandidate = normalized.slice(commaIndex + 1);
    if (/^\d{1,2}$/.test(decimalCandidate)) {
      normalized = normalized.replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  }

  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function extractMoneyValues(value: string | null | undefined) {
  if (!value) return [] as number[];
  return Array.from(value.matchAll(/\$?\s*[\d.,]+(?:\.\d{2})?/g))
    .map((match) => parseMoney(match[0]))
    .filter((amount): amount is number => amount !== null);
}

function extractExactLabelLine(lines: string[], labels: string[]) {
  for (const line of lines) {
    const normalizedLine = normalizeKey(line);
    for (const label of labels) {
      const normalizedLabel = normalizeKey(label);
      const pattern = new RegExp(`(^|[^a-z0-9])${normalizedLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
      if (pattern.test(normalizedLine)) {
        return line;
      }
    }
  }
  return null;
}

function extractPremiumAmount(text: string) {
  const lines = text.split(/\r?\n/).map((line) => compact(line)).filter(Boolean);
  const labels = ["IMPORTE TOTAL", "Prima total", "Prima anual total", "Prima anual", "Prima neta"];

  for (const label of labels) {
    const exactLine = extractExactLabelLine(lines, [label]);
    if (!exactLine) continue;
    const inline = exactLine.match(/\b(?:\$|MXN\s*)?([\d]{1,3}(?:,[\d]{3})*(?:\.[\d]{2})|[\d]+(?:\.[\d]{2})?)\b/i);
    if (inline?.[1]) {
      const parsed = parseMoney(inline[1]);
      if (parsed !== null) return parsed;
    }
    const labelIndex = lines.findIndex((line) => extractExactLabelLine([line], [label]));
    if (labelIndex >= 0) {
      const nearby = lines.slice(labelIndex, labelIndex + 4).join(" ");
      const values = extractMoneyValues(nearby).filter((value) => value > 100);
      if (values.length > 0) return values[0];
    }
  }

  const fallback = Array.from(text.matchAll(/IMPORTE TOTAL\s*[:\-]?\s*\$?\s*([\d.,]+)/gi))
    .map((match) => parseMoney(match[1]))
    .filter((amount): amount is number => amount !== null && amount > 0);
  if (fallback.length > 0) return fallback[0];

  return null;
}

function extractSourcePolicyNumber(text: string) {
  const lines = text.split(/\r?\n/).map((line) => compact(line)).filter(Boolean);
  const exactLine = extractExactLabelLine(lines, ["RENUEVA A", "RENUEVA", "Póliza origen", "Poliza origen", "Origen"]);
  if (exactLine) {
    const match = exactLine.match(
      /(?:RENUEVA A|RENUEVA|P[ÓO]LIZA ORIGEN|POLIZA ORIGEN|ORIGEN)\s*[:\-]?\s*([A-Z0-9-]{6,})/i,
    );
    if (match?.[1]) return compact(match[1]).replace(/\s+/g, "");
  }

  const fallback = text.match(
    /(?:RENUEVA A|RENUEVA|P[ÓO]LIZA ORIGEN|POLIZA ORIGEN)\s*[:\-]?\s*([A-Z0-9-]{6,})/i,
  );
  return fallback?.[1] ? compact(fallback[1]).replace(/\s+/g, "") : null;
}

function inferClientType(clientName: string, clientRfc: string | null) {
  if (!clientRfc) return "PERSON";

  const normalized = normalizeKey(clientName);
  const companySignals = [
    "sa decv",
    "sadecv",
    "sapi",
    "sociedad",
    "ac",
    "sca",
    "escuela",
    "colegio",
    "universidad",
    "instituto",
    "hospital",
    "clinica",
    "fundacion",
    "gobierno",
    "municipio",
    "secretaria",
  ].map(normalizeKey);

  return companySignals.some((signal) => normalized.includes(signal)) ? "COMPANY" : "PERSON";
}

function buildObservedFields(draft: PolicyPdfCaptureDraft, reconstructedText: string): LabObservedFields {
  const clientRfc = extractClientRfc(reconstructedText);
  const clientAddress = extractClientAddress(reconstructedText);
  const issueDate = extractIssueDate(reconstructedText) ?? draft.issueDate;
  const premiumAmount = extractPremiumAmount(reconstructedText) ?? draft.premiumAmount;
  const sourcePolicyNumber = extractSourcePolicyNumber(reconstructedText) ?? draft.sourcePolicyNumber;

  return {
    ...draft,
    issueDate,
    premiumAmount,
    clientType: inferClientType(draft.clientName, clientRfc),
    clientRfc,
    clientAddress,
    sourcePolicyNumber,
  };
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "<vacío>";
  if (typeof value === "number") {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
  return compact(String(value));
}

function compareObserved(actual: LabObservedFields, expected: Partial<LabObservedFields> | null | undefined) {
  if (!expected) return [] as DiffRow[];

  const diffs: DiffRow[] = [];
  for (const field of COMPARE_FIELDS) {
    const actualValue = actual[field];
    const expectedValue = expected[field];
    const expectedHasValue = Object.prototype.hasOwnProperty.call(expected, field);

    if (!expectedHasValue) {
      diffs.push({ field, expected: "<no definido>", actual: actualValue });
      continue;
    }

    if (field === "premiumAmount") {
      const left = typeof actualValue === "number" ? actualValue : Number(actualValue);
      const right = typeof expectedValue === "number" ? expectedValue : Number(expectedValue);
      if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left - right) > 0.01) {
        diffs.push({ field, expected: expectedValue, actual: actualValue });
      }
      continue;
    }

    if (formatValue(actualValue) !== formatValue(expectedValue)) {
      diffs.push({ field, expected: expectedValue, actual: actualValue });
    }
  }

  return diffs;
}

async function resolveBaselinePath(args: LabArgs, pdfPath: string, observed: LabObservedFields) {
  if (args.baselinePath) {
    return path.resolve(args.baselinePath);
  }

  const familyKey = [normalizeKey(observed.insurerName || "unknown"), normalizeKey(observed.policyType || "unknown")]
    .filter(Boolean)
    .join("__");
  const sampleLabel = normalizeKey(args.label || path.parse(pdfPath).name || observed.policyNumber || "sample");
  return path.join(path.resolve(args.baselineDir), familyKey || "unknown", `${sampleLabel}.json`);
}

async function readJsonFile(filePath: string) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as unknown;
}

function unwrapBaselineDraft(raw: unknown): { draft: Partial<LabObservedFields> } {
  if (!raw || typeof raw !== "object") {
    return { draft: {} };
  }

  const candidate = raw as {
    observed?: unknown;
    draft?: unknown;
  };

  if (candidate.observed && typeof candidate.observed === "object") {
    return { draft: candidate.observed as Partial<LabObservedFields> };
  }

  if (candidate.draft && typeof candidate.draft === "object") {
    return { draft: candidate.draft as Partial<LabObservedFields> };
  }

  return { draft: raw as Partial<LabObservedFields> };
}

async function writeBaseline(filePath: string, payload: BaselineRecord) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function printObserved(observed: LabObservedFields) {
  const rows = [
    ["Póliza", observed.policyNumber],
    ["Cliente", observed.clientName],
    ["Tipo cliente", observed.clientType],
    ["RFC", observed.clientRfc],
    ["Dirección", observed.clientAddress],
    ["Aseguradora", observed.insurerName],
    ["Tipo póliza", observed.policyType],
    ["Serie", observed.serialNumber],
    ["Vigencia inicio", observed.startDate],
    ["Vigencia fin", observed.endDate],
    ["Emisión", observed.issueDate],
    ["Frecuencia", observed.paymentFrequency],
    ["Plan", observed.paymentPlan],
    ["Prima", observed.premiumAmount],
    ["Moneda", observed.currency],
    ["Solicitud", observed.requestNumber],
    ["Póliza origen", observed.sourcePolicyNumber],
  ];

  for (const [label, value] of rows) {
    console.log(`${label}: ${formatValue(value)}`);
  }
}

function printDiffs(diffs: DiffRow[]) {
  for (const diff of diffs) {
    console.log(`- ${String(diff.field)}:`);
    console.log(`  esperado: ${formatValue(diff.expected)}`);
    console.log(`  actual:   ${formatValue(diff.actual)}`);
  }
}

async function main() {
  const args = parseArgs();

  if (args.help || !args.pdfPath) {
    printHelp();
    process.exit(args.pdfPath ? 0 : 1);
  }

  const pdfPath = path.resolve(args.pdfPath);
  const pdfName = path.basename(pdfPath);
  const { text, pageCount } = await extractPdfTextFromFile(pdfPath);
  const draft = extractPolicyPdfDraftFromText(text);
  const observed = buildObservedFields(draft, text);
  const baselinePath = await resolveBaselinePath(args, pdfPath, observed);

  const report = {
    pdfPath,
    pdfName,
    pageCount,
    textLength: text.length,
    baselinePath,
    draft,
    observed,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("PDF Extraction Lab");
    console.log(`Archivo: ${pdfName}`);
    console.log(`Paginas: ${pageCount}`);
    console.log(`Texto reconstruido: ${text.length} caracteres`);
    console.log(`Baseline: ${baselinePath}`);
    console.log("");
    console.log("Observed");
    printObserved(observed);
    console.log("");
    console.log("Draft del parser");
    console.log(JSON.stringify(draft, null, 2));
  }

  if (args.showText) {
    console.log("");
    console.log("Texto reconstruido");
    console.log(text);
  }

  let baseline: Partial<LabObservedFields> | null = null;
  try {
    const rawBaseline = await readJsonFile(baselinePath);
    baseline = unwrapBaselineDraft(rawBaseline).draft;
  } catch {
    if (!args.writeBaseline) {
      baseline = null;
    }
  }

  if (args.writeBaseline) {
    const payload: BaselineRecord = {
      version: 1,
      familyKey: path.basename(path.dirname(baselinePath)),
      sourcePdf: pdfName,
      createdAt: new Date().toISOString(),
      observed,
      draft,
    };

    await writeBaseline(baselinePath, payload);

    console.log("");
    console.log(`Baseline guardado en: ${baselinePath}`);
    return;
  }

  if (!baseline) {
    console.log("");
    console.log("No existe baseline local para comparar.");
    console.log("Ejecuta de nuevo con --write-baseline para crearlo.");
    return;
  }

  const diffs = compareObserved(observed, baseline);
  console.log("");
  if (diffs.length === 0) {
    console.log("Baseline OK. No hay diferencias.");
    return;
  }

  console.log(`Encontramos ${diffs.length} diferencias:`);
  printDiffs(diffs);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("Error en el laboratorio de PDF.");
  console.error(error);
  process.exit(1);
});
