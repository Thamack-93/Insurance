import { createHash } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import * as XLSX from "@e965/xlsx";
import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
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

export type LedgerImportPreviewSummary = {
  policyRows: number;
  paidRows: number;
  policiesMatched: number;
  policiesMissing: number;
  policiesOverLong: number;
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
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate(), 12));
  }

  const text = cleanText(value);
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;

  const [, day, month, year] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
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
  if (row.policyKey === normalizePolicyNumber("2832600022452") && sameDate(row.paidDate, new Date(Date.UTC(2026, 5, 24, 12)))) {
    return {
      ...row,
      originalPaidDate,
      paidDate: new Date(Date.UTC(2026, 3, 24, 12)),
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
      ...input.policyRows.map((row) => ({
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
        }),
        action: "PREVIEW",
        status: "REVIEW",
      })),
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

  const [policies, receipts, existingPayments] = await Promise.all([
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
  const allIssues = [...matchIssues, ...policyIssues, ...longPolicyIssues];

  const summary: LedgerImportPreviewSummary = {
    policyRows: policyRows.length,
    paidRows: paidRows.length,
    policiesMatched: policyRows.length - missingPolicyRows.length,
    policiesMissing: missingPolicyRows.length,
    policiesOverLong: longPolicies.length,
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
          sourceType: "PAID_XLS",
          action: "CREATE_PAYMENT",
          status: "READY",
        },
        orderBy: [{ rowNumber: "asc" }],
      },
    },
  });

  if (!batch) {
    throw new Error("El batch de importación no existe.");
  }

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

  for (const row of batch.rows) {
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
          where: { sourceEvidenceKey: evidenceKey },
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
    paymentsApplied,
    paymentsSkipped,
    paymentsFailed,
  };
  const finalStatus =
    paymentsFailed > 0 ? "PARTIAL_APPLIED" : paymentsApplied > 0 || paymentsSkipped > 0 ? "APPLIED" : "APPLIED_NO_CHANGES";

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
