import { createHash } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import * as XLSX from "@e965/xlsx";
import type { PrismaClient, Prisma, EndorsementStatus } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { businessStartOfDay, parseBusinessDateInput } from "@/lib/business-dates";
import { toNumber } from "@/lib/money";
import { PaymentConflictError, recordPayment } from "@/lib/payment-service";
import { writeActivityLog } from "@/lib/activity-log";
import { findMatchingSuppressionRule } from "@/lib/data-quality-rules";

type DbClient = PrismaClient | Prisma.TransactionClient;

type PolicyLedgerRow = {
  rowNumber: number;
  policyNumber: string;
  policyKey: string;
  receiptNumber: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  endorsementNumber: string;
  endorsementType: string;
  endorsementConcept: string;
  rawClient: string;
  contractorName: string;
  insuredName: string;
  description: string;
  model: string;
  serial: string;
  subramo: string;
  insurerName: string;
  policyStart: Date | null;
  policyEnd: Date | null;
  paymentFrequency: string;
  paidFlag: string;
  paidDate: Date | null;
  currency: string;
  totalAmount: number;
  status: string;
};

type PaidLedgerRow = {
  rowNumber: number;
  policyNumber: string;
  policyKey: string;
  receiptNumber: string;
  insurerName: string;
  clientName: string;
  paidDate: Date | null;
  originalPaidDate: Date | null;
  totalPaid: number;
  overrideNote: string | null;
};

type MatchState = "MATCHED" | "AMBIGUOUS" | "UNMATCHED" | "REVIEW";

type PaidDecision = {
  state: MatchState | "READY" | "ALREADY_APPLIED";
  action: string;
  status: string;
  receiptId?: string;
  policyId?: string;
  paymentId?: string;
  issue?: {
    type: string;
    severity: string;
    message: string;
  };
};

export type LedgerEndorsementPlanState = "CREATED" | "UPDATED" | "UNCHANGED" | "REVIEW_REQUIRED";

export type LedgerEndorsementSourceRow = {
  rowNumber: number;
  policyNumber: string;
  contractorName: string;
  insurerName: string;
  policyStart: Date | null;
  policyEnd: Date | null;
  receiptNumber: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  endorsementNumber: string;
  endorsementType: string;
  endorsementConcept: string;
  description: string;
  currency: string;
  totalAmount: number;
  status: string;
};

export type LedgerEndorsementPolicyCandidate = {
  id: string;
  policyNumber: string;
  startDate: Date;
  endDate: Date;
  clientName: string;
  insurerName: string;
};

export type LedgerEndorsementReceiptCandidate = {
  id: string;
  policyId: string;
  receiptNumber: string;
  periodStartDate: Date;
  periodEndDate: Date;
  endorsementId: string | null;
};

export type LedgerExistingEndorsement = {
  id: string;
  policyId: string;
  endorsementNumber: string;
  status: string;
  startDate: Date;
  endDate: Date;
  amount: number;
  currency: string;
  reference: string | null;
  concept: string | null;
};

export type LedgerEndorsementData = Omit<LedgerExistingEndorsement, "id" | "policyId">;

export type LedgerEndorsementDecision = {
  rowNumber: number;
  state: LedgerEndorsementPlanState;
  action: string;
  status: string;
  metricKey: string;
  policyId?: string;
  receiptId?: string;
  endorsementId?: string;
  data?: LedgerEndorsementData;
  issue?: {
    type: string;
    severity: string;
    message: string;
  };
};

export type LedgerEndorsementMetrics = {
  created: number;
  updated: number;
  unchanged: number;
  reviewRequired: number;
};

export type LedgerImportPreviewSummary = {
  policyRows: number;
  paidRows: number;
  policiesMatched: number;
  policiesMissing: number;
  policiesOverLong: number;
  endorsementsCreated: number;
  endorsementsUpdated: number;
  endorsementsUnchanged: number;
  endorsementsReviewRequired: number;
  paymentsMatched: number;
  paymentsReadyToApply: number;
  paymentsAlreadyApplied: number;
  paymentsAmbiguous: number;
  paymentsUnmatched: number;
  paymentsInReview: number;
  reviewIssues: number;
  sampleIssues: Array<{
    type: string;
    severity: string;
    message: string;
    sourceType: string;
    rowNumber: number;
    sourceKey: string;
  }>;
};

export type LedgerImportPreviewResult = {
  batchId: string;
  summary: LedgerImportPreviewSummary;
};

export type LedgerImportApplyResult = {
  batchId: string;
  summary: LedgerImportPreviewSummary & {
    endorsementsApplied: number;
    endorsementsSkipped: number;
    endorsementsFailed: number;
    paymentsApplied: number;
    paymentsSkipped: number;
    paymentsFailed: number;
  };
};

function cleanText(value: unknown) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(value: string) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function normalizePolicyNumber(value: string) {
  const compact = cleanText(value).replace(/\s+/g, "").toUpperCase();
  return compact.replace(/^0+(?=\d)/, "");
}

function dateKey(date: Date | null | undefined) {
  return date ? date.toISOString().slice(0, 10) : "";
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return businessStartOfDay(value);
  }

  const text = cleanText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return parseBusinessDateInput(text);
  }

  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;

  const [, day, month, year] = match;
  return parseBusinessDateInput(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
}

function sameDate(left: Date | null | undefined, right: Date | null | undefined) {
  return dateKey(left) === dateKey(right);
}

function parseMoney(value: unknown) {
  const text = cleanText(value).replace(/,/g, "");
  if (!text) return 0;
  const amount = Number(text);
  return Number.isFinite(amount) ? amount : 0;
}

function mapCurrency(value: string) {
  return normalizeName(value).includes("DOLAR") ? "USD" : "MXN";
}

function mapEndorsementStatus(value: string, endDate: Date, now: Date): EndorsementStatus {
  const normalized = normalizeName(value);
  if (normalized === "CANCELADO") return "CANCELLED";
  if (normalized === "PENDIENTE") return "PENDING";
  if (endDate < businessStartOfDay(now)) return "EXPIRED";
  return "ACTIVE";
}

function nullableText(value: string) {
  const text = cleanText(value);
  return text || null;
}

function endorsementDataKey(data: LedgerEndorsementData) {
  return [
    cleanText(data.endorsementNumber),
    data.status,
    dateKey(data.startDate),
    dateKey(data.endDate),
    Math.round(data.amount * 100),
    data.currency,
    cleanText(data.reference),
    cleanText(data.concept),
  ].join("|");
}

function sameEndorsementData(existing: LedgerExistingEndorsement, planned: LedgerEndorsementData) {
  return endorsementDataKey(existing) === endorsementDataKey(planned);
}

function endorsementIssue(
  row: LedgerEndorsementSourceRow,
  type: string,
  message: string,
  metricKey = `row:${row.rowNumber}`,
): LedgerEndorsementDecision {
  return {
    rowNumber: row.rowNumber,
    state: "REVIEW_REQUIRED",
    action: `REVIEW_${type}`,
    status: "REVIEW",
    metricKey,
    issue: { type, severity: "WARNING", message },
  };
}

