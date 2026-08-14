import { addMonths } from "date-fns";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { parseDateInput } from "@/lib/form-utils";
import type { PolicyPdfCaptureDraft, PolicyPdfCaptureReceiptEvidence } from "@/lib/policy-pdf-capture.shared";
import { receiptSequenceForNumber } from "@/lib/sorting";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type AutoCaptureReceiptInput = {
  policyId: string;
  clientId: string;
  insurerId: string;
  draft: PolicyPdfCaptureDraft;
  userId: string;
  receiptNumber?: string;
  receiptPlan?: Array<{
    receiptNumber: string;
    amount: number;
  }>;
  receiptEvidence?: PolicyPdfCaptureReceiptEvidence | null;
};

export type AutoCaptureReceiptPayload = {
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
  currency: string;
  status: "PENDING";
  paidDate: null;
  paymentMethod: null;
  notes: string | null;
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

function buildAutoCaptureReceiptNotes(draft: PolicyPdfCaptureDraft) {
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
  return Math.round(value * 100) / 100;
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
  const receiptNumbers = buildSequentialReceiptNumbers(
    getReceiptTermCount(input.draft.paymentFrequency),
    input.receiptNumber,
  );
  const amountOverrides = buildReceiptAmountOverrides(input.receiptPlan);

  if (receiptNumbers.length === 1) {
    return [
      {
        receiptNumber: receiptNumbers[0] ?? "1",
        periodStartDate,
        periodEndDate,
        dueDate: periodStartDate,
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
      dueDate: currentStartDate,
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
): AutoCaptureReceiptPayload {
  const notes = [buildAutoCaptureReceiptNotes(input.draft), buildReceiptEvidenceNote(input.receiptEvidence)].filter(Boolean).join(" · ") || null;

  return {
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
    currency: term.currency,
    status: "PENDING",
    paidDate: null,
    paymentMethod: null,
    notes,
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
  return buildAutoCaptureReceiptTerms(input).map((term) => buildAutoCaptureReceiptPayloadFromTerm(input, term));
}

async function upsertAutoCaptureReceipt(db: DbClient, payload: AutoCaptureReceiptPayload) {
  const existingReceipt = await db.receipt.findFirst({
    where: {
      policyId: payload.policyId,
      receiptNumber: payload.receiptNumber,
      receiptSequence: payload.receiptSequence,
    },
    select: {
      id: true,
      notes: true,
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
      currency: payload.currency,
      status: payload.status,
      paidDate: payload.paidDate,
      paymentMethod: payload.paymentMethod,
      notes: existingReceipt.notes?.trim() ? existingReceipt.notes : payload.notes,
      updatedById: payload.updatedById,
    };

    const receipt = await db.receipt.update({
      where: { id: existingReceipt.id },
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
    data: payload,
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
