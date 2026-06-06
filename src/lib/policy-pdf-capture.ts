import "server-only";

import { getDb } from "@/lib/db";
import { parseDateInput } from "@/lib/form-utils";
import { normalize } from "@/lib/search-utils";
import type {
  PolicyCaptureSourceOption,
  PolicyPdfCaptureDraft,
  PolicyPdfCapturePreview,
} from "@/lib/policy-pdf-capture.shared";

const PAYMENT_FREQUENCY_CODES = new Set(["MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL", "SINGLE", "OTHER"]);
const POLICY_TYPES = new Set(["AUTO", "GMM", "VIDA", "DANOS", "FIANZAS", "HOGAR", "RESPONSABILIDAD_CIVIL", "EMPRESARIAL", "ACCIDENTES", "OTRO"]);

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replaceAll("á", "a")
    .replaceAll("é", "e")
    .replaceAll("í", "i")
    .replaceAll("ó", "o")
    .replaceAll("ú", "u")
    .replaceAll("ñ", "n")
    .replaceAll("ü", "u");
}

function monthTokenToNumber(token: string) {
  const normalized = token.toLowerCase();
  const map: Record<string, string> = {
    ene: "01",
    enero: "01",
    jan: "01",
    january: "01",
    feb: "02",
    febrero: "02",
    february: "02",
    mar: "03",
    marzo: "03",
    march: "03",
    abr: "04",
    abril: "04",
    apr: "04",
    april: "04",
    may: "05",
    mayo: "05",
    jun: "06",
    junio: "06",
    june: "06",
    jul: "07",
    julio: "07",
    july: "07",
    ago: "08",
    agosto: "08",
    aug: "08",
    august: "08",
    sep: "09",
    sept: "09",
    septiembre: "09",
    september: "09",
    oct: "10",
    octubre: "10",
    october: "10",
    nov: "11",
    noviembre: "11",
    november: "11",
    dic: "12",
    diciembre: "12",
    december: "12",
  };

  return map[normalized] ?? null;
}

function normalizeDateString(value: string | null | undefined) {
  if (!value) return null;

  const cleaned = compact(value);
  const ddmmyyyy = cleaned.match(/\b(\d{2})[/-](\d{2})[/-](\d{4})\b/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return `${year}-${month}-${day}`;
  }

  const yyyymmdd = cleaned.match(/\b(\d{4})[/-](\d{2})[/-](\d{2})\b/);
  if (yyyymmdd) {
    const [, year, month, day] = yyyymmdd;
    return `${year}-${month}-${day}`;
  }

  const ddMonthYyyy = cleaned.match(/\b(\d{2})[/-]([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,9})[/-](\d{4})\b/);
  if (ddMonthYyyy) {
    const [, day, monthToken, year] = ddMonthYyyy;
    const month = monthTokenToNumber(monthToken);
    if (month) return `${year}-${month}-${day}`;
  }

  return null;
}

function extractDatesFromLine(line: string | null | undefined) {
  if (!line) return [] as string[];
  return [
    ...line.matchAll(/\b(\d{2}[/-]\d{2}[/-]\d{4})\b/g),
    ...line.matchAll(/\b(\d{2}[/-][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,9}[/-]\d{4})\b/g),
    ...line.matchAll(/\b(\d{4}[/-]\d{2}[/-]\d{2})\b/g),
  ]
    .map((match) => normalizeDateString(match[1]))
    .filter(Boolean) as string[];
}