export function summarizeLedgerEndorsementDecisions(
  decisions: LedgerEndorsementDecision[],
): LedgerEndorsementMetrics {
  const states = new Map<string, LedgerEndorsementPlanState>();
  for (const decision of decisions) states.set(decision.metricKey, decision.state);

  return {
    created: Array.from(states.values()).filter((state) => state === "CREATED").length,
    updated: Array.from(states.values()).filter((state) => state === "UPDATED").length,
    unchanged: Array.from(states.values()).filter((state) => state === "UNCHANGED").length,
    reviewRequired: Array.from(states.values()).filter((state) => state === "REVIEW_REQUIRED").length,
  };
}

export function planLedgerEndorsements(input: {
  rows: LedgerEndorsementSourceRow[];
  policies: LedgerEndorsementPolicyCandidate[];
  receipts: LedgerEndorsementReceiptCandidate[];
  existingEndorsements: LedgerExistingEndorsement[];
  now: Date;
}) {
  const resolved: Array<{
    row: LedgerEndorsementSourceRow;
    policy: LedgerEndorsementPolicyCandidate;
    receipt: LedgerEndorsementReceiptCandidate;
    metricKey: string;
    data: LedgerEndorsementData;
  }> = [];
  const decisions: LedgerEndorsementDecision[] = [];

  for (const row of input.rows.filter((candidate) => cleanText(candidate.endorsementNumber))) {
    const policyStart = row.policyStart ?? row.periodStart;
    const policyEnd = row.policyEnd ?? row.periodEnd;
    const policyCandidates = input.policies
      .filter((policy) => normalizePolicyNumber(policy.policyNumber) === normalizePolicyNumber(row.policyNumber))
      .filter((policy) => !policyStart || sameDate(policy.startDate, policyStart))
      .filter((policy) => !policyEnd || sameDate(policy.endDate, policyEnd))
      .filter((policy) => !row.contractorName || normalizeName(policy.clientName) === normalizeName(row.contractorName))
      .filter((policy) => !row.insurerName || normalizeName(policy.insurerName) === normalizeName(row.insurerName));

    if (!policyCandidates.length) {
      decisions.push(endorsementIssue(row, "ENDORSEMENT_POLICY_NOT_FOUND", "No se encontró una póliza inequívoca para el endoso."));
      continue;
    }
    if (policyCandidates.length > 1) {
      decisions.push(endorsementIssue(row, "ENDORSEMENT_POLICY_AMBIGUOUS", "El endoso coincide con varias pólizas y requiere revisión."));
      continue;
    }
    if (!row.receiptNumber || !row.periodStart || !row.periodEnd) {
      decisions.push(endorsementIssue(row, "ENDORSEMENT_RECEIPT_NOT_FOUND", "El endoso no tiene recibo y vigencia suficientes para enlazarlo."));
      continue;
    }

    const policy = policyCandidates[0];
    const metricKey = `${policy.id}|${cleanText(row.endorsementNumber)}`;
    const receiptCandidates = input.receipts
      .filter((receipt) => receipt.policyId === policy.id)
      .filter((receipt) => cleanText(receipt.receiptNumber) === cleanText(row.receiptNumber))
      .filter((receipt) => sameDate(receipt.periodStartDate, row.periodStart))
      .filter((receipt) => sameDate(receipt.periodEndDate, row.periodEnd));

    if (!receiptCandidates.length) {
      decisions.push(endorsementIssue(row, "ENDORSEMENT_RECEIPT_NOT_FOUND", "No se encontró el recibo exacto que debe enlazarse al endoso.", metricKey));
      continue;
    }
    if (receiptCandidates.length > 1) {
      decisions.push(endorsementIssue(row, "ENDORSEMENT_RECEIPT_AMBIGUOUS", "El endoso coincide con varios recibos y requiere revisión.", metricKey));
      continue;
    }

    resolved.push({
      row,
      policy,
      receipt: receiptCandidates[0],
      metricKey,
      data: {
        endorsementNumber: cleanText(row.endorsementNumber),
        status: mapEndorsementStatus(row.status, row.periodEnd, input.now),
        startDate: row.periodStart,
        endDate: row.periodEnd,
        amount: row.totalAmount,
        currency: mapCurrency(row.currency),
        reference: nullableText(row.endorsementType),
        concept: nullableText(row.endorsementConcept || row.description),
      },
    });
  }

  const groups = new Map<string, typeof resolved>();
  for (const item of resolved) {
    const group = groups.get(item.metricKey) ?? [];
    group.push(item);
    groups.set(item.metricKey, group);
  }
  const receiptGroups = new Map<string, Set<string>>();
  for (const item of resolved) {
    const groupKeys = receiptGroups.get(item.receipt.id) ?? new Set<string>();
    groupKeys.add(item.metricKey);
    receiptGroups.set(item.receipt.id, groupKeys);
  }

  for (const [metricKey, group] of groups) {
    const first = group[0];
    const sourceVariants = new Set(group.map((item) => endorsementDataKey(item.data)));
    if (sourceVariants.size > 1) {
      for (const item of group) {
        decisions.push(endorsementIssue(item.row, "ENDORSEMENT_SOURCE_CONFLICT", "El mismo número de endoso trae datos incompatibles en el ledger.", metricKey));
      }
      continue;
    }
    if (group.some((item) => (receiptGroups.get(item.receipt.id)?.size ?? 0) > 1)) {
      for (const item of group) {
        decisions.push(endorsementIssue(item.row, "ENDORSEMENT_RECEIPT_CONFLICT", "El mismo recibo apunta a más de un endoso.", metricKey));
      }
      continue;
    }

    const existingMatches = input.existingEndorsements.filter(
      (endorsement) => endorsement.policyId === first.policy.id && cleanText(endorsement.endorsementNumber) === first.data.endorsementNumber,
    );
    if (existingMatches.length > 1) {
      for (const item of group) {
        decisions.push(endorsementIssue(item.row, "ENDORSEMENT_AMBIGUOUS", "Hay más de un endoso existente con la misma llave.", metricKey));
      }
      continue;
    }

    const existing = existingMatches[0];
    if (group.some((item) => item.receipt.endorsementId && item.receipt.endorsementId !== existing?.id)) {
      for (const item of group) {
        decisions.push(endorsementIssue(item.row, "ENDORSEMENT_RECEIPT_CONFLICT", "El recibo ya está enlazado a otro endoso; no se modificó.", metricKey));
      }
      continue;
    }

    const state: LedgerEndorsementPlanState = !existing
      ? "CREATED"
      : sameEndorsementData(existing, first.data)
        ? "UNCHANGED"
        : "UPDATED";
    for (const item of group) {
      const needsReceiptLink = item.receipt.endorsementId !== existing?.id;
      const needsApply = state !== "UNCHANGED" || needsReceiptLink;
      decisions.push({
        rowNumber: item.row.rowNumber,
        state,
        action: state === "UNCHANGED" && needsReceiptLink ? "LINK_ENDORSEMENT_RECEIPT" : state === "UNCHANGED" ? "NOOP_ENDORSEMENT_UNCHANGED" : "UPSERT_ENDORSEMENT",
        status: needsApply ? "READY" : "APPLIED",
        metricKey,
        policyId: item.policy.id,
        receiptId: item.receipt.id,
        endorsementId: existing?.id,
        data: item.data,
      });
    }
  }

  decisions.sort((left, right) => left.rowNumber - right.rowNumber);
  return { decisions, metrics: summarizeLedgerEndorsementDecisions(decisions) };
}

