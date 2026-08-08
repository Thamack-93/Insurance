import { addMonths } from "date-fns";
import type { SelectOption } from "@/lib/domain-options";

export type PolicyPdfCaptureDraft = {
  policyNumber: string;
  clientName: string;
  clientType: "PERSON" | "COMPANY";
  clientEmail: string | null;
  clientPhone: string | null;
  clientAddress: string | null;
  clientRfc: string | null;
  clientBirthDate?: string | null;
  insurerName: string;
  policyType: string;
  serialNumber: string | null;
  startDate: string;
  endDate: string;
  issueDate: string | null;
  paymentFrequency: string;
  paymentPlan: string | null;
  premiumAmount: number;
  currency: string;
  requestNumber: string | null;
  insuredObject: string | null;
  beneficiaryInfo: string | null;
  notes: string | null;
  sourcePolicyNumber: string | null;
};

export type PolicyPdfCaptureFieldKey =
  | "policyNumber"
  | "clientName"
  | "clientType"
  | "clientEmail"
  | "clientPhone"
  | "clientAddress"
  | "clientRfc"
  | "clientBirthDate"
  | "insurerName"
  | "policyType"
  | "serialNumber"
  | "startDate"
  | "endDate"
  | "issueDate"
  | "paymentFrequency"
  | "premiumAmount"
  | "sourcePolicyNumber";

export type PolicyPdfCaptureFieldConfidence = Record<PolicyPdfCaptureFieldKey, "high" | "medium" | "low">;

export type PolicyPdfCaptureAiReview = {
  summary: string;
  warnings: string[];
  suggestions: string[];
  corrections: Array<{
    field: PolicyPdfCaptureFieldKey;
    proposedValue: string;
    reason: string;
    confidence: "high" | "medium" | "low";
  }>;
};

export type PolicyPdfCaptureSource = "local" | "ai";
export type PolicyPdfCaptureReviewSource = "none" | "ai";
export type PolicyPdfCaptureTrackingStatus = "recorded" | "unavailable";
export type PolicyPdfCaptureRequestedMode = "local" | "ai";

export type PolicyPdfCaptureProvenance = {
  requestedMode?: PolicyPdfCaptureRequestedMode;
  extractionSource: PolicyPdfCaptureSource;
  reviewSource: PolicyPdfCaptureReviewSource;
  aiRunIds: string[];
  trackingStatus: PolicyPdfCaptureTrackingStatus;
  aiAttempted: boolean;
  aiFailureCode?: string | null;
};

export type PolicyPdfCaptureDocumentKind = "policy" | "receipt" | "endorsement" | "inciso" | "unknown";

export type PolicyPdfCaptureRelatedDocument = {
  id: string;
  fileName: string;
  kind: PolicyPdfCaptureDocumentKind;
  source: "local" | "ai";
  policyNumber: string | null;
  warnings: string[];
};

export type PolicyPdfCaptureReceiptEvidence = {
  policyNumber: string | null;
  receiptControlNumber: string | null;
  dueDate: string | null;
  periodLabel: string | null;
  amountDue: number | null;
  depositAmount: number | null;
  currency: string;
  paymentMethod: string | null;
  paymentConfirmed: false;
  warnings: string[];
};

export type PolicyCaptureOption = {
  id: string;
} & SelectOption;

export type PolicyCaptureSourceOption = PolicyCaptureOption & {
  policyNumber: string;
  startDate: string;
  endDate: string;
  status: string;
  serialNumber: string | null;
};

export type PolicyPdfCapturePreview = {
  draft: PolicyPdfCaptureDraft;
  suggestions: {
    clientId: string | null;
    insurerId: string | null;
    sourcePolicyId: string | null;
  };
  receiptPlan: PolicyPdfCaptureReceiptPlanItem[];
  clientOptions: PolicyCaptureOption[];
  insurerOptions: PolicyCaptureOption[];
  sourcePolicyOptions: PolicyCaptureSourceOption[];
  fieldConfidence: PolicyPdfCaptureFieldConfidence;
  confidence: {
    client: boolean;
    insurer: boolean;
    sourcePolicy: boolean;
  };
  warnings: string[];
  aiReview: PolicyPdfCaptureAiReview | null;
  provenance: PolicyPdfCaptureProvenance;
  relatedDocuments?: PolicyPdfCaptureRelatedDocument[];
  receiptEvidence?: PolicyPdfCaptureReceiptEvidence | null;
};

export type PolicyPdfCaptureReceiptPlanItem = {
  receiptNumber: string;
  periodStartDate: string;
  periodEndDate: string;
  dueDate: string;
  amount: number;
  currency: string;
};

type PolicyPdfCaptureReceiptPlanDraft = Pick<
  PolicyPdfCaptureDraft,
  "startDate" | "endDate" | "paymentFrequency" | "premiumAmount" | "currency"
>;

