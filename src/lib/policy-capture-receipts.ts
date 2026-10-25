import { addMonths } from "date-fns";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { writeActivityLog } from "@/lib/activity-log";
import { parseDateInput } from "@/lib/form-utils";
import { calculateVatFromGross, roundPremiumMoney } from "@/lib/premium-breakdown";
import type { PolicyPdfCaptureDraft, PolicyPdfCaptureReceiptEvidence } from "@/lib/policy-pdf-capture.shared";
import { normalizePolicyNumber } from "@/lib/policy-number";
import { receiptSequenceForNumber } from "@/lib/sorting";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type AutoCaptureReceiptInput = {
  organizationId: string;
  policyId: string;
  clientId: string;
  insurerId: string;
  draft: PolicyReceiptScheduleDraft | PolicyPdfCaptureDraft;
  userId: string;
  receiptNumber?: string;
  receiptPlan?: Array<{
    receiptNumber: string;
    amount: number;
  }>;
  receiptEvidence?: PolicyPdfCaptureReceiptEvidence | null;
  premiumBreakdown?: PolicyPremiumTotals;
};

export type PolicyPremiumTotals = {
  issuanceExpenseAmount: number | null;
  surchargeAmount: number | null;
  discountAmount: number | null;
};

export type PolicyPremiumBreakdown = PolicyPremiumTotals & { vatAmount: number | null };

export type PolicyReceiptScheduleDraft = {
  startDate: string;
  endDate: string;
  paymentFrequency: string;
  premiumAmount: number;
  currency: string;
  sourcePolicyNumber?: string | null;
  requestNumber?: string | null;
  issueDate?: string | null;
};

export type AutoCaptureReceiptPayload = {
  organizationId: string;
  receiptNumber: string;
  receiptSequence: number | null;
  policyId: string;
  endorsementId: null;
  clientId: string;
  insurerId: string;
  periodStartDate: Date;
  periodEndDate: Date;
  dueDate: Date;
  amount: number;
  vatAmount: number | null;
  issuanceExpenseAmount: number | null;
  surchargeAmount: number | null;
  discountAmount: number | null;
  currency: string;
  status: "PENDING";
  paidDate: null;
  paymentMethod: null;
  notes: string | null;
  commissionCalculationStatus: "REVIEW" | "NOT_CALCULATED";
  commissionReviewReason: string | null;
  createdById: string;
  updatedById: string;
};

export type AutoCaptureReceiptResult = {
  receipt: {
    id: string;
    receiptNumber: string;
    notes: string | null;
  };
  created: boolean;
};

type AutoCaptureReceiptTerm = {
  receiptNumber: string;
  periodStartDate: Date;
  periodEndDate: Date;
  dueDate: Date;
  amount: number;
  currency: string;
};