function hashContent(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function daysBetween(left: Date, right: Date) {
  return Math.round((left.getTime() - right.getTime()) / (1000 * 60 * 60 * 24));
}

function isFutureDate(value: Date | null, now: Date) {
  if (!value) return false;
  const todayKey = dateKey(now);
  return dateKey(value) > todayKey;
}

function sourceEvidenceKeyForPaidRow(row: PaidLedgerRow) {
  return [
    "paid-xls",
    row.policyKey,
    cleanText(row.receiptNumber),
    dateKey(row.paidDate),
    Math.round(row.totalPaid * 100),
    normalizeName(row.clientName),
    normalizeName(row.insurerName),
  ].join("|");
}

function applyPaidDateOverrides(row: Omit<PaidLedgerRow, "originalPaidDate" | "overrideNote">): PaidLedgerRow {
  const originalPaidDate = row.paidDate;
  if (
    row.policyKey === normalizePolicyNumber("2832600022452") &&
    sameDate(row.paidDate, parseBusinessDateInput("2026-06-24"))
  ) {
    return {
      ...row,
      originalPaidDate,
      paidDate: parseBusinessDateInput("2026-04-24"),
      overrideNote: "Override auditado: fecha original 24/06/2026 corregida a 24/04/2026.",
    };
  }

  return {
    ...row,
    originalPaidDate,
    overrideNote: null,
  };
}

function extractPolicyParties(raw: string) {
  const text = cleanText(raw);
  const marker = "ASEGURADO:";
  const markerIndex = text.toUpperCase().indexOf(marker);

  if (markerIndex === -1) {
    return { contractorName: text, insuredName: text };
  }

  const contractorName = cleanText(text.slice(0, markerIndex).replace(/-\s*$/g, ""));
  const insuredName = cleanText(text.slice(markerIndex + marker.length));
  return {
    contractorName: contractorName || text,
    insuredName: insuredName || contractorName || text,
  };
}

function readCsvLedgerRows(fileName: string, buffer: Buffer): PolicyLedgerRow[] {
  const rows = parseCsv(buffer, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as Record<string, unknown>[];

  return rows.map((row, index) => {
    const rawClient = cleanText(row["Cliente"]);
    const { contractorName, insuredName } = extractPolicyParties(rawClient);
    const policyNumber = cleanText(row["No. de Póliza"]);

    return {
      rowNumber: index + 2,
      policyNumber,
      policyKey: normalizePolicyNumber(policyNumber),
      receiptNumber: cleanText(row["No. Recibo"]),
      periodStart: parseDate(row["Ini Vigencia Rec"]),
      periodEnd: parseDate(row["Fin Vigencia Rec"]),
      endorsementNumber: cleanText(row["No. de Endoso"]),
      endorsementType: cleanText(row["Tipo Endoso"]),
      endorsementConcept: cleanText(row["Concepto Endoso"]),
      rawClient,
      contractorName,
      insuredName,
      description: cleanText(row["Descripción"]),
      model: cleanText(row["Modelo"]),
      serial: cleanText(row["Serie"]),
      subramo: cleanText(row["Subramo"]),
      insurerName: cleanText(row["Compañía"]),
      policyStart: parseDate(row["Inicio Vigencia Póliza"]),
      policyEnd: parseDate(row["Fin Vigencia"]),
      paymentFrequency: cleanText(row["Frecuencia Pago"]),
      paidFlag: cleanText(row["Pagado"]),
      paidDate: parseDate(row["Fecha aplicación"]),
      currency: cleanText(row["Moneda"]),
      totalAmount: parseMoney(row["Prima Total Recibo"]),
      status: cleanText(row["Estatus"]),
    };
  });
}

function readWorkbookPolicyRows(buffer: Buffer): PolicyLedgerRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], {
    defval: "",
    raw: false,
  });

  return rows.map((row, index) => {
    const rawClient = cleanText(row["Cliente"]);
    const { contractorName, insuredName } = extractPolicyParties(rawClient);
    const policyNumber = cleanText(row["No. de Póliza"]);

    return {
      rowNumber: index + 2,
      policyNumber,
      policyKey: normalizePolicyNumber(policyNumber),
      receiptNumber: cleanText(row["No. Recibo"]),
      periodStart: parseDate(row["Ini Vigencia Rec"]),
      periodEnd: parseDate(row["Fin Vigencia Rec"]),
      endorsementNumber: cleanText(row["No. de Endoso"]),
      endorsementType: cleanText(row["Tipo Endoso"]),
      endorsementConcept: cleanText(row["Concepto Endoso"]),
      rawClient,
      contractorName,
      insuredName,
      description: cleanText(row["Descripción"]),
      model: cleanText(row["Modelo"]),
      serial: cleanText(row["Serie"]),
      subramo: cleanText(row["Subramo"]),
      insurerName: cleanText(row["Compañía"]),
      policyStart: parseDate(row["Inicio Vigencia Póliza"]),
      policyEnd: parseDate(row["Fin Vigencia"]),
      paymentFrequency: cleanText(row["Frecuencia Pago"]),
      paidFlag: cleanText(row["Pagado"]),
      paidDate: parseDate(row["Fecha aplicación"]),
      currency: cleanText(row["Moneda"]),
      totalAmount: parseMoney(row["Prima Total Recibo"]),
      status: cleanText(row["Estatus"]),
    };
  });
}

function readWorkbookLedgerRows(buffer: Buffer): PaidLedgerRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: "",
    raw: false,
  });

  const parsed: PaidLedgerRow[] = [];
  for (const [index, row] of rows.entries()) {
    const policyNumber = cleanText(row[0]);
    const receiptNumber = cleanText(row[3]);
    const insurerName = cleanText(row[4]);
    const clientName = cleanText(row[6]);

    if (!/^\d/.test(policyNumber) || !receiptNumber || !insurerName || !clientName) continue;

    parsed.push(applyPaidDateOverrides({
      rowNumber: index + 1,
      policyNumber,
      policyKey: normalizePolicyNumber(policyNumber),
      receiptNumber,
      insurerName,
      clientName,
      paidDate: parseDate(row[11]),
      totalPaid: parseMoney(row[14]),
    }));
  }

  return parsed;
}

function readLedgerRows(fileName: string, buffer: Buffer) {
  if (fileName.toLowerCase().endsWith(".csv")) {
    return readCsvLedgerRows(fileName, buffer);
  }

  return readWorkbookPolicyRows(buffer);
}

function readPaidRows(fileName: string, buffer: Buffer) {
  if (fileName.toLowerCase().endsWith(".csv")) {
    return readCsvLedgerRows(fileName, buffer).map((row) => applyPaidDateOverrides({
      rowNumber: row.rowNumber,
      policyNumber: row.policyNumber,
      policyKey: row.policyKey,
      receiptNumber: row.receiptNumber,
      insurerName: row.insurerName,
      clientName: row.contractorName,
      paidDate: row.paidDate,
      totalPaid: row.totalAmount,
    }));
  }

  return readWorkbookLedgerRows(buffer);
}