function parseIsoDate(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const [, yearRaw, monthRaw, dayRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
}

function formatIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addMonthsToIsoDate(value: string, months: number) {
  const parsed = parseIsoDate(value);
  if (!parsed) return value;
  return formatIsoDate(addMonths(parsed, months));
}

function getReceiptPlanCount(paymentFrequency: string) {
  switch (paymentFrequency) {
    case "MONTHLY":
      return 12;
    case "QUARTERLY":
      return 4;
    case "SEMIANNUAL":
      return 2;
    case "ANNUAL":
    case "SINGLE":
    case "OTHER":
    default:
      return 1;
  }
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function buildSequentialReceiptNumbers(count: number) {
  return Array.from({ length: Math.max(1, count) }, (_, index) => String(index + 1));
}

export function buildPolicyPdfCaptureReceiptPlan(draft: PolicyPdfCaptureReceiptPlanDraft): PolicyPdfCaptureReceiptPlanItem[] {
  if (!draft.startDate || !draft.endDate) return [];

  const termCount = getReceiptPlanCount(draft.paymentFrequency);
  const receiptNumbers = buildSequentialReceiptNumbers(termCount);
  const startDate = draft.startDate;
  const endDate = draft.endDate;
  const totalAmount = roundMoney(draft.premiumAmount);

  if (receiptNumbers.length === 1) {
    return [
      {
        receiptNumber: receiptNumbers[0] ?? "1",
        periodStartDate: startDate,
        periodEndDate: endDate,
        dueDate: startDate,
        amount: totalAmount,
        currency: draft.currency,
      },
    ];
  }

  const monthsPerTerm = Math.max(1, Math.round(12 / receiptNumbers.length));
  const baseAmount = roundMoney(totalAmount / receiptNumbers.length);
  let remainingAmount = totalAmount;
  let currentStartDate = startDate;

  return receiptNumbers.map((receiptNumber, index) => {
    const isLast = index === receiptNumbers.length - 1;
    const nextStartDate = isLast ? endDate : addMonthsToIsoDate(currentStartDate, monthsPerTerm);
    const amount = isLast ? roundMoney(remainingAmount) : baseAmount;
    remainingAmount = roundMoney(remainingAmount - amount);

    const item = {
      receiptNumber,
      periodStartDate: currentStartDate,
      periodEndDate: nextStartDate,
      dueDate: currentStartDate,
      amount,
      currency: draft.currency,
    };

    currentStartDate = nextStartDate;
    return item;
  });
}

export function mergePolicyPdfCaptureReceiptPlan(
  draft: PolicyPdfCaptureReceiptPlanDraft,
  existingPlan: PolicyPdfCaptureReceiptPlanItem[] = [],
) {
  const basePlan = buildPolicyPdfCaptureReceiptPlan(draft);
  if (existingPlan.length === 0) return basePlan;

  const amountByReceiptNumber = new Map(
    existingPlan
      .filter((item) => item.receiptNumber.trim())
      .map((item) => [item.receiptNumber.trim(), item.amount] as const),
  );

  return basePlan.map((item) => {
    const nextAmount = amountByReceiptNumber.get(item.receiptNumber);
    return typeof nextAmount === "number" && Number.isFinite(nextAmount)
      ? { ...item, amount: roundMoney(nextAmount) }
      : item;
  });
}

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

const CAPTURE_GENERIC_IDENTITY_TOKENS = new Set([
  "a", "de", "del", "la", "las", "los", "s", "sa", "c", "cv", "sc", "rl",
  "compania", "compañia", "seguros", "seguro", "aseguradora",
]);

export function normalizeCaptureIdentity(value: string) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function captureIdentityTokens(value: string) {
  const normalized = normalizeCaptureIdentity(value);
  const meaningful = normalized.split(" ").filter((token) => token.length > 1 && !CAPTURE_GENERIC_IDENTITY_TOKENS.has(token));
  return meaningful.length > 0 ? meaningful : normalized.split(" ").filter(Boolean);
}

export function scoreCaptureIdentity(needle: string, candidate: string) {
  const left = captureIdentityTokens(needle);
  const right = captureIdentityTokens(candidate);
  if (left.length === 0 || right.length === 0) return 0;
  if (left.join(" ") === right.join(" ")) return 100;
  const matches = left.filter((token) => right.some((candidateToken) => candidateToken === token));
  const coverage = matches.length / Math.max(left.length, right.length);
  return Math.round(coverage * 90);
}

const POLICY_TYPE_CODES = new Set([
  "AUTO",
  "GMM",
  "VIDA",
  "DANOS",
  "FIANZAS",
  "HOGAR",
  "RESPONSABILIDAD_CIVIL",
  "EMPRESARIAL",
  "ACCIDENTES",
  "OTRO",
]);

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

function normalizeDateString(value: string | null | undefined) {
  if (!value) return null;

  const cleaned = compact(value);
  const ddmmyyyy = cleaned.match(/\b(\d{1,2})[/-](\d{2})[/-](\d{4})\b/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return `${year}-${month}-${day}`;
  }

  const yyyymmdd = cleaned.match(/\b(\d{4})[/-](\d{2})[/-](\d{2})\b/);
  if (yyyymmdd) {
    const [, year, month, day] = yyyymmdd;
    return `${year}-${month}-${day}`;
  }

  const ddMonthYyyy = cleaned.match(/\b(\d{1,2})[/-]([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,9})[/-](\d{4})\b/);
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
    ...line.matchAll(/\b(\d{1,2}[/-]\d{2}[/-]\d{4})\b/g),
    ...line.matchAll(/\b(\d{1,2}[/-][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,9}[/-]\d{4})\b/g),
    ...line.matchAll(/\b(\d{4}[/-]\d{2}[/-]\d{2})\b/g),
  ]
    .map((match) => normalizeDateString(match[1]))
    .filter(Boolean) as string[];
}

function extractDateFromMatchingLine(lines: string[], labels: string[], position: "first" | "last") {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalizedLine = normalizeText(line);
    if (!labels.some((label) => normalizedLine.includes(normalizeText(label)))) continue;
    const dates = [
      ...extractDatesFromLine(line),
      ...extractDatesFromLine(lines[index + 1]),
      ...extractDatesFromLine(lines[index + 2]),
    ];
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
    const normalizedLine = normalizeText(line);
    for (const label of labels) {
      const normalizedLabel = normalizeText(label);
      const index = findLabelIndex(normalizedLine, normalizedLabel);
      if (index < 0) continue;

      const rawSlice = line.slice(index + label.length).replace(/^[:\-\s]+/, "").trim();
      if (rawSlice) return rawSlice;
    }
  }
  return null;
}

function findLabelIndex(normalizedLine: string, normalizedLabel: string) {
  let searchFrom = 0;
  while (searchFrom <= normalizedLine.length) {
    const index = normalizedLine.indexOf(normalizedLabel, searchFrom);
    if (index < 0) return -1;
    const before = normalizedLine[index - 1];
    const after = normalizedLine[index + normalizedLabel.length];
    const isWordCharacter = (value: string | undefined) => Boolean(value && /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]/.test(value));
    if (!isWordCharacter(before) && !isWordCharacter(after)) return index;
    searchFrom = index + normalizedLabel.length;
  }
  return -1;
}

function extractLineContaining(lines: string[], labels: string[]) {
  for (const line of lines) {
    const normalizedLine = normalizeText(line);
    if (labels.some((label) => findLabelIndex(normalizedLine, normalizeText(label)) >= 0)) {
      return line;
    }
  }
  return null;
}

function findLineIndexContaining(lines: string[], labels: string[]) {
  const normalizedLabels = labels.map((label) => normalizeText(label));
  return lines.findIndex((line) => {
    const normalizedLine = normalizeText(line);
    return normalizedLabels.some((label) => findLabelIndex(normalizedLine, label) >= 0);
  });
}

function findLastLineIndexContaining(lines: string[], labels: string[]) {
  const normalizedLabels = labels.map((label) => normalizeText(label));
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const normalizedLine = normalizeText(lines[index]);
    if (normalizedLabels.some((label) => findLabelIndex(normalizedLine, label) >= 0)) {
      return index;
    }
  }
  return -1;
}

function isInsuredHeading(line: string) {
  return /^\s*(?:informaci[oó]n del asegurado|datos del asegurado(?:\s*\/|\s*$))/i.test(line);
}

function findNextMeaningfulLine(lines: string[], startIndex: number, stopLabels: string[] = []) {
  const normalizedStops = stopLabels.map((label) => normalizeText(label));
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    const normalizedLine = normalizeText(line);
    if (!line.trim()) continue;
    if (normalizedStops.some((label) => normalizedLine.includes(label))) return null;
    if (/^\d{8,12}\s+\d{4,6}\s+\d{4}$/.test(line) || /^\d{8,12}\b/.test(line)) continue;
    if (/^(plan|pol[ií]za|vigencia|informaci[oó]n importante|datos de la p[oó]liza|datos del asegurado|coberturas|oficina de atenci[oó]n|condiciones generales aplicables|funcionario autorizado)\b/i.test(line)) {
      continue;
    }
    return line;
  }
  return null;
}

function isLikelyPhoneNumber(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 && (/^800/.test(digits) || /^[2-9]/.test(digits));
}

