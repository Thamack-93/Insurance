import { differenceInCalendarDays } from "date-fns";
import type { PaymentFrequency } from "@/lib/domain-values";
import { toNumber } from "@/lib/money";

export type PolicyPaymentFrequencyInput = {
  startDate: Date;
  endDate: Date;
  paymentFrequency: PaymentFrequency | string;
};

export type PolicyPaymentFrequencyReceipt = {
  periodStartDate: Date;
  periodEndDate: Date;
  amount: unknown;
};

export type PaymentFrequencyInference = {
  normalizedFrequency: PaymentFrequency | null;
  reviewRequired: boolean;
  reason: string | null;
  receiptCount: number;
};

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function sameDate(left: Date, right: Date) {
  return dateKey(left) === dateKey(right);
}

export function inferClearPaymentFrequency(
  policy: PolicyPaymentFrequencyInput,
  receipts: PolicyPaymentFrequencyReceipt[],
): PaymentFrequencyInference {
  const relevantReceipts = receipts
    .filter((receipt) => toNumber(receipt.amount) > 0)
    .slice()
    .sort((left, right) => left.periodStartDate.getTime() - right.periodStartDate.getTime());

  if (policy.paymentFrequency !== "SINGLE") {
    return {
      normalizedFrequency: null,
      reviewRequired: false,
      reason: null,
      receiptCount: relevantReceipts.length,
    };
  }

  if (relevantReceipts.length !== 2) {
    return {
      normalizedFrequency: null,
      reviewRequired: relevantReceipts.length > 1,
      reason: relevantReceipts.length > 1 ? `Tiene ${relevantReceipts.length} recibos y no encaja con una semestralidad clara.` : null,
      receiptCount: relevantReceipts.length,
    };
  }

  const [firstReceipt, secondReceipt] = relevantReceipts;
  const policySpanDays = differenceInCalendarDays(policy.endDate, policy.startDate);
  const firstSpanDays = differenceInCalendarDays(firstReceipt.periodEndDate, firstReceipt.periodStartDate);
  const secondSpanDays = differenceInCalendarDays(secondReceipt.periodEndDate, secondReceipt.periodStartDate);
  const expectedHalfSpan = policySpanDays / 2;
  const contiguousCoverage =
    sameDate(firstReceipt.periodStartDate, policy.startDate) &&
    sameDate(secondReceipt.periodEndDate, policy.endDate) &&
    sameDate(firstReceipt.periodEndDate, secondReceipt.periodStartDate);
  const balancedSplit =
    Math.abs(firstSpanDays - expectedHalfSpan) <= 2 &&
    Math.abs(secondSpanDays - expectedHalfSpan) <= 2;

  if (!contiguousCoverage || !balancedSplit) {
    return {
      normalizedFrequency: null,
      reviewRequired: true,
      reason: "Tiene 2 recibos, pero la cobertura no cuadra con una semestralidad clara.",
      receiptCount: relevantReceipts.length,
    };
  }

  return {
    normalizedFrequency: "SEMIANNUAL",
    reviewRequired: false,
    reason: "Dos recibos contiguos cubren la vigencia en mitades equivalentes.",
    receiptCount: relevantReceipts.length,
  };
}