function buildPolicySignature(row: PolicyLedgerRow) {
  return [
    normalizePolicyNumber(row.policyNumber),
    dateKey(row.policyStart ?? row.periodStart),
    dateKey(row.policyEnd ?? row.periodEnd),
    normalizeName(row.contractorName),
    normalizeName(row.insurerName),
  ].join("|");
}

function paidReceiptSourceKey(row: PaidLedgerRow) {
  return sourceEvidenceKeyForPaidRow(row);
}

function paidReceiptIssueSourceKey(row: PaidLedgerRow) {
  return [
    row.policyKey,
    cleanText(row.receiptNumber),
    dateKey(row.paidDate),
    Math.round(row.totalPaid * 100),
  ].join("|");
}

function isPaidDateCompatibleWithReceipt(
  paidDate: Date | null,
  receipt: {
    dueDate: Date;
    periodStartDate: Date;
    periodEndDate: Date;
  },
) {
  if (!paidDate) return false;
  if (sameDate(paidDate, receipt.dueDate)) return true;
  return paidDate >= receipt.periodStartDate && paidDate <= receipt.periodEndDate;
}

function strictReceiptMatch(receipt: {
  receiptNumber: string;
  amount: unknown;
  dueDate: Date;
  periodStartDate: Date;
  periodEndDate: Date;
  policy: {
    policyNumber: string;
    client: { fullName: string };
    insurer: { name: string };
  };
}, row: PaidLedgerRow) {
  return (
    normalizePolicyNumber(receipt.policy.policyNumber) === row.policyKey &&
    cleanText(receipt.receiptNumber) === cleanText(row.receiptNumber) &&
    Math.abs(toNumber(receipt.amount) - row.totalPaid) <= 0.01 &&
    normalizeName(receipt.policy.insurer.name) === normalizeName(row.insurerName) &&
    isPaidDateCompatibleWithReceipt(row.paidDate, receipt)
  );
}

async function storePreviewBatch(input: {
  db: DbClient;
  actorId: string;
  sourceCsvName: string;
  sourceCsvHash: string;
  sourcePaidName: string;
  sourcePaidHash: string;
  summary: LedgerImportPreviewSummary;
  policyRows: PolicyLedgerRow[];
  paidRows: PaidLedgerRow[];
  paidDecisions: Map<number, PaidDecision>;
  endorsementDecisions: Map<number, LedgerEndorsementDecision>;
}) {
  const batch = await input.db.ledgerImportBatch.create({
    data: {
      sourceCsvName: input.sourceCsvName,
      sourceCsvHash: input.sourceCsvHash,
      sourcePaidName: input.sourcePaidName,
      sourcePaidHash: input.sourcePaidHash,
      status: "PREVIEW_READY",
      summaryJson: JSON.stringify(input.summary),
      createdById: input.actorId,
    },
  });

  const rowData = [
      ...input.policyRows.map((row) => {
        const decision = input.endorsementDecisions.get(row.rowNumber);
        return {
          batchId: batch.id,
          sourceType: "POLICY_CSV",
          rowNumber: row.rowNumber,
          sourceKey: buildPolicySignature(row),
          rawJson: JSON.stringify(row),
          normalizedJson: JSON.stringify({
            policyNumber: normalizePolicyNumber(row.policyNumber),
            receiptNumber: row.receiptNumber,
            periodStart: dateKey(row.periodStart),
            periodEnd: dateKey(row.periodEnd),
            contractorName: row.contractorName,
            insuredName: row.insuredName,
            insurerName: row.insurerName,
            endorsementNumber: row.endorsementNumber,
            endorsementType: row.endorsementType,
            endorsementConcept: row.endorsementConcept,
            endorsementPlanState: decision?.state ?? null,
          }),
          action: decision?.action ?? "NO_ENDORSEMENT",
          status: decision?.status ?? "IGNORED",
          policyId: decision?.policyId,
          receiptId: decision?.receiptId,
        };
      }),
      ...input.paidRows.map((row) => {
        const decision = input.paidDecisions.get(row.rowNumber);
        return {
        batchId: batch.id,
        sourceType: "PAID_XLS",
        rowNumber: row.rowNumber,
        sourceKey: paidReceiptSourceKey(row),
        rawJson: JSON.stringify(row),
        normalizedJson: JSON.stringify({
          policyNumber: row.policyKey,
          receiptNumber: row.receiptNumber,
          clientName: row.clientName,
          insurerName: row.insurerName,
          paidDate: dateKey(row.paidDate),
          originalPaidDate: dateKey(row.originalPaidDate),
          totalPaid: row.totalPaid,
          overrideNote: row.overrideNote,
        }),
        action: decision?.action ?? "REVIEW_PAYMENT",
        status: decision?.status ?? "REVIEW",
        policyId: decision?.policyId,
        receiptId: decision?.receiptId,
        paymentId: decision?.paymentId,
      };
    }),
    ];

  if (rowData.length) {
    await input.db.ledgerImportRow.createMany({
      data: rowData,
    });
  }

  return batch;
}