function isNearRequestLabel(lines: string[], index: number) {
  return lines.slice(Math.max(0, index - 2), index).some((line) => /solicitud|request|folio/i.test(line));
}

type FieldConfidence = "high" | "medium" | "low";

function isCompanySignal(value: string) {
  const normalized = normalizeText(value);
  return (
    /(^|\b)(s\.?a\.?|s de rl|s\.? de r\.?l\.?|sociedad anonima|sociedad de responsabilidad|compania|compañia|empresa|escuela|colegio|instituto|universidad|grupo|corporativo|constructora|servicios|asociados|consorcio|corporacion|corporación)(\b|$)/i.test(
      normalized,
    )
  );
}

export function inferClientType(fullName: string, rfc: string | null, contextText?: string) {
  const hasRfc = Boolean(rfc?.trim());
  if (!hasRfc) return "PERSON" as const;
  const signalSource = contextText && contextText.trim() ? `${fullName} ${contextText}` : fullName;
  if (isCompanySignal(signalSource)) return "COMPANY" as const;
  const normalized = normalizeText(signalSource);
  if (/(\bsa\b|\bde rl\b|\bs de rl\b|\bcompania\b|\bempresa\b|\bescuela\b|\binstituto\b|\bcolegio\b|\buniversidad\b)/i.test(normalized)) {
    return "COMPANY" as const;
  }
  return "PERSON" as const;
}

