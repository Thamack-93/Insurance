import { isBusinessDateOverdue } from "@/lib/business-dates";

export type ReceiptStatus = "PENDING" | "PAID" | "OVERDUE" | "CANCELLED";

export type ReceiptPaymentSnapshot = {
  amount: number;
  paidDate: Date;
  paymentMethod: string | null;
};

export type ReceiptReconciliationInput = {
  amount: number;
  status: ReceiptStatus;
  dueDate: Date;
  paidDate: Date | null;
  paymentMethod: string | null;
  payments: ReceiptPaymentSnapshot[];
  now?: Date;
  closeTolerance?: number;
};

export type ReceiptReconciliationResult = {
  paidAmount: number;
  paymentCount: number;
  latestPaymentDate: Date | null;
  latestPaymentMethod: string | null;
  nextStatus: ReceiptStatus;
  nextPaidDate: Date | null;
  nextPaymentMethod: string | null;
  shouldReview: boolean;
  reasons: string[];
};

export const PAYMENT_CLOSE_TOLERANCE = 5;

export function isPaidWithinTolerance(amount: number, paidAmount: number, tolerance = PAYMENT_CLOSE_TOLERANCE) {
  return paidAmount > 0 && Math.abs(paidAmount - amount) <= tolerance;
}

function isTruthyText(value: string | null | undefined) {
  return !!value && value.trim().length > 0;
}

function sortPaymentsDescending(payments: ReceiptPaymentSnapshot[]) {
  return [...payments].sort((left, right) => right.paidDate.getTime() - left.paidDate.getTime());
}

export function reconcileReceiptState(input: ReceiptReconciliationInput): ReceiptReconciliationResult {
  const payments = sortPaymentsDescending(input.payments);
  const paidAmount = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const latestPayment = payments[0] ?? null;
  const latestPaymentMethod =
    payments.find((payment) => isTruthyText(payment.paymentMethod))?.paymentMethod?.trim() ?? null;
  const latestPaymentDate = latestPayment?.paidDate ?? null;
  const paymentCount = payments.length;

  if (input.status === "CANCELLED") {
    return {
      paidAmount,
      paymentCount,
      latestPaymentDate,
      latestPaymentMethod,
      nextStatus: "CANCELLED",
      nextPaidDate: input.paidDate,
      nextPaymentMethod: input.paymentMethod,
      shouldReview: paymentCount > 0 || paidAmount > 0,
      reasons: paymentCount > 0 || paidAmount > 0 ? ["cancelled_with_payments"] : [],
    };
  }

  const now = input.now ?? new Date();
  const closeTolerance = Math.max(input.closeTolerance ?? PAYMENT_CLOSE_TOLERANCE, 0);
  const amountDifference = Math.abs(paidAmount - input.amount);
  const isFullyPaid = isPaidWithinTolerance(input.amount, paidAmount, closeTolerance);
  const nextStatus: ReceiptStatus = isFullyPaid ? "PAID" : isBusinessDateOverdue(input.dueDate, now) ? "OVERDUE" : "PENDING";
  const nextPaidDate = isFullyPaid ? latestPaymentDate ?? input.paidDate : null;
  const nextPaymentMethod = isFullyPaid ? latestPaymentMethod ?? input.paymentMethod : null;

  const reasons: string[] = [];
  if (input.status !== nextStatus) {
    reasons.push(`status:${input.status}->${nextStatus}`);
  }
  if (isFullyPaid) {
    if ((input.paidDate?.getTime() ?? null) !== (nextPaidDate?.getTime() ?? null)) {
      reasons.push("paidDate");
    }
    if ((input.paymentMethod ?? null) !== (nextPaymentMethod ?? null)) {
      reasons.push("paymentMethod");
    }
  } else {
    if (input.paidDate || input.paymentMethod) {
      reasons.push("cleared_paid_fields");
    }
    if (paidAmount > 0 && amountDifference > closeTolerance && paidAmount < input.amount) {
      reasons.push("partial_payment");
    }
    if (paidAmount > input.amount && amountDifference > closeTolerance) {
      reasons.push("overpayment");
    }
  }
  if (paymentCount > 1) {
    reasons.push("multiple_payments");
  }

  const shouldReview =
    reasons.includes("partial_payment") ||
    reasons.includes("overpayment") ||
    reasons.includes("multiple_payments") ||
    (paymentCount > 0 && !isFullyPaid) ||
    (input.status === "PAID" && !isFullyPaid);

  return {
    paidAmount,
    paymentCount,
    latestPaymentDate,
    latestPaymentMethod,
    nextStatus,
    nextPaidDate,
    nextPaymentMethod,
    shouldReview,
    reasons,
  };
}