export async function createLedgerImportPreview(input: {
  actorId: string;
  csvName: string;
  csvBuffer: Buffer;
  paidName: string;
  paidBuffer: Buffer;
  db?: DbClient;
  now?: Date;
}): Promise<LedgerImportPreviewResult> {
  const db = input.db ?? getDb();
  const policyRows = readLedgerRows(input.csvName, input.csvBuffer);
  const paidRows = readPaidRows(input.paidName, input.paidBuffer);
  const csvHash = hashContent(input.csvBuffer);
  const paidHash = hashContent(input.paidBuffer);

  const [policies, receipts, existingPayments, existingEndorsements] = await Promise.all([
    db.policy.findMany({
      select: {
        id: true,
        policyNumber: true,
        clientId: true,
        insurerId: true,
        startDate: true,
        endDate: true,
        premiumAmount: true,
        status: true,
        client: { select: { fullName: true } },
        insurer: { select: { name: true } },
      },
    }),
    db.receipt.findMany({
      select: {
        id: true,
        receiptNumber: true,
        amount: true,
        dueDate: true,
        periodStartDate: true,
        periodEndDate: true,
        endorsementId: true,
        policy: {
          select: {
            id: true,
            policyNumber: true,
            client: { select: { fullName: true } },
            insurer: { select: { name: true } },
          },
        },
      },
    }),
    db.payment.findMany({
      where: { sourceEvidenceKey: { not: null } },
      select: { id: true, sourceEvidenceKey: true },
    }),
    db.policyEndorsement.findMany({
      select: {
        id: true,
        policyId: true,
        endorsementNumber: true,
        status: true,
        startDate: true,
        endDate: true,
        amount: true,
        currency: true,
        reference: true,
        concept: true,
      },
    }),
  ]);

  const policyBySignature = new Map<string, typeof policies[number]>();
  for (const policy of policies) {
    const signature = [
      normalizePolicyNumber(policy.policyNumber),
      dateKey(policy.startDate),
      dateKey(policy.endDate),
      normalizeName(policy.client.fullName),
      normalizeName(policy.insurer.name),
    ].join("|");
    policyBySignature.set(signature, policy);
  }

  const longPolicies = policies.filter((policy) => daysBetween(policy.endDate, policy.startDate) > 366);
  const missingPolicyRows = policyRows.filter((row) => !policyBySignature.has(buildPolicySignature(row)));
  const endorsementPlan = planLedgerEndorsements({
    rows: policyRows,
    policies: policies.map((policy) => ({
      id: policy.id,
      policyNumber: policy.policyNumber,
      startDate: policy.startDate,
      endDate: policy.endDate,
      clientName: policy.client.fullName,
      insurerName: policy.insurer.name,
    })),
    receipts: receipts.map((receipt) => ({
      id: receipt.id,
      policyId: receipt.policy.id,
      receiptNumber: receipt.receiptNumber,
      periodStartDate: receipt.periodStartDate,
      periodEndDate: receipt.periodEndDate,
      endorsementId: receipt.endorsementId,
    })),
    existingEndorsements: existingEndorsements.map((endorsement) => ({
      ...endorsement,
      amount: toNumber(endorsement.amount),
    })),
    now: input.now ?? new Date(),
  });
  const endorsementDecisions = new Map(endorsementPlan.decisions.map((decision) => [decision.rowNumber, decision]));

  const existingPaymentByEvidence = new Map(
    existingPayments
      .filter((payment): payment is { id: string; sourceEvidenceKey: string } => Boolean(payment.sourceEvidenceKey))
      .map((payment) => [payment.sourceEvidenceKey, payment]),
  );
  const paidDecisions = new Map<number, PaidDecision>();
  const usedReceiptIds = new Set<string>();
  const usedEvidenceKeys = new Set<string>();
  const matchIssues: Array<{
    type: string;
    severity: string;
    message: string;
    sourceType: string;
    rowNumber: number;
    sourceKey: string;
  }> = [];

  for (const row of paidRows) {
    const sourceKey = paidReceiptIssueSourceKey(row);
    const evidenceKey = sourceEvidenceKeyForPaidRow(row);

    if (existingPaymentByEvidence.has(evidenceKey)) {
      const payment = existingPaymentByEvidence.get(evidenceKey);
      paidDecisions.set(row.rowNumber, {
        state: "ALREADY_APPLIED",
        action: "NOOP_PAYMENT_ALREADY_APPLIED",
        status: "APPLIED",
        paymentId: payment?.id,
      });
      continue;
    }

    if (usedEvidenceKeys.has(evidenceKey)) {
      paidDecisions.set(row.rowNumber, {
        state: "REVIEW",
        action: "REVIEW_DUPLICATE_EVIDENCE",
        status: "REVIEW",
        issue: {
          type: "PAYMENT_DUPLICATE_EVIDENCE",
          severity: "WARNING",
          message: "Esta fila normalizada de pagos está duplicada dentro del XLS y requiere revisión.",
        },
      });
      matchIssues.push({
        type: "PAYMENT_DUPLICATE_EVIDENCE",
        severity: "WARNING",
        message: "Esta fila normalizada de pagos está duplicada dentro del XLS y requiere revisión.",
        sourceType: "PAID_XLS",
        rowNumber: row.rowNumber,
        sourceKey,
      });
      continue;
    }
    usedEvidenceKeys.add(evidenceKey);

    if (row.totalPaid <= 0) {
      paidDecisions.set(row.rowNumber, {
        state: "REVIEW",
        action: "REVIEW_NON_POSITIVE_PAYMENT",
        status: "REVIEW",
        issue: {
          type: "PAYMENT_NON_POSITIVE",
          severity: "WARNING",
          message: "El XLS trae un pago negativo o cero; no se aplicará automáticamente.",
        },
      });
      matchIssues.push({
        type: "PAYMENT_NON_POSITIVE",
        severity: "WARNING",
        message: "El XLS trae un pago negativo o cero; no se aplicará automáticamente.",
        sourceType: "PAID_XLS",
        rowNumber: row.rowNumber,
        sourceKey,
      });
      continue;
    }

    if (!row.paidDate) {
      paidDecisions.set(row.rowNumber, {
        state: "REVIEW",
        action: "REVIEW_MISSING_PAID_DATE",
        status: "REVIEW",
        issue: {
          type: "PAYMENT_MISSING_DATE",
          severity: "WARNING",
          message: "El XLS no trae fecha de pago válida; no se aplicará automáticamente.",
        },
      });
      matchIssues.push({
        type: "PAYMENT_MISSING_DATE",
        severity: "WARNING",
        message: "El XLS no trae fecha de pago válida; no se aplicará automáticamente.",
        sourceType: "PAID_XLS",
        rowNumber: row.rowNumber,
        sourceKey,
      });
      continue;
    }

    if (isFutureDate(row.paidDate, input.now ?? new Date())) {
      paidDecisions.set(row.rowNumber, {
        state: "REVIEW",
        action: "REVIEW_FUTURE_PAYMENT",
        status: "REVIEW",
        issue: {
          type: "PAYMENT_FUTURE_DATE",
          severity: "WARNING",
          message: "El XLS trae una fecha futura; no se aplicará automáticamente.",
        },
      });
      matchIssues.push({
        type: "PAYMENT_FUTURE_DATE",
        severity: "WARNING",
        message: "El XLS trae una fecha futura; no se aplicará automáticamente.",
        sourceType: "PAID_XLS",
        rowNumber: row.rowNumber,
        sourceKey,
      });
      continue;
    }

    const candidates = receipts
      .filter((receipt) => normalizePolicyNumber(receipt.policy.policyNumber) === row.policyKey)
      .filter((receipt) => cleanText(receipt.receiptNumber) === cleanText(row.receiptNumber))
      .filter((receipt) => strictReceiptMatch(receipt, row));

    if (!candidates.length) {
      paidDecisions.set(row.rowNumber, {
        state: "UNMATCHED",
        action: "REVIEW_PAYMENT_UNMATCHED",
        status: "REVIEW",
        issue: {
          type: "PAYMENT_UNMATCHED",
          severity: "WARNING",
          message: "No se encontró un recibo compatible por póliza, recibo, aseguradora, importe y fecha/periodo.",
        },
      });
      matchIssues.push({
        type: "PAYMENT_UNMATCHED",
        severity: "WARNING",
        message: "No se encontró un recibo compatible por póliza, recibo, aseguradora, importe y fecha/periodo.",
        sourceType: "PAID_XLS",
        rowNumber: row.rowNumber,
        sourceKey,
      });
      continue;
    }

    if (candidates.length > 1) {
      paidDecisions.set(row.rowNumber, {
        state: "AMBIGUOUS",
        action: "REVIEW_PAYMENT_AMBIGUOUS",
        status: "REVIEW",
        issue: {
          type: "PAYMENT_AMBIGUOUS",
          severity: "WARNING",
          message: "El pago coincide con varias vigencias y requiere revisión humana.",
        },
      });
      matchIssues.push({
        type: "PAYMENT_AMBIGUOUS",
        severity: "WARNING",
        message: "El pago coincide con varias vigencias y requiere revisión humana.",
        sourceType: "PAID_XLS",
        rowNumber: row.rowNumber,
        sourceKey,
      });
      continue;
    }

    const receipt = candidates[0];

    if (usedReceiptIds.has(receipt.id)) {
      paidDecisions.set(row.rowNumber, {
        state: "REVIEW",
        action: "REVIEW_RECEIPT_REUSED",
        status: "REVIEW",
        issue: {
          type: "PAYMENT_REUSED",
          severity: "INFO",
          message: "El recibo ya quedó asociado a otro pago de mayor prioridad durante este preview.",
        },
      });
      matchIssues.push({
        type: "PAYMENT_REUSED",
        severity: "INFO",
        message: "El recibo ya quedó asociado a otro pago de mayor prioridad durante este preview.",
        sourceType: "PAID_XLS",
        rowNumber: row.rowNumber,
        sourceKey,
      });
      continue;
    }

    usedReceiptIds.add(receipt.id);
    paidDecisions.set(row.rowNumber, {
      state: "READY",
      action: "CREATE_PAYMENT",
      status: "READY",
      receiptId: receipt.id,
      policyId: receipt.policy.id,
    });
  }

  const policyIssues = missingPolicyRows.map((row) => ({
    type: "POLICY_MISSING",
    severity: "WARNING",
    message: "La vigencia del CSV no existe todavía en Neon.",
    sourceType: "POLICY_CSV",
    rowNumber: row.rowNumber,
    sourceKey: buildPolicySignature(row),
  }));
  const longPolicyIssues = longPolicies.map((policy) => ({
    type: "POLICY_LONG_TERM",
    severity: "CRITICAL",
    message: "La póliza supera 365/366 días y debe dividirse por vigencias.",
    sourceType: "NEON_POLICY",
    rowNumber: 0,
    sourceKey: policy.id,
  }));
  const endorsementIssues = endorsementPlan.decisions
    .filter((decision): decision is LedgerEndorsementDecision & { issue: NonNullable<LedgerEndorsementDecision["issue"]> } => Boolean(decision.issue))
    .map((decision) => ({
      ...decision.issue,
      sourceType: "POLICY_CSV",
      rowNumber: decision.rowNumber,
      sourceKey: buildPolicySignature(policyRows.find((row) => row.rowNumber === decision.rowNumber)!),
    }));
  const allIssues = [...matchIssues, ...policyIssues, ...longPolicyIssues, ...endorsementIssues];

  const summary: LedgerImportPreviewSummary = {
    policyRows: policyRows.length,
    paidRows: paidRows.length,
    policiesMatched: policyRows.length - missingPolicyRows.length,
    policiesMissing: missingPolicyRows.length,
    policiesOverLong: longPolicies.length,
    endorsementsCreated: endorsementPlan.metrics.created,
    endorsementsUpdated: endorsementPlan.metrics.updated,
    endorsementsUnchanged: endorsementPlan.metrics.unchanged,
    endorsementsReviewRequired: endorsementPlan.metrics.reviewRequired,
    paymentsMatched: Array.from(paidDecisions.values()).filter((decision) => decision.state === "READY").length,
    paymentsReadyToApply: Array.from(paidDecisions.values()).filter((decision) => decision.state === "READY").length,
    paymentsAlreadyApplied: Array.from(paidDecisions.values()).filter((decision) => decision.state === "ALREADY_APPLIED").length,
    paymentsAmbiguous: matchIssues.filter((issue) => issue.type === "PAYMENT_AMBIGUOUS").length,
    paymentsUnmatched: matchIssues.filter((issue) => issue.type === "PAYMENT_UNMATCHED").length,
    paymentsInReview: Array.from(paidDecisions.values()).filter((decision) => decision.status === "REVIEW").length,
    reviewIssues: allIssues.length,
    sampleIssues: allIssues.slice(0, 20),
  };

  const batch = await storePreviewBatch({
    db,
    actorId: input.actorId,
    sourceCsvName: input.csvName,
    sourceCsvHash: csvHash,
    sourcePaidName: input.paidName,
    sourcePaidHash: paidHash,
    summary,
    policyRows,
    paidRows,
    paidDecisions,
    endorsementDecisions,
  });

  const batchRows = await db.ledgerImportRow.findMany({
    where: { batchId: batch.id },
    select: { id: true, sourceType: true, rowNumber: true, sourceKey: true },
  });
  const rowBySource = new Map(
    batchRows.map((row) => [`${row.sourceType}:${row.rowNumber}:${row.sourceKey}`, row]),
  );

  const issueData = await Promise.all(
    allIssues.map(async (issue) => {
      const rowId = rowBySource.get(`${issue.sourceType}:${issue.rowNumber}:${issue.sourceKey}`)?.id ?? null;
      const suppressionRule = await findMatchingSuppressionRule(
        {
          category: "LEDGER",
          issueCode: issue.type,
          fields: {
            batchId: batch.id,
            rowId: rowId ?? "",
            rowNumber: String(issue.rowNumber),
            sourceType: issue.sourceType,
            sourceKey: issue.sourceKey,
            issueType: issue.type,
          },
        },
        db,
      );

      return {
        batchId: batch.id,
        rowId,
        issueType: issue.type,
        severity: issue.severity,
        status: suppressionRule ? "DISMISSED" : "OPEN",
        message: issue.message,
        detailsJson: JSON.stringify(issue),
        suppressedByRuleId: suppressionRule?.id ?? null,
        reviewedAt: suppressionRule ? new Date() : null,
        reviewedById: suppressionRule ? input.actorId : null,
        resolutionNote: suppressionRule ? `Suprimida por regla: ${suppressionRule.reason ?? suppressionRule.issueCode}.` : null,
      };
    }),
  );

  if (issueData.length) {
    await db.ledgerImportIssue.createMany({
      data: issueData,
    });
  }

  return {
    batchId: batch.id,
    summary,
  };
}