function cleanContactValue(value: string | null | undefined) {
  if (!value) return null;
  const cleaned = compact(value)
    .replace(/\b(tel[eé]fono|telefono|email|correo|rfc|domicilio|direcci[oó]n)\s*[:\-]?\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || null;
}

function cleanAddressValue(value: string | null | undefined) {
  if (!value) return null;
  const withoutTrailingContact = compact(value).replace(/\b(tel[eé]fono|telefono|correo|email)\s*[:\-]?.*$/i, "");
  const cleaned = cleanContactValue(withoutTrailingContact);
  if (!cleaned) return null;
  return cleaned
    .replace(/\b(tel[eé]fono|telefono|correo|email|rfc|registro federal|vigencia|plan|solicitud|beneficiarios|descripci[oó]n|movimiento)\b.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    || null;
}

function cleanNameValue(value: string | null | undefined) {
  if (!value) return null;
  const cleaned = compact(value)
    .replace(/\b(registro federal de contribuyentes|r\.?\s*f\.?\s*c\.?|rfc|domicilio|direcci[oó]n|tel[eé]fono|telefono|tipo de seguro|frecuencia|prima|vigencia|plan de pago|solicitud)\b.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || null;
}

function extractMoneyValues(value: string) {
  return [...value.matchAll(/\b\d[\d,]*(?:\.\d{2})?\b/g)]
    .map((match) => parseMoney(match[0]))
    .filter((amount): amount is number => amount !== null && Number.isFinite(amount));
}

function extractSpanishDate(value: string | null | undefined) {
  if (!value) return null;

  const normalized = compact(value).toLowerCase();
  const match = normalized.match(/\b(?:a\s*)?(\d{1,2})\s*(?:de\s*)?([a-záéíóúüñ]{3,12})\s*(?:de\s*)?(\d{4})\b/);
  if (!match) return null;

  const [, dayRaw, monthToken, year] = match;
  const month = monthTokenToNumber(monthToken);
  if (!month) return null;

  const day = String(Number(dayRaw)).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function extractValueFromLabelWindow(lines: string[], labels: string[], lookahead = 1) {
  const normalizedLabels = labels.map((label) => normalizeText(label));
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalizedLine = normalizeText(line);
    const label = normalizedLabels.find((candidate) => findLabelIndex(normalizedLine, candidate) >= 0);
    if (!label) continue;

    const rawLabel = labels[normalizedLabels.indexOf(label)];
    const inline = extractInlineValue([line], [rawLabel]);
    if (inline) return inline;

    for (let offset = 1; offset <= lookahead; offset += 1) {
      const nextLine = lines[index + offset];
      if (!nextLine) continue;
      if (normalizedLabels.some((candidate) => findLabelIndex(normalizeText(nextLine), candidate) >= 0)) continue;
      if (nextLine.length < 2) continue;
      return nextLine;
    }
  }
  return null;
}

function extractAddressFromBlock(block: string[]) {
  const addressLabelPattern = /^(?:domicilio(?:\s+calle)?|direcci[oó]n(?:\s+calle)?|calle\s+y\s+no\.?|calle\s+y\s+n[uú]mero|address)\b/i;
  const streetLabelPattern = /^(?:domicilio(?:\s+calle)?|direcci[oó]n(?:\s+calle)?|calle\s+y\s+no\.?|calle\s+y\s+n[uú]mero|address)\s*[:\-]?\s*/i;
  const stopPattern = /\b(r\.?f\.?c\.?|c\.?p\.?|c[oó]digo postal|municipio|alcald[ií]a|estado|colonia|delegaci[oó]n|entre calles|tel[eé]fono|telefono)\b/i;

  for (let index = 0; index < block.length; index += 1) {
    const line = block[index];
    if (!addressLabelPattern.test(line)) continue;

    const streetMatch = compact(line)
      .replace(streetLabelPattern, "")
      .split(stopPattern)[0]
      .trim();
    const street = cleanAddressValue(streetMatch);
    if (
      !street ||
      street.length < 8 ||
      /^(r\.?f\.?c\.?|c\.?p\.?|municipio|estado|colonia)$/i.test(normalizeText(street)) ||
      /^[\W_]+$/.test(street)
    ) {
      continue;
    }

    const followUpParts = [block[index + 1], block[index + 2], block[index + 3], block[index + 4]]
      .filter(Boolean)
      .filter((candidate) => /\b(c\.?p\.?|c[oó]digo postal|municipio|estado|colonia|alcald[ií]a|delegaci[oó]n)\b/i.test(candidate));
    const followUp = followUpParts.length
      ? followUpParts
          .join(" ")
          .replace(/\bC\.?P\.?:\s*/i, "C.P. ")
          .replace(/\bC[oó]digo Postal:\s*/i, "C.P. ")
          .replace(/\bMunicipio:\s*/i, "Municipio ")
          .replace(/\bAlcald[ií]a\/?\s*Municipio:\s*/i, "Municipio ")
          .replace(/\bEstado:\s*/i, "Estado ")
          .replace(/\bColonia:\s*/i, "Colonia ")
          .trim()
      : null;

    const combined = [street, followUp].filter(Boolean).join(" ").trim();
    const cleaned = cleanAddressValue(combined);
    if (cleaned) return cleaned;
  }

  const addressLine = block.find((line) => addressLabelPattern.test(line));
  if (addressLine) {
    const street = cleanAddressValue(compact(addressLine).replace(streetLabelPattern, "").split(stopPattern)[0].trim());
    if (street && street.length >= 8) {
      return street;
    }
  }

  return null;
}

function normalizePaymentFrequency(value: string | null | undefined) {
  if (!value) return "ANNUAL";
  const normalized = normalizeText(value);
  if (normalized.includes("mensual")) return "MONTHLY";
  if (normalized.includes("trimestral")) return "QUARTERLY";
  if (normalized.includes("semestral")) return "SEMIANNUAL";
  if (normalized.includes("anual")) return "ANNUAL";
  if (normalized.includes("unica") || normalized.includes("single")) return "SINGLE";
  return value.toUpperCase();
}

function normalizePolicyType(value: string | null | undefined) {
  if (!value) return "GMM";
  const normalized = normalizeText(value);
  if (normalized.includes("automoviles") || normalized.includes("automovil") || normalized.includes("vehiculo asegurado") || normalized.includes("descripcion del vehiculo asegurado")) {
    return "AUTO";
  }
  if (normalized.includes("gmm")) return "GMM";
  if (normalized.includes("plan solicitud")) return "GMM";
  if (normalized.includes("auto")) return "AUTO";
  if (normalized.includes("vida")) return "VIDA";
  if (normalized.includes("danos")) return "DANOS";
  if (normalized.includes("fianza")) return "FIANZAS";
  if (normalized.includes("hogar")) return "HOGAR";
  if (normalized.includes("responsabilidad")) return "RESPONSABILIDAD_CIVIL";
  if (normalized.includes("empresarial")) return "EMPRESARIAL";
  if (normalized.includes("accidente")) return "ACCIDENTES";
  const upper = value.toUpperCase();
  return POLICY_TYPE_CODES.has(upper) ? upper : "OTRO";
}

function parsePolicyNumber(lines: string[]) {
  const policyPattern = /\b(\d{5}U\d{2}|\d{5,12})\b/i;
  const policyHeaderIndex = findLineIndexContaining(lines, [
    "PÓLIZA ENDOSO INCISO",
    "Poliza ENDOSO INCISO",
  ]);
  if (policyHeaderIndex >= 0) {
    const headerWindow = lines.slice(policyHeaderIndex + 1, policyHeaderIndex + 4);
    const explicitHeaderNumber = headerWindow
      .map((line) => line.match(/^\s*(\d{5}U\d{2}|\d{8,12})\b/i)?.[1] ?? null)
      .find((value) => Boolean(value));
    if (explicitHeaderNumber) return explicitHeaderNumber;
  }

  const explicitPolicyLine = lines.find((line) => /(?:no\.?\s*de\s*p[oó]liza|n[uú]mero\s+de\s+p[oó]liza)/i.test(line) && policyPattern.test(line) && !isLikelyPhoneNumber(line));
  if (explicitPolicyLine) {
    const match = explicitPolicyLine.match(policyPattern);
    if (match?.[1]) return match[1];
  }

  const labeledPolicyLine = lines.find((line) => /\bp[oó]liza\b/i.test(line) && policyPattern.test(line) && !/solicitud|folio|request/i.test(line) && !isLikelyPhoneNumber(line));
  if (labeledPolicyLine) {
    const match = labeledPolicyLine.match(policyPattern);
    if (match?.[1]) return match[1];
  }

  const topLine = lines.slice(0, 18).find((line, index) => {
    if (isLikelyPhoneNumber(line) || /solicitud|folio|request/i.test(line) || isNearRequestLabel(lines, index)) return false;
    return /^(?:\d{5}U\d{2}|\d{5,12})(?:\s+\d{4,6}){1,2}$/.test(line) || /^(?:\d{5}U\d{2}|\d{5,12})\b/.test(line);
  });
  if (topLine) {
    return topLine.match(/^(?:\d{5}U\d{2}|\d{5,12})/)?.[0] ?? "";
  }

  const labelIndex = findLineIndexContaining(lines, [
    "PÓLIZA ENDOSO INCISO",
    "Poliza ENDOSO INCISO",
    "PÓLIZA DE SEGURO DE AUTOMÓVILES",
    "Poliza de seguro de automoviles",
    "PÓLIZA",
    "Poliza",
  ]);
  if (labelIndex >= 0) {
    const immediate = lines[labelIndex + 1];
    if (immediate) {
      const match = immediate.match(/^\s*(\d{5}U\d{2}|\d{5,12})\b/i);
      if (match?.[1]) return match[1];
    }

    const nearby = findNextMeaningfulLine(lines, labelIndex + 1, ["INFORMACIÓN DEL ASEGURADO", "INFORMACION DEL ASEGURADO", "DATOS DEL ASEGURADO"]);
    if (nearby) {
      const match = nearby.match(/^\s*(\d{5}U\d{2}|\d{5,12})\b/i);
      if (match?.[1]) return match[1];
    }
  }

  const anywhere = lines.find((line, index) => !isLikelyPhoneNumber(line) && !/solicitud|folio|request/i.test(line) && !isNearRequestLabel(lines, index) && /^(?:\d{5}U\d{2}|\d{5,12})\b/i.test(line));
  if (anywhere) return anywhere.match(/^(?:\d{5}U\d{2}|\d{5,12})/i)?.[0] ?? "";

  return "";
}

function parseInsuredName(lines: string[]): { value: string; confidence: FieldConfidence } {
  let insuredHeadingIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (isInsuredHeading(lines[index])) {
      insuredHeadingIndex = index;
      break;
    }
  }
  if (insuredHeadingIndex >= 0) {
    const headingWindow = lines.slice(insuredHeadingIndex + 1, insuredHeadingIndex + 4);
    const headingLabel = extractInlineValue(headingWindow, ["Razón Social o Contratante", "Razon Social o Contratante", "Nombre del Contratante", "Nombre del contratante", "Contratante"]);
    if (headingLabel) {
      const cleaned = cleanNameValue(headingLabel);
      if (cleaned) return { value: cleaned, confidence: "high" };
    }
    const nextLine = findNextMeaningfulLine(lines, insuredHeadingIndex + 1, [
      "descripción del vehículo asegurado",
      "descripcion del vehiculo asegurado",
      "vigencia",
      "información importante",
      "informacion importante",
      "datos de la póliza",
      "datos de la poliza",
      "datos del vehículo",
      "datos del vehiculo",
      "renueva a",
    ]);
    if (nextLine) {
      const cleaned = cleanNameValue(nextLine);
      if (cleaned) return { value: cleaned, confidence: "high" };
    }
  }

  const labels = [
    "Razón Social o Contratante",
    "Razon Social o Contratante",
    "Contratante",
    "Asegurado titular",
    "Asegurado",
    "Titular",
    "Nombre del asegurado",
    "Nombre del contratante",
    "Nombre del Contratante",
  ];
  const labeled = extractInlineValue(lines, labels);
  if (labeled) {
    const normalized = normalizeText(labeled);
    if (!["titular", "asegurado", "principal"].includes(normalized)) {
      return { value: cleanNameValue(labeled) ?? compact(labeled), confidence: "high" };
    }
  }

  const rfcLine = lines.find((line) => /\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/i.test(line));
  if (rfcLine) {
    const prefix = compact(rfcLine)
      .split(/registro federal de contribuyentes|r\.?f\.?c\.?|RFC/i)[0]
      .replace(/\b[:\-]\s*$/, "")
      .trim();
    if (prefix && prefix.length >= 4 && !/^(rfc|registro federal de contribuyentes)$/i.test(prefix)) {
      return { value: cleanNameValue(prefix) ?? prefix, confidence: "high" };
    }
  }

  const labelIndex = lines.findIndex((line) => labels.some((label) => findLabelIndex(normalizeText(line), normalizeText(label)) >= 0));
  if (labelIndex >= 0) {
    const nextLine = findNextMeaningfulLine(lines, labelIndex + 1, labels);
    if (nextLine && !labels.some((label) => findLabelIndex(normalizeText(nextLine), normalizeText(label)) >= 0)) {
      return { value: cleanNameValue(nextLine) ?? compact(nextLine), confidence: "high" };
    }
  }

  const uppercaseCandidate = lines.find(
    (line) =>
      /^[A-ZÁÉÍÓÚÜÑ ,.'-]{8,}$/.test(line) &&
      !/qu[aá]litas|seguros|asegurad[oa]|p[oó]liza|vigencia|condiciones|informaci[oó]n/i.test(line),
  );
  if (uppercaseCandidate) {
    return { value: cleanNameValue(uppercaseCandidate) ?? compact(uppercaseCandidate), confidence: "medium" };
  }

  const candidate = lines.find((line) => /,\s/.test(line) && line === line.toUpperCase());
  return candidate ? { value: cleanNameValue(candidate) ?? compact(candidate), confidence: "low" } : { value: "", confidence: "low" };
}

function parseInsurerName(lines: string[], fullText: string): { value: string; confidence: FieldConfidence } {
  const cleanInsurerValue = (value: string | null | undefined) => {
    const cleaned = cleanNameValue(value) ?? compact(value ?? "");
    if (!cleaned || /https?:|www\./i.test(cleaned) || isLikelyPhoneNumber(cleaned)) return null;
    return cleaned;
  };
  const hirLine = lines.find((line) => {
    const normalizedLine = normalizeText(line);
    return /\bhir\b/i.test(normalizedLine) && (/seguros/.test(normalizedLine) || /compania/.test(normalizedLine));
  });
  if (hirLine) {
    return { value: "HIR Compañía de Seguros, S.A. de C.V.", confidence: "high" };
  }

  const normalizedFullText = normalizeText(fullText);
  if (normalizedFullText.includes("qualitas")) {
    return { value: "Quálitas Compañía de Seguros", confidence: "high" };
  }
  if (normalizedFullText.includes("axa seguros")) {
    return { value: "AXA Seguros, S.A. de C.V.", confidence: "high" };
  }
  if (normalizedFullText.includes("seguros banorte") || normalizedFullText.includes("segurosbanorte")) {
    return { value: "Seguros Banorte, S.A. de C.V.", confidence: "high" };
  }

  const labels = ["Aseguradora", "Compañía", "Compañia", "Aseguradora/Compañía", "Aseguradora / Compañía"];
  const inlineValue = lines
    .map((line) => cleanInsurerValue(extractInlineValue([line], labels)))
    .find((value): value is string => Boolean(value)) ?? null;
  if (inlineValue) return { value: inlineValue, confidence: "high" };

  const nearLabel = extractValueFromLabelWindow(lines, labels, 2);
  const nearLabelValue = cleanInsurerValue(nearLabel);
  if (nearLabelValue) return { value: nearLabelValue, confidence: "medium" };

  const heading = lines.find(
    (line) =>
      /seguros|aseguradora|compa[nñ]i?a/i.test(line) &&
      !/pol[ií]za|vigencia|prima|https?:|www\.|^\s*\+?[\d\s().-]{8,}$/i.test(line),
  );
  const headingValue = cleanInsurerValue(heading);
  if (headingValue) return { value: headingValue, confidence: "medium" };

  return { value: "", confidence: "low" };
}

function parseClientRfc(lines: string[]): { value: string | null; confidence: FieldConfidence } {
  const sources = [getInsuredBlock(lines), lines];
  for (const source of sources) {
    const inline = extractInlineValue(source, ["RFC", "R.F.C.", "Registro Federal de Contribuyentes"]);
    const inlineMatch = inline?.match(/\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/i);
    if (inlineMatch?.[0]) return { value: inlineMatch[0].toUpperCase(), confidence: "high" };

    const line = extractLineContaining(source, ["RFC", "R.F.C.", "Registro Federal de Contribuyentes"]);
    const lineMatch = line?.match(/\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/i);
    if (lineMatch?.[0]) return { value: lineMatch[0].toUpperCase(), confidence: "high" };

    const fallback = source.find((candidate) => /\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/i.test(candidate));
    const fallbackMatch = fallback?.match(/\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/i);
    if (fallbackMatch?.[0]) return { value: fallbackMatch[0].toUpperCase(), confidence: "medium" };
  }
  return { value: null, confidence: "low" };
}

function parseClientPhone(lines: string[]): { value: string | null; confidence: FieldConfidence } {
  const block = getInsuredBlock(lines);
  const line = extractValueFromLabelWindow(block, ["Teléfono del asegurado", "Telefono del asegurado", "Teléfono", "Telefono", "Tel", "Phone", "Celular"], 2);
  if (line) {
    const cleaned = compact(line).replace(/[^\d+()\-\s]/g, "").trim();
    if (cleaned) return { value: cleaned, confidence: "high" };
  }
  return { value: null, confidence: "low" };
}

function parseClientEmail(lines: string[]): { value: string | null; confidence: FieldConfidence } {
  const block = getInsuredBlock(lines);
  const line = extractValueFromLabelWindow(block, ["Correo del asegurado", "Correo", "Email", "E-mail", "Correo electrónico", "Correo electronico"], 2);
  if (line) {
    const match = compact(line).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (match?.[0]) return { value: match[0], confidence: "high" };
  }
  return { value: null, confidence: "low" };
}

function getInsuredBlock(lines: string[]) {
  const headingIndices = lines
    .map((line, index) => (isInsuredHeading(line) ? index : -1))
    .filter((index) => index >= 0);

  if (!headingIndices.length) return lines;

  let bestBlock = lines.slice(headingIndices[0] + 1);
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const headingIndex of headingIndices) {
    const endIndexCandidates = [
      findLineIndexContaining(lines.slice(headingIndex + 1), ["DESCRIPCIÓN DEL VEHÍCULO ASEGURADO", "DESCRIPCION DEL VEHICULO ASEGURADO", "DATOS DE LA PÓLIZA", "DATOS DE LA POLIZA", "VIGENCIA", "COBERTURAS CONTRATADAS"]),
      findLineIndexContaining(lines.slice(headingIndex + 1), ["INFORMACIÓN IMPORTANTE", "INFORMACION IMPORTANTE"]),
    ]
      .filter((index) => index >= 0)
      .map((index) => headingIndex + 1 + index);

    const endIndex = endIndexCandidates.length ? Math.min(...endIndexCandidates) : Math.min(lines.length, headingIndex + 8);
    const block = lines.slice(headingIndex + 1, endIndex);
    const blockText = block.join(" ");
    const addressValue = extractAddressFromBlock(block);
    const hasRfc = /\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/i.test(blockText);
    const hasName = /^[A-ZÁÉÍÓÚÜÑ ,.'-]{8,}$/.test(block[0] ?? "") || block.some((line) => /^[A-ZÁÉÍÓÚÜÑ ,.'-]{8,}$/.test(line));
    const hasMeaningfulAddress = Boolean(addressValue);
    const hasBlankAddress = /domicilio:\s*(?:r\.?f\.?c\.?:)?\s*$/i.test(blockText);
    const hasBoilerplate = /informaci[oó]n importante|condiciones generales aplicables|aviso de privacidad/i.test(blockText);

    let score = 0;
    if (hasName) score += 2;
    if (hasRfc) score += 4;
    if (hasMeaningfulAddress) score += 5;
    if (hasBlankAddress) score -= 6;
    if (hasBoilerplate) score -= 3;

    if (score > bestScore) {
      bestScore = score;
      bestBlock = block;
    }
  }

  return bestBlock;
}

function parseClientAddress(lines: string[]): { value: string | null; confidence: FieldConfidence } {
  const block = getInsuredBlock(lines);
  const addressValue = extractAddressFromBlock(block);
  if (addressValue) return { value: addressValue, confidence: "high" };

  return { value: null, confidence: "low" };
}

function parsePremiumAmount(lines: string[], fullText: string): { value: number; confidence: FieldConfidence } {
  const preferredLabels = [
    "IMPORTE TOTAL",
    "Prima total",
    "Prima anual total",
    "Total prima",
    "Prima anual",
    "Prima neta",
    "Importe total",
    "Prima",
  ];

  for (const label of preferredLabels) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!normalizeText(line).includes(normalizeText(label))) continue;
      if (label === "Prima" && /suma asegurada|coberturas contratadas|coberturas/i.test(line)) continue;

      const window = [line, lines[index + 1], lines[index + 2]].filter(Boolean).join(" ");
      const sameLineAmounts = extractMoneyValues(line);
      if (sameLineAmounts.length > 0) {
        const selected = label === "IMPORTE TOTAL" || /total|importe/i.test(label) ? sameLineAmounts.at(-1) ?? sameLineAmounts[0] : sameLineAmounts[0];
        return { value: selected, confidence: "high" };
      }

      const suffix = compact(window.slice(window.toLowerCase().indexOf(label.toLowerCase()) + label.length));
      const amounts = extractMoneyValues(suffix);
      if (amounts.length > 0) {
        const selected = label === "IMPORTE TOTAL" || /total|importe/i.test(label) ? amounts.at(-1) ?? amounts[0] : amounts[0];
        return { value: selected, confidence: "high" };
      }
    }
  }

  const fallbackLine = lines.find((line) => /\$\s?[\d.,]+/.test(line) && !/suma asegurada|suma asegurada fija/i.test(line));
  const amount = parseMoney(
    fallbackLine?.match(/\$\s?[\d.,]+(?:\.\d{2})?/)?.[0] ??
      fallbackLine?.match(/\b[\d.,]+\b/)?.[0] ??
      fullText.match(/\$\s?[\d.,]+(?:\.\d{2})?/)?.[0] ??
      null,
  );
  return amount !== null ? { value: amount, confidence: "medium" } : { value: 0, confidence: "low" };
}