function buildAutoCaptureReceiptNotes(
  draft: Pick<PolicyReceiptScheduleDraft, "sourcePolicyNumber" | "requestNumber" | "issueDate">,
) {
  const parts = [
    "Generado automaticamente desde captura de poliza.",
    draft.sourcePolicyNumber ? `Renueva ${draft.sourcePolicyNumber}` : null,
    draft.requestNumber ? `Solicitud ${draft.requestNumber}` : null,
    draft.issueDate ? `Emision ${draft.issueDate}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : null;
}

function buildReceiptEvidenceNote(evidence: PolicyPdfCaptureReceiptEvidence | null | undefined) {
  if (!evidence) return null;
  const parts = [
    evidence.receiptControlNumber ? `Control de recibo ${evidence.receiptControlNumber}` : null,
    evidence.dueDate ? `Vencimiento ${evidence.dueDate}` : null,
    evidence.periodLabel ? `Periodo ${evidence.periodLabel}` : null,
    evidence.amountDue != null ? `Aviso ${evidence.amountDue.toFixed(2)} ${evidence.currency}` : null,
    evidence.depositAmount != null ? `Ficha ${evidence.depositAmount.toFixed(2)} ${evidence.currency}` : null,
    "Pago no confirmado",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function roundMoney(value: number) {
  return roundPremiumMoney(value);
}

function allocateProportionally(total: number, weights: number[]) {
  const weightTotal = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (total < 0 || weightTotal <= 0) return weights.map(() => null);
  const totalCents = Math.round((total + Number.EPSILON) * 100);
  const rawCents = weights.map((weight) => totalCents * Math.max(0, weight) / weightTotal);
  const cents = rawCents.map(Math.floor);
  let remainingCents = totalCents - cents.reduce((sum, value) => sum + value, 0);
  const remainderOrder = rawCents
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let position = 0; remainingCents > 0 && position < remainderOrder.length; position += 1, remainingCents -= 1) {
    cents[remainderOrder[position]!.index]! += 1;
  }
  return cents.map((value) => value / 100);
}

function allocateBreakdownAcrossAmounts(breakdown: PolicyPremiumTotals | undefined, amounts: number[]) {
  const result: PolicyPremiumBreakdown[] = amounts.map(() => ({ vatAmount: null, issuanceExpenseAmount: null, surchargeAmount: null, discountAmount: null }));
  if (amounts.length === 0) return result;
  const grossTotal = roundMoney(amounts.reduce((sum, amount) => sum + amount, 0));
  if (grossTotal <= 0) return result;
  const vatTotal = calculateVatFromGross(grossTotal);
  if (vatTotal === null) return result;
  const vatAmounts = allocateProportionally(vatTotal, amounts);
  amounts.forEach((_, index) => { result[index]!.vatAmount = vatAmounts[index] ?? null; });

  const issuanceTotal = breakdown?.issuanceExpenseAmount;
  if (issuanceTotal !== null && issuanceTotal !== undefined && Number.isFinite(issuanceTotal)) {
    result[0]!.issuanceExpenseAmount = roundMoney(issuanceTotal);
    for (let index = 1; index < result.length; index += 1) result[index]!.issuanceExpenseAmount = 0;
  }

  const netWeights = amounts.map((amount, index) => Math.max(0, amount - Number(result[index]!.vatAmount) - Number(result[index]!.issuanceExpenseAmount ?? 0)));
  const totalWeight = netWeights.reduce((sum, weight) => sum + weight, 0);
  if (!breakdown || totalWeight <= 0) return result;
  for (const key of ["surchargeAmount", "discountAmount"] as const) {
    const total = breakdown[key];
    if (total === null || !Number.isFinite(total)) continue;
    const allocations = allocateProportionally(total, netWeights);
    netWeights.forEach((_, index) => { result[index]![key] = allocations[index] ?? null; });
  }
  return result;
}

function getReceiptTermCount(paymentFrequency: string) {
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

function getMatchingReceiptEvidence(input: AutoCaptureReceiptInput) {
  const evidence = input.receiptEvidence;
  const draftPolicyNumber = "policyNumber" in input.draft ? input.draft.policyNumber : null;
  if (!evidence?.policyNumber || !draftPolicyNumber) return null;
  return normalizePolicyNumber(evidence.policyNumber) === normalizePolicyNumber(draftPolicyNumber)
    ? evidence
    : null;
}

function parseEvidenceDueDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = parseDateInput(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getReceiptEvidenceTermIndex(evidence: PolicyPdfCaptureReceiptEvidence | null, termCount: number) {
  if (!evidence) return null;
  if (termCount === 1) return 0;
  const match = evidence.periodLabel?.match(/^0*(\d{1,2})\s*\/\s*0*(\d{1,2})$/);
  if (!match || Number(match[2]) !== termCount) return null;
  const index = Number(match[1]) - 1;
  return index >= 0 && index < termCount ? index : null;
}

function buildSequentialReceiptNumbers(count: number, startingReceiptNumber?: string) {
  const trimmed = startingReceiptNumber?.trim() || "";
  const numericStart = Number(trimmed);

  if (count <= 1) {
    return [trimmed || "1"];
  }

  if (trimmed && Number.isFinite(numericStart) && /^\d+$/.test(trimmed)) {
    return Array.from({ length: count }, (_, index) => String(numericStart + index));
  }

  return Array.from({ length: count }, (_, index) => String(index + 1));
}

function buildReceiptAmountOverrides(receiptPlan: AutoCaptureReceiptInput["receiptPlan"]) {
  return new Map(
    (receiptPlan ?? [])
      .filter((item) => item.receiptNumber.trim())
      .map((item) => [item.receiptNumber.trim(), roundMoney(item.amount)] as const),
  );
}

function buildAutoCaptureReceiptTerms(input: AutoCaptureReceiptInput): AutoCaptureReceiptTerm[] {
  const periodStartDate = parseDateInput(input.draft.startDate);
  const periodEndDate = parseDateInput(input.draft.endDate);
  const totalAmount = roundMoney(input.draft.premiumAmount);
  const termCount = getReceiptTermCount(input.draft.paymentFrequency);
  const receiptEvidence = getMatchingReceiptEvidence(input);
  const receiptEvidenceTermIndex = getReceiptEvidenceTermIndex(receiptEvidence, termCount);
  const receiptEvidenceDueDate = parseEvidenceDueDate(receiptEvidence?.dueDate);
  const receiptNumbers = buildSequentialReceiptNumbers(
    termCount,
    input.receiptNumber ?? (termCount === 1 ? receiptEvidence?.receiptControlNumber ?? undefined : undefined),
  );
  const amountOverrides = buildReceiptAmountOverrides(input.receiptPlan);

  if (receiptNumbers.length === 1) {
    return [
      {
        receiptNumber: receiptNumbers[0] ?? "1",
        periodStartDate,
        periodEndDate,
        dueDate: receiptEvidenceDueDate ?? periodStartDate,
        amount: amountOverrides.get(receiptNumbers[0] ?? "1") ?? totalAmount,
        currency: input.draft.currency,
      },
    ];
  }

  const monthsPerTerm = Math.max(1, Math.round(12 / receiptNumbers.length));
  const baseAmount = roundMoney(totalAmount / receiptNumbers.length);
  let currentStartDate = periodStartDate;
  let remainingAmount = totalAmount;

  return receiptNumbers.map((receiptNumber, index) => {
    const isLast = index === receiptNumbers.length - 1;
    const nextStartDate = isLast ? periodEndDate : addMonths(currentStartDate, monthsPerTerm);
    const amount = amountOverrides.get(receiptNumber) ?? (isLast ? roundMoney(remainingAmount) : baseAmount);

    remainingAmount = roundMoney(remainingAmount - amount);

    const term = {
      receiptNumber,
      periodStartDate: currentStartDate,
      periodEndDate: nextStartDate,
      dueDate: index === receiptEvidenceTermIndex && receiptEvidenceDueDate ? receiptEvidenceDueDate : currentStartDate,
      amount,
      currency: input.draft.currency,
    };

    currentStartDate = nextStartDate;
    return term;
  });
}

function buildAutoCaptureReceiptPayloadFromTerm(
  input: AutoCaptureReceiptInput,
  term: AutoCaptureReceiptTerm,
  breakdown: ReturnType<typeof allocateBreakdownAcrossAmounts>[number],
): AutoCaptureReceiptPayload {
  const notes = [buildAutoCaptureReceiptNotes(input.draft), buildReceiptEvidenceNote(getMatchingReceiptEvidence(input))].filter(Boolean).join(" · ") || null;
  const breakdownComplete = Object.values(breakdown).every((value) => value !== null);

  return {
    organizationId: input.organizationId,
    receiptNumber: term.receiptNumber,
    receiptSequence: receiptSequenceForNumber(term.receiptNumber),
    policyId: input.policyId,
    endorsementId: null,
    clientId: input.clientId,
    insurerId: input.insurerId,
    periodStartDate: term.periodStartDate,
    periodEndDate: term.periodEndDate,
    dueDate: term.dueDate,
    amount: term.amount,
    ...breakdown,
    currency: term.currency,
    status: "PENDING",
    paidDate: null,
    paymentMethod: null,
    notes,
    commissionCalculationStatus: breakdownComplete ? "NOT_CALCULATED" : "REVIEW",
    commissionReviewReason: breakdownComplete ? null : "Completa una sola vez expedición, recargo y descuentos totales en la póliza; el IVA se calcula y los recibos heredan los importes.",
    createdById: input.userId,
    updatedById: input.userId,
  };
}

export function buildAutoCaptureReceiptPayload(input: AutoCaptureReceiptInput): AutoCaptureReceiptPayload {
  const [payload] = buildAutoCaptureReceiptPayloads(input);
  if (!payload) {
    throw new Error("No se pudo construir el recibo automatico.");
  }
  return payload;
}

export function buildAutoCaptureReceiptPayloads(input: AutoCaptureReceiptInput): AutoCaptureReceiptPayload[] {
  const terms = buildAutoCaptureReceiptTerms(input);
  const allocations = allocateBreakdownAcrossAmounts(input.premiumBreakdown, terms.map((term) => term.amount));
  return terms.map((term, index) => buildAutoCaptureReceiptPayloadFromTerm(input, term, allocations[index]!));
}

async function upsertAutoCaptureReceipt(db: DbClient, payload: AutoCaptureReceiptPayload) {
  const existingReceipt = await db.receipt.findFirst({
    where: {
      organizationId: payload.organizationId,
      policyId: payload.policyId,
      receiptNumber: payload.receiptNumber,
      receiptSequence: payload.receiptSequence,
    },
    select: {
      id: true,
      notes: true,
      commissionCalculationStatus: true,
      amount: true,
    },
  });

  if (existingReceipt) {
    const data = {
      receiptNumber: payload.receiptNumber,
      policyId: payload.policyId,
      endorsementId: payload.endorsementId,
      clientId: payload.clientId,
      insurerId: payload.insurerId,
      periodStartDate: payload.periodStartDate,
      periodEndDate: payload.periodEndDate,
      dueDate: payload.dueDate,
      amount: payload.amount,
      vatAmount: payload.vatAmount,
      issuanceExpenseAmount: payload.issuanceExpenseAmount,
      surchargeAmount: payload.surchargeAmount,
      discountAmount: payload.discountAmount,
      currency: payload.currency,
      status: payload.status,
      paidDate: payload.paidDate,
      paymentMethod: payload.paymentMethod,
      notes: existingReceipt.notes?.trim() ? existingReceipt.notes : payload.notes,
      ...(existingReceipt.commissionCalculationStatus === "CALCULATED" && Number(existingReceipt.amount) === payload.amount ? {} : {
        commissionCalculationStatus: payload.commissionCalculationStatus,
        commissionReviewReason: payload.commissionReviewReason,
      }),
      updatedById: payload.updatedById,
    };

    const receipt = await db.receipt.update({
      where: { id: existingReceipt.id, organizationId: payload.organizationId },
      data,
    });

    return {
      receipt: {
        id: receipt.id,
        receiptNumber: receipt.receiptNumber,
        notes: receipt.notes ?? null,
      },
      created: false,
    } satisfies AutoCaptureReceiptResult;
  }

  const receipt = await db.receipt.create({
    data: { ...payload, organizationId: payload.organizationId },
  });

  return {
    receipt: {
      id: receipt.id,
      receiptNumber: receipt.receiptNumber,
      notes: receipt.notes ?? null,
    },
    created: true,
  } satisfies AutoCaptureReceiptResult;
}

export async function syncAutoCaptureReceipt(db: DbClient, input: AutoCaptureReceiptInput) {
  const payload = buildAutoCaptureReceiptPayload(input);
  return upsertAutoCaptureReceipt(db, payload);
}

export async function syncAutoCaptureReceipts(db: DbClient, input: AutoCaptureReceiptInput) {
  const payloads = buildAutoCaptureReceiptPayloads(input);
  const results: AutoCaptureReceiptResult[] = [];

  for (const payload of payloads) {
    results.push(await upsertAutoCaptureReceipt(db, payload));
  }

  return results;
}

/** Reapplies policy-level premium totals to existing base receipts without touching payments or endorsement receipts. */
export async function syncPolicyPremiumBreakdownToReceipts(
  db: Prisma.TransactionClient,
  input: { organizationId: string; policyId: string; userId: string; breakdown: PolicyPremiumTotals },
) {
  const receipts = await db.receipt.findMany({
    where: { organizationId: input.organizationId, policyId: input.policyId, endorsementId: null },
    orderBy: [{ receiptSequence: "asc" }, { dueDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      amount: true,
      vatAmount: true,
      issuanceExpenseAmount: true,
      surchargeAmount: true,
      discountAmount: true,
      commissions: { select: { id: true }, take: 1 },
    },
  });
  const allocations = allocateBreakdownAcrossAmounts(input.breakdown, receipts.map((receipt) => Number(receipt.amount)));
  for (let index = 0; index < receipts.length; index += 1) {
    const receipt = receipts[index]!;
    const allocation = allocations[index]!;
    const changed = (Object.keys(allocation) as Array<keyof PolicyPremiumBreakdown>).some((key) => {
      const current = receipt[key];
      const next = allocation[key];
      return current === null ? next !== null : next === null || Math.abs(Number(current) - next) > 0.001;
    });
    if (changed && receipt.commissions.length) {
      throw new Error("No se puede cambiar el desglose de la póliza porque ya hay comisiones calculadas en sus recibos. Conserva el desglose histórico o solicita una corrección auditada.");
    }
    if (!changed && receipt.commissions.length) continue;
    const complete = Object.values(allocation).every((value) => value !== null);
    const updated = await db.receipt.update({
      where: { id: receipt.id, organizationId: input.organizationId },
      data: {
        ...allocation,
        commissionCalculationStatus: complete ? "NOT_CALCULATED" : "REVIEW",
        commissionReviewReason: complete ? null : "Completa una sola vez expedición, recargo y descuentos totales en la póliza; el IVA se calcula y los recibos heredan los importes.",
        updatedById: input.userId,
      },
    });
    if (changed) {
      await writeActivityLog({
        entityType: "Receipt",
        entityId: receipt.id,
        action: "RECEIPT_UPDATE_POLICY_PREMIUM_BREAKDOWN",
        organizationId: input.organizationId,
        userId: input.userId,
        db,
        oldValue: {
          vatAmount: receipt.vatAmount,
          issuanceExpenseAmount: receipt.issuanceExpenseAmount,
          surchargeAmount: receipt.surchargeAmount,
          discountAmount: receipt.discountAmount,
        },
        newValue: {
          vatAmount: updated.vatAmount,
          issuanceExpenseAmount: updated.issuanceExpenseAmount,
          surchargeAmount: updated.surchargeAmount,
          discountAmount: updated.discountAmount,
        },
      });
    }
  }
  return receipts.length;
}