function parsePreviewSummary(value: string | null): LedgerImportPreviewSummary {
  if (!value) {
    return {
      policyRows: 0,
      paidRows: 0,
      policiesMatched: 0,
      policiesMissing: 0,
      policiesOverLong: 0,
      endorsementsCreated: 0,
      endorsementsUpdated: 0,
      endorsementsUnchanged: 0,
      endorsementsReviewRequired: 0,
      paymentsMatched: 0,
      paymentsReadyToApply: 0,
      paymentsAlreadyApplied: 0,
      paymentsAmbiguous: 0,
      paymentsUnmatched: 0,
      paymentsInReview: 0,
      reviewIssues: 0,
      sampleIssues: [],
    };
  }

  return JSON.parse(value) as LedgerImportPreviewSummary;
}

function parsePaidRow(rawJson: string): PaidLedgerRow {
  return JSON.parse(rawJson, (key, value) => {
    if ((key === "paidDate" || key === "originalPaidDate") && typeof value === "string" && value) {
      return new Date(value);
    }
    return value;
  }) as PaidLedgerRow;
}

function parsePolicyRow(rawJson: string): PolicyLedgerRow {
  return JSON.parse(rawJson, (key, value) => {
    if (
      ["periodStart", "periodEnd", "policyStart", "policyEnd", "paidDate"].includes(key) &&
      typeof value === "string" &&
      value
    ) {
      return new Date(value);
    }
    return value;
  }) as PolicyLedgerRow;
}