function parseRequestNumber(text: string, policyNumber: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => compact(line))
    .filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    if (!/\b(solicitud|request|no\.?\s+de\s+solicitud|no\.?\s+solicitud)\b/i.test(lines[index])) continue;
    const candidates = [lines[index], lines[index + 1], lines[index + 2]];
    const request = candidates
      .map((line) => line?.match(/\b\d{6,}\b/)?.[0] ?? null)
      .find((value) => Boolean(value && value !== policyNumber));
    if (request) return request;
  }

  return null;
}

function parseSerialNumber(lines: string[], fullText: string) {
  const vinMatch =
    fullText.match(/\b([A-HJ-NPR-Z0-9]{17})\b/) ??
    lines.map((line) => line.match(/\b([A-HJ-NPR-Z0-9]{17})\b/)).find((match) => Boolean(match?.[1]));
  if (vinMatch?.[1]) return vinMatch[1].toUpperCase();

  const labels = ["Serie", "Número de serie", "Numero de serie", "No. Serie", "No Serie"];
  const line = extractLineContaining(lines, labels);
  if (!line) return null;

  const match = line.match(/\b(?:Serie|Número de serie|Numero de serie|No\.?\s*Serie)\s*[:\-]?\s*([A-Z0-9-]{8,})/i);
  if (match?.[1]) return compact(match[1]).replace(/\s+/g, "");

  const fallback = line.match(/\b([A-Z0-9]{12,24})\b/);
  return fallback?.[1] ?? null;
}