function extractDateFromMatchingLine(lines: string[], labels: string[], position: "first" | "last") {
  for (const line of lines) {
    const normalizedLine = normalizeText(line);
    if (!labels.some((label) => normalizedLine.includes(normalizeText(label)))) continue;
    const dates = extractDatesFromLine(line);
    if (!dates.length) continue;
    return position === "last" ? dates[dates.length - 1] : dates[0];
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

function extractInlineValue(lines: string[], labels: string[]) {
  for (const line of lines) {
    const normalizedLine = normalize(line);
    for (const label of labels) {
      const normalizedLabel = normalize(label);
      const index = normalizedLine.indexOf(normalizedLabel);
      if (index < 0) continue;

      const rawSlice = line.slice(index + label.length).replace(/^[:\-\s]+/, "").trim();
      if (rawSlice) return rawSlice;
    }
  }
  return null;
}

function extractLineContaining(lines: string[], labels: string[]) {
  for (const line of lines) {
    const normalizedLine = normalize(line);
    if (labels.some((label) => normalizedLine.includes(normalize(label)))) {
      return line;
    }
  }
  return null;
}

function normalizePaymentFrequency(value: string | null | undefined) {
  if (!value) return "ANNUAL";
  const normalized = normalize(value);
  if (normalized.includes("mensual")) return "MONTHLY";
  if (normalized.includes("trimestral")) return "QUARTERLY";
  if (normalized.includes("semestral")) return "SEMIANNUAL";
  if (normalized.includes("anual")) return "ANNUAL";
  if (normalized.includes("unica") || normalized.includes("única") || normalized.includes("single")) return "SINGLE";
  return PAYMENT_FREQUENCY_CODES.has(value.toUpperCase()) ? value.toUpperCase() : "OTHER";
}

function normalizePolicyType(value: string | null | undefined) {
  if (!value) return "GMM";
  const normalized = normalize(value);
  if (normalized.includes("gmm")) return "GMM";
  if (normalized.includes("auto")) return "AUTO";
  if (normalized.includes("vida")) return "VIDA";
  if (normalized.includes("danos") || normalized.includes("daños")) return "DANOS";
  if (normalized.includes("fianza")) return "FIANZAS";
  if (normalized.includes("hogar")) return "HOGAR";
  if (normalized.includes("responsabilidad")) return "RESPONSABILIDAD_CIVIL";
  if (normalized.includes("empresarial")) return "EMPRESARIAL";
  if (normalized.includes("accidente")) return "ACCIDENTES";
  return POLICY_TYPES.has(value.toUpperCase()) ? value.toUpperCase() : "OTRO";
}

function parsePolicyNumber(lines: string[], text: string) {
  const labeledLine = lines.find((line) => normalizeText(line).includes("poliza"));
  if (labeledLine) {
    const labeledMatch = labeledLine.match(/\b(\d{5}U\d{2}|\d{8,10}|[A-Z0-9]{8,})\b/);
    if (labeledMatch?.[1]) return labeledMatch[1];
  }

  for (const line of lines.slice(0, 20)) {
    if (/tel[eé]fono|rfc/i.test(line)) continue;
    const match = line.match(/\b\d{10}\b/);
    if (match?.[0]) return match[0];
  }

  return (
    text.match(/\b\d{5}U\d{2}\b/)?.[0] ??
    text.match(/\b\d{5,}[A-Z]?\d{2}\b/)?.[0] ??
    ""
  );
}

function parseInsuredName(lines: string[]) {
  const uppercaseCandidate = lines.find((line) =>
    /^[A-ZÁÉÍÓÚÜÑ ,.'-]{8,}$/.test(line) &&
    !/qu[aá]litas|seguros|asegurad[oa]|p[oó]liza|vigencia|condiciones|informaci[oó]n/i.test(line),
  );
  if (uppercaseCandidate) {
    return compact(uppercaseCandidate);
  }

  const labels = ["Asegurado titular", "Asegurado", "Titular", "Nombre del asegurado"];
  const labeled = extractInlineValue(lines, labels);
  if (labeled) {
    const normalized = normalize(labeled);
    if (!["titular", "asegurado", "principal"].includes(normalized)) {
      return compact(labeled);
    }
  }

  const labelIndex = lines.findIndex((line) => labels.some((label) => normalize(line).includes(normalize(label))));
  if (labelIndex >= 0) {
    const nextLine = lines[labelIndex + 1];
    if (nextLine && !labels.some((label) => normalize(nextLine).includes(normalize(label)))) {
      return compact(nextLine);
    }
  }

  const insuredHeadingIndex = lines.findIndex((line) => normalize(line).includes("informacion del asegurado"));
  if (insuredHeadingIndex >= 0) {
    const nextLine = lines[insuredHeadingIndex + 1];
    if (nextLine && !/vigencia|descripcion|informacion|p[oó]liza/i.test(nextLine)) {
      return compact(nextLine);
    }
  }

  const candidate = lines.find((line) => /,\s/.test(line) && line === line.toUpperCase());
  return candidate ? compact(candidate) : "";
}

function parseRequestNumber(text: string, policyNumber: string) {
  const labeled = text
    .split(/\r?\n/)
    .map((line) => compact(line))
    .filter(Boolean)
    .flatMap((line) => [extractInlineValue([line], ["Solicitud", "Request", "No. Solicitud", "Folio"])].filter(Boolean))
    .find(Boolean);

  if (labeled) {
    const labeledMatch = labeled.match(/\b\d{9,}\b/);
    if (labeledMatch?.[0]) return labeledMatch[0];
  }

  return text.match(/\b\d{9,}\b/g)?.find((candidate) => candidate !== policyNumber) ?? null;
}

function parseSerialNumber(lines: string[]) {
  const labels = ["Serie", "Número de serie", "Numero de serie", "No. Serie", "No Serie"];
  const line = extractLineContaining(lines, labels);
  if (!line) return null;

  const match = line.match(/\b(?:Serie|Número de serie|Numero de serie|No\.?\s*Serie)\s*[:\-]?\s*([A-Z0-9-]{8,})/i);
  if (match?.[1]) return compact(match[1]).replace(/\s+/g, "");

  const fallback = line.match(/\b([A-Z0-9]{12,24})\b/);
  return fallback?.[1] ?? null;
}

function parseAutoInsuredObject(lines: string[]) {
  const headingIndex = lines.findIndex((line) => normalize(line).includes("descripcion del vehiculo asegurado"));
  if (headingIndex >= 0) {
    const nextLine = lines[headingIndex + 1];
    if (nextLine) return compact(nextLine);
  }

  const vehicleLine = lines.find((line) =>
    /[A-Z0-9].+\b(AUT\.?|AUTOMOVIL|CAMIONETA|SEDAN|SUV|PICKUP|VAN)\b/i.test(line),
  );
  return vehicleLine ? compact(vehicleLine) : null;
}

export function extractPolicyPdfDraftFromText(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => compact(line))
    .filter(Boolean);
  const fullText = compact(text);

  const policyNumber = parsePolicyNumber(lines, fullText);
  const clientName = parseInsuredName(lines);
  const normalizedFullText = normalize(fullText);
  const insurerName =
    (normalizedFullText.includes("qualitas")
      ? "Quálitas Compañía de Seguros"
      : normalizedFullText.includes("axa seguros")
      ? "AXA Seguros"
      : extractInlineValue(lines, ["Aseguradora", "Compañía", "Compañia"]) ?? "");
  const policyType = normalizePolicyType(extractInlineValue(lines, ["Ramo", "Tipo", "Subramo"]) ?? (normalizedFullText.includes("gmm") ? "GMM" : ""));
  const paymentFrequency = normalizePaymentFrequency(
    extractInlineValue(lines, ["Frecuencia", "Periodicidad", "Forma de Pago", "Forma de pago"]) ??
      (normalizedFullText.includes("anual") ? "Anual" : ""),
  );
  const paymentPlan = extractInlineValue(lines, ["Plan de pago", "Plan"]) ?? null;
  const requestNumber = parseRequestNumber(fullText, policyNumber);

  const startDate =
    extractDateFromMatchingLine(lines, ["Fecha de inicio de vigencia", "Inicio de vigencia", "Vigencia Desde", "Desde"], "first") ??
    extractDatesFromLine(
      extractLineContaining(lines, ["Vigencia"]) ??
        lines.find((line) => /\b\d{2}[/-]\d{2}[/-]\d{4}\b/.test(line) && /al|a|hasta|-/i.test(line)) ??
        null,
    )[0] ??
    null;
  const endDate =
    extractDateFromMatchingLine(lines, ["Fecha de fin de vigencia", "Fin de vigencia", "Vigencia Hasta", "Hasta"], "last") ??
    extractDatesFromLine(
      extractLineContaining(lines, ["Vigencia"]) ??
        lines.find((line) => /\b\d{2}[/-]\d{2}[/-]\d{4}\b/.test(line) && /al|a|hasta|-/i.test(line)) ??
        null,
    ).at(-1) ??
    null;

  const issueLine = extractLineContaining(lines, ["Fecha de emisión", "Fecha de emision", "Emisión", "Emision", "Expedición", "Expedicion"]);
  const issueDate = normalizeDateString(issueLine?.match(/\b(\d{2}[/-]\d{2}[/-]\d{4})\b/)?.[1] ?? null);

  const premiumLine =
    extractLineContaining(lines, ["Prima anual total", "Prima total", "Prima anual", "Prima", "Importe total", "IMPORTE TOTAL"]) ??
    lines.find((line) => /\$\s?[\d.,]+/.test(line)) ??
    null;
  const premiumAmount =
    parseMoney(premiumLine?.match(/\$\s?[\d.,]+(?:\.\d{2})?/)?.[0] ?? premiumLine?.match(/\b[\d.,]+\b/)?.[0] ?? null) ??
    parseMoney(fullText.match(/\$\s?[\d.,]+(?:\.\d{2})?/)?.[0] ?? fullText.match(/\b[\d.,]+\b/)?.[0] ?? null) ??
    0;
  const serialNumber = policyType === "AUTO" ? parseSerialNumber(lines) : null;
  const insuredObject =
    policyType === "GMM"
      ? null
      : extractInlineValue(lines, ["Objeto asegurado", "Bien asegurado"]) ??
        (policyType === "AUTO" ? parseAutoInsuredObject(lines) : null);
  const beneficiaryInfo = extractInlineValue(lines, ["Beneficiarios", "Beneficiario"]) ?? null;
  const notes = [requestNumber ? `Solicitud ${requestNumber}` : null, issueDate ? `Emisión ${issueDate}` : null]
    .filter(Boolean)
    .join(" · ") || null;

  const draft = {
    policyNumber,
    clientName,
    insurerName,
    policyType,
    serialNumber,
    startDate: startDate ?? "",
    endDate: endDate ?? "",
    issueDate,
    paymentFrequency,
    paymentPlan,
    premiumAmount,
    currency: "MXN",
    requestNumber,
    insuredObject,
    beneficiaryInfo,
    notes,
    sourcePolicyNumber: suggestPreviousPolicyNumber(policyNumber),
  } satisfies PolicyPdfCaptureDraft;

  return draft;
}

export function suggestPreviousPolicyNumber(policyNumber: string) {
  const match = policyNumber.match(/^(.*?U)(\d{2})$/i);
  if (!match) return null;

  const prefix = match[1];
  const current = Number(match[2]);
  if (!Number.isFinite(current) || current <= 0) return null;
  return `${prefix}${String(current - 1).padStart(2, "0")}`;
}

function scoreTextMatch(needle: string, candidate: string) {
  const normalizedNeedle = normalize(needle).trim();
  const normalizedCandidate = normalize(candidate).trim();
  if (!normalizedNeedle || !normalizedCandidate) return 0;
  if (normalizedNeedle === normalizedCandidate) return 100;
  if (normalizedCandidate.includes(normalizedNeedle) || normalizedNeedle.includes(normalizedCandidate)) return 80;
  const needleTokens = normalizedNeedle.split(/\s+/).filter(Boolean);
  const candidateTokens = normalizedCandidate.split(/\s+/).filter(Boolean);
  const matches = needleTokens.filter((token) => candidateTokens.some((candidateToken) => candidateToken.includes(token) || token.includes(candidateToken)));
  return matches.length * 10;
}

export async function parsePolicyPdfCapture(file: Uint8Array) {
  const pdfParseModule = await import("pdf-parse");
  const pdfParse =
    (pdfParseModule as unknown as { default?: (input: Buffer) => Promise<{ text?: string }> }).default ??
    (pdfParseModule as unknown as (input: Buffer) => Promise<{ text?: string }>);
  const parsed = await pdfParse(Buffer.from(file));
  return extractPolicyPdfDraftFromText(parsed.text ?? "");
}

export async function buildPolicyPdfCapturePreview(file: Uint8Array): Promise<PolicyPdfCapturePreview> {
  const db = getDb();
  const draft = await parsePolicyPdfCapture(file);
  const warnings: string[] = [];
  const policyNumberSuggestion = draft.sourcePolicyNumber;

  const clientCandidates = draft.clientName
    ? (await db.client.findMany({
        where: { status: { not: "ARCHIVED" } },
        select: { id: true, fullName: true },
        orderBy: { fullName: "asc" },
      }))
        .map((client) => ({ id: client.id, label: client.fullName, score: scoreTextMatch(draft.clientName, client.fullName) }))
        .filter((client) => client.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5)
        .map(({ id, label }) => ({ id, value: id, label }))
    : [];

  const insurerCandidates = draft.insurerName
    ? (await db.insurer.findMany({
        where: { status: { not: "ARCHIVED" } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }))
        .map((insurer) => ({ id: insurer.id, label: insurer.name, score: scoreTextMatch(draft.insurerName, insurer.name) }))
        .filter((insurer) => insurer.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5)
        .map(({ id, label }) => ({ id, value: id, label }))
    : [];

  const suggestedClientId = clientCandidates[0]?.id ?? null;
  const suggestedInsurerId = insurerCandidates[0]?.id ?? null;

  const sourcePolicyCandidates = await buildSourcePolicyCandidates(db, draft, suggestedClientId, suggestedInsurerId);
  const suggestedSourcePolicyId =
    sourcePolicyCandidates.find((policy) => policy.policyNumber === policyNumberSuggestion)?.id ??
    sourcePolicyCandidates[0]?.id ??
    null;

  if (!draft.policyNumber) warnings.push("No pudimos detectar el número de póliza.");
  if (!draft.clientName) warnings.push("No pudimos detectar el asegurado principal.");
  if (!draft.insurerName) warnings.push("No pudimos detectar la aseguradora.");
  if (!draft.startDate || !draft.endDate) warnings.push("No pudimos detectar la vigencia completa.");
  if (draft.policyType === "AUTO" && !draft.serialNumber) {
    warnings.push("No pudimos detectar la serie del vehículo.");
  }
  if (!sourcePolicyCandidates.length && policyNumberSuggestion) {
    warnings.push(`No encontramos una póliza origen para sugerir (${policyNumberSuggestion}).`);
  }
  if (!sourcePolicyCandidates.length && draft.serialNumber) {
    warnings.push(`No encontramos una póliza origen para sugerir con la serie ${draft.serialNumber}.`);
  }
  if (draft.paymentFrequency === "OTHER") {
    warnings.push("La frecuencia no quedó totalmente clara; revisa que sea Anual.");
  }

  return {
    draft,
    suggestions: {
      clientId: suggestedClientId,
      insurerId: suggestedInsurerId,
      sourcePolicyId: suggestedSourcePolicyId,
    },
    clientOptions: clientCandidates,
    insurerOptions: insurerCandidates,
    sourcePolicyOptions: sourcePolicyCandidates,
    confidence: {
      client: clientCandidates.length > 0,
      insurer: insurerCandidates.length > 0,
      sourcePolicy: Boolean(suggestedSourcePolicyId),
    },
    warnings,
  } satisfies PolicyPdfCapturePreview;
}

async function buildSourcePolicyCandidates(
  db: ReturnType<typeof getDb>,
  draft: PolicyPdfCaptureDraft,
  clientId: string | null,
  insurerId: string | null,
) {
  const candidates: Array<PolicyCaptureSourceOption> = [];
  const exactNumber = draft.sourcePolicyNumber;

  if (draft.serialNumber && draft.policyType === "AUTO") {
    const targetStartDate = draft.startDate ? parseDateInput(draft.startDate) : null;
    const serialPolicies = await db.policy.findMany({
      where: {
        ...(clientId ? { clientId } : {}),
        ...(insurerId ? { insurerId } : {}),
        policyType: "AUTO",
        status: { in: ["ACTIVE", "EXPIRED", "RENEWED"] },
        ...(targetStartDate ? { endDate: { lt: targetStartDate } } : {}),
        insuredAssets: {
          some: {
            serialNumber: draft.serialNumber,
          },
        },
      },
      orderBy: [{ endDate: "desc" }, { startDate: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        policyNumber: true,
        startDate: true,
        endDate: true,
        status: true,
        insuredAssets: {
          where: { serialNumber: draft.serialNumber },
          select: {
            serialNumber: true,
          },
          take: 1,
        },
      },
      take: 5,
    });

    candidates.push(
      ...serialPolicies.map((policy) => ({
        id: policy.id,
        value: policy.id,
        label: `${policy.policyNumber} · ${policy.status} · ${policy.endDate.toISOString().slice(0, 10)} · Serie ${policy.insuredAssets[0]?.serialNumber ?? draft.serialNumber}`,
        policyNumber: policy.policyNumber,
        startDate: policy.startDate.toISOString().slice(0, 10),
        endDate: policy.endDate.toISOString().slice(0, 10),
        status: policy.status,
        serialNumber: policy.insuredAssets[0]?.serialNumber ?? null,
      })),
    );
  }

  if (exactNumber) {
    const exact = await db.policy.findMany({
      where: {
        policyNumber: exactNumber,
        ...(clientId ? { clientId } : {}),
        ...(insurerId ? { insurerId } : {}),
      },
      orderBy: [{ startDate: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        policyNumber: true,
        startDate: true,
        endDate: true,
        status: true,
        insuredAssets: {
          select: {
            serialNumber: true,
          },
          take: 1,
        },
      },
      take: 5,
    });
    candidates.push(
      ...exact.map((policy) => ({
        id: policy.id,
        value: policy.id,
        label: `${policy.policyNumber} · ${policy.status} · ${policy.endDate.toISOString().slice(0, 10)}${policy.insuredAssets[0]?.serialNumber ? ` · Serie ${policy.insuredAssets[0].serialNumber}` : ""}`,
        policyNumber: policy.policyNumber,
        startDate: policy.startDate.toISOString().slice(0, 10),
        endDate: policy.endDate.toISOString().slice(0, 10),
        status: policy.status,
        serialNumber: policy.insuredAssets[0]?.serialNumber ?? null,
      })),
    );
  }

  if (candidates.length === 0 && clientId && insurerId) {
    const fallback = await db.policy.findMany({
      where: {
        clientId,
        insurerId,
        policyType: draft.policyType,
        status: { in: ["ACTIVE", "EXPIRED", "RENEWED"] },
      },
      orderBy: [{ endDate: "desc" }, { startDate: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        policyNumber: true,
        startDate: true,
        endDate: true,
        status: true,
        insuredAssets: {
          select: {
            serialNumber: true,
          },
          take: 1,
        },
      },
      take: 5,
    });

    candidates.push(
      ...fallback.map((policy) => ({
        id: policy.id,
        value: policy.id,
        label: `${policy.policyNumber} · ${policy.status} · ${policy.endDate.toISOString().slice(0, 10)}${policy.insuredAssets[0]?.serialNumber ? ` · Serie ${policy.insuredAssets[0].serialNumber}` : ""}`,
        policyNumber: policy.policyNumber,
        startDate: policy.startDate.toISOString().slice(0, 10),
        endDate: policy.endDate.toISOString().slice(0, 10),
        status: policy.status,
        serialNumber: policy.insuredAssets[0]?.serialNumber ?? null,
      })),
    );
  }

  return candidates;
}

export function normalizePdfPaymentFrequencyLabel(value: string) {
  const code = normalizePaymentFrequency(value);
  const labels: Record<string, string> = {
    MONTHLY: "Mensual",
    QUARTERLY: "Trimestral",
    SEMIANNUAL: "Semestral",
    ANNUAL: "Anual",
    SINGLE: "Única",
    OTHER: "Otra",
  };
  return labels[code] ?? code;
}