async function markEndorsementApplyReview(input: {
  db: DbClient;
  batchId: string;
  actorId: string;
  row: { id: string; rowNumber: number; sourceType: string; sourceKey: string };
  issueType: string;
  message: string;
  now: Date;
}) {
  const suppressionRule = await findMatchingSuppressionRule(
    {
      category: "LEDGER",
      issueCode: input.issueType,
      fields: {
        batchId: input.batchId,
        rowId: input.row.id,
        rowNumber: String(input.row.rowNumber),
        sourceType: input.row.sourceType,
        sourceKey: input.row.sourceKey,
      },
    },
    input.db,
  );
  await input.db.ledgerImportRow.update({
    where: { id: input.row.id },
    data: { status: "REVIEW", action: `REVIEW_${input.issueType}` },
  });
  await input.db.ledgerImportIssue.create({
    data: {
      batchId: input.batchId,
      rowId: input.row.id,
      issueType: input.issueType,
      severity: "WARNING",
      status: suppressionRule ? "DISMISSED" : "OPEN",
      message: input.message,
      detailsJson: JSON.stringify({ rowNumber: input.row.rowNumber, sourceKey: input.row.sourceKey }),
      suppressedByRuleId: suppressionRule?.id ?? null,
      reviewedAt: suppressionRule ? input.now : null,
      reviewedById: suppressionRule ? input.actorId : null,
      resolutionNote: suppressionRule ? `Suprimida por regla: ${suppressionRule.reason ?? suppressionRule.issueCode}.` : null,
    },
  });
}