function parseAutoInsuredObject(lines: string[]) {
  const headingIndex = lines.findIndex((line) => normalizeText(line).includes("descripcion del vehiculo asegurado"));
  if (headingIndex >= 0) {
    const candidate = [lines[headingIndex + 1], lines[headingIndex + 2], lines[headingIndex + 3]]
      .filter(Boolean)
      .join(" ");
    if (candidate) return compact(candidate);
  }

  const vehicleLine = lines.find((line) =>
    /[A-Z0-9].+\b(AUT\.?|AUTOMOVIL|CAMIONETA|SEDAN|SUV|PICKUP|VAN)\b/i.test(line),
  );
  return vehicleLine ? compact(vehicleLine) : null;
}

function parsePolicyType(lines: string[], fullText: string): string {
  const normalizedFullText = normalizeText(fullText);
  if (
    normalizedFullText.includes("automoviles") ||
    normalizedFullText.includes("automovil") ||
    normalizedFullText.includes("vehiculo asegurado") ||
    normalizedFullText.includes("descripcion del vehiculo asegurado")
  ) {
    return "AUTO";
  }

  const labeled = extractInlineValue(lines, ["Ramo", "Tipo", "Subramo"]);
  return normalizePolicyType(labeled ?? (normalizedFullText.includes("gmm") ? "GMM" : ""));
}

function parseClientBirthDate(lines: string[]) {
  const labels = ["Fecha de nacimiento", "Fecha nacimiento", "Nacimiento", "F. Nac.", "DOB", "Date of Birth"];
  const inline = extractDateFromMatchingLine(lines, labels, "first");
  if (inline) return inline;
  const nearby = extractValueFromLabelWindow(lines, labels, 1);
  return normalizeDateString(nearby) ?? extractSpanishDate(nearby);
}

function parseSourcePolicyNumber(lines: string[], fullText: string, policyNumber: string) {
  const labeled = extractValueFromLabelWindow(lines, ["RENUEVA A", "Renueva a", "Póliza origen", "Poliza origen", "Vigencia anterior"], 2);
  if (labeled) {
    const match = labeled.match(/\b(\d{8,12})\b/);
    if (match?.[1] && match[1] !== policyNumber) return match[1];
  }

  const explicit = fullText.match(/\bRENUEVA A:\s*(\d{8,12})\b/i);
  if (explicit?.[1] && explicit[1] !== policyNumber) return explicit[1];

  return suggestPreviousPolicyNumber(policyNumber);
}

