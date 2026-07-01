import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { parseDateInput } from "@/lib/form-utils";
import type { PolicyPdfCaptureDraft } from "@/lib/policy-pdf-capture.shared";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type AutoCaptureReceiptInput = {
  policyId: string;
  clientId: string;
  insurerId: string;
  draft: PolicyPdfCaptureDraft;
  userId: string;
  receiptNumber?: string;
};

export type AutoCaptureReceiptPayload = {
  receiptNumber: string;
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

function buildAutoCaptureReceiptNotes(draft: PolicyPdfCaptureDraft) {
  const parts = [
    "Generado automaticamente desde captura de poliza.",
    draft.sourcePolicyNumber ? `Renueva ${draft.sourcePolicyNumber}` : null,
    draft.requestNumber ? `Solicitud ${draft.requestNumber}` : null,
    draft.issueDate ? `Emision ${draft.issueDate}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : null;
}

export function buildAutoCaptureReceiptPayload(input: AutoCaptureReceiptInput): AutoCaptureReceiptPayload {
  const receiptNumber = input.receiptNumber?.trim() || "1";
  const periodStartDate = parseDateInput(input.draft.startDate);
  const periodEndDate = parseDateInput(input.draft.endDate);
  const notes = buildAutoCaptureReceiptNotes(input.draft);

  return {
    receiptNumber,
    policyId: input.policyId,
    endorsementId: null,
    clientId: input.clientId,
    insurerId: input.insurerId,
    periodStartDate,
    periodEndDate,
    dueDate: periodStartDate,
    amount: input.draft.premiumAmount,
    currency: input.draft.currency,
    status: "PENDING",
    paidDate: null,
    paymentMethod: null,
    notes,
    createdById: input.userId,
    updatedById: input.userId,
  };
}

export async function syncAutoCaptureReceipt(db: DbClient, input: AutoCaptureReceiptInput) {
  const payload = buildAutoCaptureReceiptPayload(input);
  const existingReceipt = await db.receipt.findFirst({
    where: {
      policyId: input.policyId,
      receiptNumber: payload.receiptNumber,
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