export async function applyLedgerImportBatch(input: {
  actorId: string;
  batchId: string;
  db?: DbClient;
}): Promise<LedgerImportApplyResult> {
  const db = input.db ?? getDb();
  const now = new Date();
  const batch = await db.ledgerImportBatch.findUnique({
    where: { id: input.batchId },
    include: {
      rows: {
        where: {
          OR: [
            { sourceType: "PAID_XLS", action: "CREATE_PAYMENT", status: "READY" },
            {
              sourceType: "POLICY_CSV",
              action: { in: ["UPSERT_ENDORSEMENT", "LINK_ENDORSEMENT_RECEIPT"] },
              status: "READY",
            },
          ],
        },
        orderBy: [{ rowNumber: "asc" }],
      },
    },
  });

  if (!batch) {
    throw new Error("El batch de importación no existe.");
  }
  if (!batch.organizationId) throw new Error("ORGANIZATION_ACCESS_DENIED");

  if (!["PREVIEW_READY", "APPROVED", "PARTIAL_APPLIED"].includes(batch.status)) {
    throw new Error("Este batch no está listo para aplicarse.");
  }

  await db.ledgerImportBatch.update({
    where: { id: batch.id },
    data: {
      status: "APPLYING",
      approvedById: input.actorId,
      approvedAt: batch.approvedAt ?? now,
    },
  });

  await db.ledgerImportAction.create({
    data: {
      batchId: batch.id,
      actionType: "LEDGER_IMPORT_BLOCK_APPROVED",
      performedById: input.actorId,
      payloadJson: JSON.stringify({
        readyRows: batch.rows.length,
        sourceCsvHash: batch.sourceCsvHash,
        sourcePaidHash: batch.sourcePaidHash,
      }),
    },
  });

  let paymentsApplied = 0;
  let paymentsSkipped = 0;
  let paymentsFailed = 0;
  let endorsementsApplied = 0;
  let endorsementsSkipped = 0;
  let endorsementsFailed = 0;

  const endorsementRows = batch.rows.filter((row) => row.sourceType === "POLICY_CSV");
  const paymentRows = batch.rows.filter((row) => row.sourceType === "PAID_XLS");

  for (const row of endorsementRows) {
    const policyRow = parsePolicyRow(row.rawJson);
    if (
      !row.policyId ||
      !row.receiptId ||
      !policyRow.endorsementNumber ||
      !policyRow.periodStart ||
      !policyRow.periodEnd
    ) {
      endorsementsSkipped += 1;
      await markEndorsementApplyReview({
        db,
        batchId: batch.id,
        actorId: input.actorId,
        row,
        issueType: "ENDORSEMENT_NOT_APPLICABLE",
        message: "La fila ya no contiene los datos necesarios para aplicar el endoso.",
        now,
      });
      continue;
    }

    const endorsementNumber = cleanText(policyRow.endorsementNumber);
    const [policy, receipt, existingEndorsement] = await Promise.all([
      db.policy.findUnique({ where: { id: row.policyId }, select: { id: true } }),
      db.receipt.findUnique({
        where: { id: row.receiptId },
        select: {
          id: true,
          policyId: true,
          receiptNumber: true,
          periodStartDate: true,
          periodEndDate: true,
          endorsementId: true,
        },
      }),
      db.policyEndorsement.findUnique({
        where: { policyId_endorsementNumber: { policyId: row.policyId, endorsementNumber } },
        select: { id: true },
      }),
    ]);
    const receiptStillMatches =
      receipt?.policyId === row.policyId &&
      cleanText(receipt.receiptNumber) === cleanText(policyRow.receiptNumber) &&
      sameDate(receipt.periodStartDate, policyRow.periodStart) &&
      sameDate(receipt.periodEndDate, policyRow.periodEnd);
    const receiptHasConflict = Boolean(receipt?.endorsementId && receipt.endorsementId !== existingEndorsement?.id);

    if (!policy || !receiptStillMatches || receiptHasConflict) {
      endorsementsSkipped += 1;
      await markEndorsementApplyReview({
        db,
        batchId: batch.id,
        actorId: input.actorId,
        row,
        issueType: receiptHasConflict ? "ENDORSEMENT_RECEIPT_CONFLICT" : "ENDORSEMENT_TARGET_CHANGED",
        message: receiptHasConflict
          ? "El recibo fue enlazado a otro endoso después del preview; no se modificó."
          : "La póliza o el recibo dejaron de coincidir con el preview; no se modificaron.",
        now,
      });
      continue;
    }

    const data = {
      status: mapEndorsementStatus(policyRow.status, policyRow.periodEnd, now),
      startDate: policyRow.periodStart,
      endDate: policyRow.periodEnd,
      amount: policyRow.totalAmount,
      currency: mapCurrency(policyRow.currency),
      reference: nullableText(policyRow.endorsementType),
      concept: nullableText(policyRow.endorsementConcept || policyRow.description),
      updatedById: input.actorId,
      receipts: { connect: { id: row.receiptId } },
    };

    try {
      const endorsement = await db.policyEndorsement.upsert({
        where: { policyId_endorsementNumber: { policyId: row.policyId, endorsementNumber } },
        create: {
          endorsementNumber,
          policyId: row.policyId,
          ...data,
          createdById: input.actorId,
        },
        update: data,
        select: { id: true },
      });

      await db.ledgerImportRow.update({
        where: { id: row.id },
        data: { status: "APPLIED", action: existingEndorsement ? row.action : "UPSERT_ENDORSEMENT" },
      });
      await db.ledgerImportAction.create({
        data: {
          batchId: batch.id,
          rowId: row.id,
          actionType: existingEndorsement ? "ENDORSEMENT_UPDATED_FROM_LEDGER" : "ENDORSEMENT_CREATED_FROM_LEDGER",
          performedById: input.actorId,
          payloadJson: JSON.stringify({
            endorsementId: endorsement.id,
            policyId: row.policyId,
            receiptId: row.receiptId,
            endorsementNumber,
          }),
        },
      });
      endorsementsApplied += 1;
    } catch (error) {
      endorsementsFailed += 1;
      await markEndorsementApplyReview({
        db,
        batchId: batch.id,
        actorId: input.actorId,
        row,
        issueType: "ENDORSEMENT_APPLY_FAILED",
        message: error instanceof Error ? error.message : "No se pudo aplicar este endoso.",
        now,
      });
    }
  }

  for (const row of paymentRows) {
    const paidRow = parsePaidRow(row.rawJson);
    const evidenceKey = row.sourceKey;

    if (!row.receiptId || !paidRow.paidDate || paidRow.totalPaid <= 0) {
      paymentsSkipped += 1;
      const suppressionRule = await findMatchingSuppressionRule(
        {
          category: "LEDGER",
          issueCode: "PAYMENT_NOT_APPLICABLE",
          fields: {
            batchId: batch.id,
            rowId: row.id,
            rowNumber: String(row.rowNumber),
            sourceType: row.sourceType,
            sourceKey: row.sourceKey,
          },
        },
        db,
      );
      await db.ledgerImportRow.update({
        where: { id: row.id },
        data: { status: "REVIEW", action: "REVIEW_PAYMENT_NOT_APPLICABLE" },
      });
      await db.ledgerImportIssue.create({
        data: {
          batchId: batch.id,
          rowId: row.id,
          issueType: "PAYMENT_NOT_APPLICABLE",
          severity: "WARNING",
          status: suppressionRule ? "DISMISSED" : "OPEN",
          message: "La fila ya no cumple criterios para aplicar automáticamente.",
          detailsJson: JSON.stringify({ rowNumber: row.rowNumber, evidenceKey }),
          suppressedByRuleId: suppressionRule?.id ?? null,
          reviewedAt: suppressionRule ? now : null,
          reviewedById: suppressionRule ? input.actorId : null,
          resolutionNote: suppressionRule ? `Suprimida por regla: ${suppressionRule.reason ?? suppressionRule.issueCode}.` : null,
        },
      });
      continue;
    }

    try {
      const result = await recordPayment({
        organizationId: batch.organizationId,
        receiptId: row.receiptId,
        amount: paidRow.totalPaid,
        paidDate: paidRow.paidDate,
        paymentMethod: "IMPORT_XLS",
        reference: `ledger-${dateKey(paidRow.paidDate)}-${paidRow.receiptNumber}`,
        notes: paidRow.overrideNote
          ? `Pago importado desde XLS de pagos. ${paidRow.overrideNote}`
          : "Pago importado desde XLS de pagos.",
        sourceEvidenceKey: evidenceKey,
        actorId: input.actorId,
      });

      await db.ledgerImportRow.update({
        where: { id: row.id },
        data: {
          status: "APPLIED",
          paymentId: result.payment.id,
          policyId: result.payment.policyId,
          receiptId: result.payment.receiptId,
        },
      });

      await db.ledgerImportAction.create({
        data: {
          batchId: batch.id,
          rowId: row.id,
          actionType: "PAYMENT_APPLIED_FROM_LEDGER",
          performedById: input.actorId,
          payloadJson: JSON.stringify({
            paymentId: result.payment.id,
            receiptId: result.receipt.id,
            evidenceKey,
            paidDate: dateKey(paidRow.paidDate),
            amount: paidRow.totalPaid,
          }),
        },
      });

      paymentsApplied += 1;
    } catch (error) {
      if (error instanceof PaymentConflictError) {
        const existingPayment = await db.payment.findUnique({
          where: { organizationId_sourceEvidenceKey: { organizationId: batch.organizationId, sourceEvidenceKey: evidenceKey } },
          select: { id: true, policyId: true, receiptId: true },
        });

        if (existingPayment) {
          await db.ledgerImportRow.update({
            where: { id: row.id },
            data: {
              status: "APPLIED",
              action: "NOOP_PAYMENT_ALREADY_APPLIED",
              paymentId: existingPayment.id,
              policyId: existingPayment.policyId,
              receiptId: existingPayment.receiptId,
            },
          });
          paymentsSkipped += 1;
          continue;
        }
      }

      paymentsFailed += 1;
      const suppressionRule = await findMatchingSuppressionRule(
        {
          category: "LEDGER",
          issueCode: "PAYMENT_APPLY_FAILED",
          fields: {
            batchId: batch.id,
            rowId: row.id,
            rowNumber: String(row.rowNumber),
            sourceType: row.sourceType,
            sourceKey: row.sourceKey,
          },
        },
        db,
      );
      await db.ledgerImportRow.update({
        where: { id: row.id },
        data: { status: "REVIEW", action: "REVIEW_PAYMENT_APPLY_FAILED" },
      });
      await db.ledgerImportIssue.create({
        data: {
          batchId: batch.id,
          rowId: row.id,
          issueType: "PAYMENT_APPLY_FAILED",
          severity: "CRITICAL",
          status: suppressionRule ? "DISMISSED" : "OPEN",
          message: error instanceof Error ? error.message : "No se pudo aplicar este pago.",
          detailsJson: JSON.stringify({ rowNumber: row.rowNumber, evidenceKey }),
          suppressedByRuleId: suppressionRule?.id ?? null,
          reviewedAt: suppressionRule ? now : null,
          reviewedById: suppressionRule ? input.actorId : null,
          resolutionNote: suppressionRule ? `Suprimida por regla: ${suppressionRule.reason ?? suppressionRule.issueCode}.` : null,
        },
      });
    }
  }

  const previewSummary = parsePreviewSummary(batch.summaryJson);
  const summary = {
    ...previewSummary,
    endorsementsApplied,
    endorsementsSkipped,
    endorsementsFailed,
    paymentsApplied,
    paymentsSkipped,
    paymentsFailed,
  };
  const finalStatus =
    paymentsFailed > 0 || endorsementsFailed > 0
      ? "PARTIAL_APPLIED"
      : paymentsApplied > 0 || paymentsSkipped > 0 || endorsementsApplied > 0 || endorsementsSkipped > 0
        ? "APPLIED"
        : "APPLIED_NO_CHANGES";

  await db.ledgerImportBatch.update({
    where: { id: batch.id },
    data: {
      status: finalStatus,
      appliedAt: now,
      summaryJson: JSON.stringify(summary),
    },
  });

  await db.ledgerImportAction.create({
    data: {
      batchId: batch.id,
      actionType: "LEDGER_IMPORT_BLOCK_APPLIED",
      performedById: input.actorId,
      payloadJson: JSON.stringify(summary),
    },
  });

  await writeActivityLog({
    entityType: "LedgerImportBatch",
    entityId: batch.id,
    action: "LEDGER_IMPORT_BLOCK_APPLIED",
    newValue: summary,
    userId: input.actorId,
    db,
  });

  return {
    batchId: batch.id,
    summary,
  };
}