export function extractPolicyPdfReceiptEvidence(text: string): PolicyPdfCaptureReceiptEvidence | null {
  const fullText = compact(text);
  const normalized = normalizeText(fullText);
  if (!normalized.includes("aviso de cobro") && !normalized.includes("ficha de deposito") && !normalized.includes("numero control")) {
    return null;
  }

  const policyNumber = fullText.match(/p[oó]liza(?:\s+endoso)?\s*[:#]?\s*(\d{8,12})/i)?.[1]
    ?? fullText.match(/PÓLIZA\s+ENDOSO[^\n]*?(\d{8,12})/i)?.[1]
    ?? null;
  const receiptControlNumber = fullText.match(/n[uú]mero\s+control\s+([0-9]{6,})/i)?.[1] ?? null;
  const dueDate = normalizeDateString(
    fullText.match(/fecha\s+de\s+vencimiento[^\d]*(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1] ?? null,
  );
  const periodLabel = fullText.match(/serie\s+\d{1,2}\s*\/\s*\d{1,2}/i)?.[0]?.replace(/serie\s+/i, "") ?? null;
  const amountFromLabel = (label: RegExp) => {
    const match = fullText.match(label);
    return match?.[1] ? parseMoney(match[1]) : null;
  };
  const amountDue = amountFromLabel(/total\s+a\s+pagar\s*\$?\s*([\d.,]+)/i);
  const depositAmount = amountFromLabel(/ficha\s+de\s+(?:pago|deposito)[^]*?total\s+a\s+pagar\s*\$?\s*([\d.,]+)/i);
  const warnings: string[] = [];
  if (amountDue !== null && depositAmount !== null && Math.abs(amountDue - depositAmount) > 0.009) {
    warnings.push(`El aviso indica ${amountDue.toFixed(2)} y la ficha de depósito ${depositAmount.toFixed(2)}.`);
  }
  if (!policyNumber) warnings.push("No pudimos vincular el recibo con un número de póliza.");
  if (!receiptControlNumber) warnings.push("No pudimos detectar el número de control del recibo.");

  return {
    policyNumber,
    receiptControlNumber,
    dueDate,
    periodLabel,
    amountDue,
    depositAmount,
    currency: normalized.includes("pesos") || normalized.includes("mxn") ? "MXN" : "MXN",
    paymentMethod: fullText.match(/forma\s+de\s+pago\s+([A-ZÁÉÍÓÚÜÑ ]+)/i)?.[1]?.trim() ?? null,
    paymentConfirmed: false,
    warnings,
  };
}

export function suggestPreviousPolicyNumber(policyNumber: string) {
  const match = policyNumber.match(/^(.*?U)(\d{2})$/i);
  if (!match) return null;

  const prefix = match[1];
  const current = Number(match[2]);
  if (!Number.isFinite(current) || current <= 0) return null;
  return `${prefix}${String(current - 1).padStart(2, "0")}`;
}

export function extractPolicyPdfDraftFromText(text: string): PolicyPdfCaptureDraft {
  const lines = text
    .split(/\r?\n/)
    .map((line) => compact(line))
    .filter(Boolean);
  const fullText = compact(text);

  const policyNumber = parsePolicyNumber(lines);
  const clientNameResult = parseInsuredName(lines);
  const clientRfcResult = parseClientRfc(lines);
  const clientPhoneResult = parseClientPhone(lines);
  const clientEmailResult = parseClientEmail(lines);
  const clientAddressResult = parseClientAddress(lines);
  const clientBirthDate = parseClientBirthDate(lines);
  const clientContext = (() => {
    const nameIndex = clientNameResult.value
      ? lines.findIndex((line) => normalizeText(line).includes(normalizeText(clientNameResult.value)))
      : -1;
    const clientRfcValue = clientRfcResult.value ?? "";
    const rfcIndex = clientRfcValue ? lines.findIndex((line) => normalizeText(line).includes(normalizeText(clientRfcValue))) : -1;
    const startIndex = [nameIndex, rfcIndex].filter((value) => value >= 0).sort((a, b) => a - b)[0] ?? -1;
    if (startIndex < 0) return "";
    return lines.slice(startIndex, Math.min(lines.length, startIndex + 4)).join(" ");
  })();
  const clientType = inferClientType(clientNameResult.value || "", clientRfcResult.value, clientContext);
  const normalizedFullText = normalizeText(fullText);
  const insurerNameResult = parseInsurerName(lines, fullText);
  const policyType = parsePolicyType(lines, fullText);
  const paymentFrequency = (() => {
    for (const line of lines) {
      const normalizedLine = normalizeText(line);
      if (/tasa financiamiento/.test(normalizedLine)) continue;
      if (/\bsemestral\b/.test(normalizedLine)) return "SEMIANNUAL";
      if (/\btrimestral\b/.test(normalizedLine)) return "QUARTERLY";
      if (/\bmensual\b/.test(normalizedLine)) return "MONTHLY";
      if (/\banual\b/.test(normalizedLine)) return "ANNUAL";
      if (/\bpago\s+unico\b/.test(normalizedLine) || /\bcontado\b/.test(normalizedLine)) return "ANNUAL";
    }
    return normalizePaymentFrequency(
      extractInlineValue(lines, ["Frecuencia", "Periodicidad", "Forma de Pago", "Forma de pago"]) ??
        (normalizedFullText.includes("anual") ? "Anual" : ""),
    );
  })();
  const paymentPlan = extractInlineValue(lines, ["Plan de pago"]) ?? null;
  const requestNumber = parseRequestNumber(text, policyNumber);

  const startDate =
    extractDateFromMatchingLine(lines, ["Fecha de inicio de vigencia", "Inicio de vigencia", "Inicio Vigencia", "Vigencia Desde", "Desde"], "first") ??
    extractDatesFromLine(
      extractLineContaining(lines, ["Vigencia"]) ??
        lines.find((line) => /\b\d{1,2}[/-]\d{2}[/-]\d{4}\b/.test(line) && /al|a|hasta|-/i.test(line)) ??
        null,
    )[0] ??
    null;
  const endDate =
    extractDateFromMatchingLine(lines, ["Fecha de fin de vigencia", "Fin de vigencia", "Fin Vigencia", "Vigencia Hasta", "Hasta"], "last") ??
    extractDatesFromLine(
      extractLineContaining(lines, ["Vigencia"]) ??
        lines.find((line) => /\b\d{1,2}[/-]\d{2}[/-]\d{4}\b/.test(line) && /al|a|hasta|-/i.test(line)) ??
        null,
    ).at(-1) ??
    null;

  const policyDataSectionIndex = findLastLineIndexContaining(lines, ["DATOS DE LA PÓLIZA", "DATOS DE LA POLIZA"]);
  const policyDataSection = policyDataSectionIndex >= 0 ? lines.slice(policyDataSectionIndex, policyDataSectionIndex + 18) : lines;
  const issueLabels = ["Fecha de emisión", "Fecha de emision", "Emisión", "Emision"];
  const issueLine =
    extractLineContaining(policyDataSection, issueLabels) ??
    extractLineContaining(lines, issueLabels) ??
    extractLineContaining(lines, ["Condiciones generales aplicables", "Condiciones Generales aplicables"]) ??
    extractLineContaining(lines, ["Expedición", "Expedicion"]) ??
    extractLineContaining(lines, ["a partir del día", "a partir del dia"]);
  const issueDate =
    normalizeDateString(issueLine?.match(/\b(\d{1,2}[/-]\d{2}[/-]\d{4})\b/)?.[1] ?? null) ??
    extractSpanishDate(issueLine) ??
    normalizeDateString(issueLine) ??
    extractSpanishDate(fullText);

  const premiumResult = parsePremiumAmount(lines, fullText);
  const serialNumber = policyType === "AUTO" ? parseSerialNumber(lines, fullText) : null;
  const insuredObject =
    policyType === "GMM"
      ? null
      : extractInlineValue(lines, ["Objeto asegurado", "Bien asegurado"]) ??
        (policyType === "AUTO" ? parseAutoInsuredObject(lines) : null);
  const beneficiaryCandidate = extractInlineValue(lines, ["Beneficiarios", "Beneficiario"]);
  const beneficiaryInfo =
    beneficiaryCandidate && beneficiaryCandidate.length <= 180 && !/^(en nuestra|nuestra|coberturas|condiciones|pol[ií]za|seguros)/i.test(beneficiaryCandidate)
      ? beneficiaryCandidate
      : null;
  const notes = [requestNumber ? `Solicitud ${requestNumber}` : null, issueDate ? `Emisión ${issueDate}` : null]
    .filter(Boolean)
    .join(" · ") || null;

  return {
    policyNumber,
    clientName: clientNameResult.value,
    clientType,
    clientEmail: clientEmailResult.value,
    clientPhone: clientPhoneResult.value,
    clientAddress: clientAddressResult.value,
    clientRfc: clientRfcResult.value,
    clientBirthDate,
    insurerName: insurerNameResult.value,
    policyType,
    serialNumber,
    startDate: startDate ?? "",
    endDate: endDate ?? "",
    issueDate,
    paymentFrequency,
    paymentPlan,
    premiumAmount: premiumResult.value,
    currency: "MXN",
    requestNumber,
    insuredObject,
    beneficiaryInfo,
    notes,
    sourcePolicyNumber: parseSourcePolicyNumber(lines, fullText, policyNumber),
  };
}

function includesAnyLabel(lines: string[], labels: string[]) {
  const normalizedLabels = labels.map((label) => normalizeText(label));
  return lines.some((line) => {
    const normalizedLine = normalizeText(line);
    return normalizedLabels.some((label) => normalizedLine.includes(label));
  });
}

function valueLooksLikeRfc(value: string | null | undefined) {
  return Boolean(value && /\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/i.test(value));
}

export function buildPolicyPdfCaptureFieldConfidence(text: string, draft: PolicyPdfCaptureDraft): PolicyPdfCaptureFieldConfidence {
  const lines = text
    .split(/\r?\n/)
    .map((line) => compact(line))
    .filter(Boolean);
  const fullText = normalizeText(text);
  const hasClientLabel = includesAnyLabel(lines, [
    "INFORMACIÓN DEL ASEGURADO",
    "INFORMACION DEL ASEGURADO",
    "DATOS DEL ASEGURADO",
    "Razón Social o Contratante",
    "Razon Social o Contratante",
    "Contratante",
    "Nombre del Contratante",
    "Asegurado titular",
    "Asegurado",
    "Titular",
    "Nombre del asegurado",
  ]);
  const hasInsurerLabel = includesAnyLabel(lines, ["Aseguradora", "Compañía", "Compañia"]);
  const hasAddressLabel = includesAnyLabel(lines, ["Domicilio", "Dirección", "Direccion"]);
  const hasBirthDateLabel = includesAnyLabel(lines, ["Fecha de nacimiento", "Fecha nacimiento", "Nacimiento", "F. Nac.", "DOB", "Date of Birth"]);
  const hasPremiumLabel = includesAnyLabel(lines, ["Prima total", "Prima anual", "Prima", "Importe total"]);
  const hasIssueLabel = includesAnyLabel(lines, [
    "Condiciones generales aplicables",
    "Fecha de emisión",
    "Fecha de emision",
    "Emisión",
    "Emision",
    "Expedición",
    "Expedicion",
  ]);
  const hasDateLabel = includesAnyLabel(lines, ["Vigencia", "Fecha de inicio de vigencia", "Fecha de fin de vigencia", "Inicio de vigencia", "Inicio Vigencia", "Fin de vigencia", "Fin Vigencia"]);
  const hasSourceLabel = includesAnyLabel(lines, ["Póliza", "Poliza", "Solicitud", "Serie"]);

  return {
    policyNumber: draft.policyNumber ? "high" : "low",
    clientName: draft.clientName ? (hasClientLabel ? "high" : "medium") : "low",
    clientType: draft.clientType ? "high" : "low",
    clientEmail: draft.clientEmail ? (includesAnyLabel(lines, ["Correo", "Email", "E-mail"]) ? "high" : "medium") : "low",
    clientPhone: draft.clientPhone ? (includesAnyLabel(lines, ["Teléfono", "Telefono", "Celular"]) ? "high" : "medium") : "low",
    clientAddress: draft.clientAddress ? (hasAddressLabel ? "high" : "medium") : "low",
    clientRfc: draft.clientRfc ? (includesAnyLabel(lines, ["RFC", "R.F.C.", "Registro Federal de Contribuyentes"]) && valueLooksLikeRfc(draft.clientRfc) ? "high" : "medium") : "low",
    clientBirthDate: draft.clientBirthDate ? (hasBirthDateLabel ? "high" : "medium") : "low",
    insurerName: draft.insurerName ? (hasInsurerLabel || /qualitas|axa seguros|seguros/i.test(fullText) ? "high" : "medium") : "low",
    policyType: draft.policyType ? "high" : "low",
    serialNumber: draft.serialNumber ? (includesAnyLabel(lines, ["Serie", "Numero de serie", "Número de serie", "No. Serie"]) ? "high" : "medium") : "low",
    startDate: draft.startDate ? (hasDateLabel ? "high" : "medium") : "low",
    endDate: draft.endDate ? (hasDateLabel ? "high" : "medium") : "low",
    issueDate: draft.issueDate ? (hasIssueLabel ? "high" : "medium") : "low",
    paymentFrequency: draft.paymentFrequency ? "high" : "low",
    premiumAmount: draft.premiumAmount > 0 ? (hasPremiumLabel ? "high" : "medium") : "low",
    sourcePolicyNumber: draft.sourcePolicyNumber ? (hasSourceLabel ? "high" : "medium") : "low",
  };
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
