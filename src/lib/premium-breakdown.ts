export type PremiumBreakdown = {
  vatAmount?: number | null;
  issuanceExpenseAmount?: number | null;
  surchargeAmount?: number | null;
  discountAmount?: number | null;
};

export type UnitPremiumBreakdown = PremiumBreakdown & {
  insuredAssetId: string;
  totalPremium: number;
};

export function policyPremiumBreakdownChanged(previous: PremiumBreakdown, next: PremiumBreakdown) {
  const keys = ["vatAmount", "issuanceExpenseAmount", "surchargeAmount", "discountAmount"] as const;
  return keys.some((key) => {
    const before = previous[key] ?? null;
    const after = next[key] ?? null;
    return before === null ? after !== null : after === null || Math.abs(Number(before) - Number(after)) > 0.001;
  });
}

export function roundPremiumMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** IVA at 16% of the pre-tax total, expressed from a tax-inclusive amount. */
export function calculateVatFromGross(amountIncludingVat: number) {
  if (!Number.isFinite(amountIncludingVat) || amountIncludingVat < 0) return null;
  return roundPremiumMoney(amountIncludingVat * 16 / 116);
}

export const PREMIUM_RECONCILIATION_TOLERANCE = 1;

/** Treat posted-payment excess up to the agreed one-peso tolerance as reconciled. */
export function exceedsReceiptPaymentTolerance(totalPosted: number, receiptAmount: number) {
  if (![totalPosted, receiptAmount].every(Number.isFinite) || totalPosted < 0 || receiptAmount < 0) return true;
  return roundPremiumMoney(totalPosted - receiptAmount) > PREMIUM_RECONCILIATION_TOLERANCE;
}

/** Returns null until every component is explicitly captured. */
export function deriveNetPremium(amount: number, breakdown: PremiumBreakdown): number | null {
  const components = [breakdown.vatAmount, breakdown.issuanceExpenseAmount, breakdown.surchargeAmount, breakdown.discountAmount];
  if (!Number.isFinite(amount) || amount < 0 || components.some((value) => value == null || !Number.isFinite(value)) ||
    [breakdown.vatAmount, breakdown.issuanceExpenseAmount, breakdown.discountAmount].some((value) => Number(value) < 0)) return null;
  const net = roundPremiumMoney(amount - Number(breakdown.vatAmount) - Number(breakdown.issuanceExpenseAmount) - Number(breakdown.surchargeAmount) + Number(breakdown.discountAmount));
  return net < 0 ? null : net;
}

export function deriveReceiptNetPremium(input: {
  amount: number;
  vatAmount?: number | null;
  issuanceExpenseAmount?: number | null;
  surchargeAmount?: number | null;
  discountAmount?: number | null;
  premiumBreakdownByUnit?: UnitPremiumBreakdown[] | null;
}): number | null {
  const unitRows = input.premiumBreakdownByUnit ?? [];
  if (unitRows.length) {
    const ids = unitRows.map((row) => row.insuredAssetId);
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return null;
    if (Math.abs(roundPremiumMoney(unitRows.reduce((sum, row) => sum + row.totalPremium, 0)) - roundPremiumMoney(input.amount)) > 0.01) return null;
    let total = 0;
    for (const row of unitRows) {
      const net = deriveNetPremium(row.totalPremium, row);
      if (net === null) return null;
      total = roundPremiumMoney(total + net);
    }
    return total;
  }
  return deriveNetPremium(input.amount, input);
}

export function reconcileEndorsementReceiptPremium(endorsementPremium: number, receiptAmounts: Array<{ amount: number; status: string }>) {
  const receiptTotal = roundPremiumMoney(receiptAmounts.filter((receipt) => receipt.status !== "CANCELLED").reduce((sum, receipt) => sum + receipt.amount, 0));
  const expectedTotal = roundPremiumMoney(endorsementPremium);
  const difference = roundPremiumMoney(expectedTotal - receiptTotal);
  return { expectedTotal, receiptTotal, difference, status: Math.abs(difference) <= PREMIUM_RECONCILIATION_TOLERANCE ? "RECONCILED" as const : "REVIEW" as const };
}

export function allocatePaidNetPremium(netPremium: number, receiptAmount: number, postedPaymentAmount: number) {
  if (![netPremium, receiptAmount, postedPaymentAmount].every(Number.isFinite) || receiptAmount <= 0 || netPremium < 0 || postedPaymentAmount < 0) return null;
  return roundPremiumMoney(netPremium * Math.min(postedPaymentAmount, receiptAmount) / receiptAmount);
}

export type PolicyReceiptReconciliationRow = {
  id?: string;
  amount: number;
  status: string;
  receiptSequence?: number | null;
  endorsementId?: string | null;
  cancelledAt?: Date | null;
  cancellationReason?: string | null;
  postedPaymentCount?: number;
};

/**
 * A cancelled, unpaid final installment for non-payment offsets original policy
 * premium. Earlier paid installments remain part of the active receipt total.
 * Legacy receipts without a stable sequence or cancellation evidence fail closed.
 */
export function reconcilePolicyReceiptPremium(
  policyPremium: number,
  receiptAmounts: PolicyReceiptReconciliationRow[],
  options: { includePaidCancelledReceipts?: boolean } = {},
) {
  const baseReceipts = receiptAmounts.filter((receipt) => !receipt.endorsementId);
  const activeBaseReceipts = baseReceipts.filter((receipt) => receipt.status !== "CANCELLED"
    || (options.includePaidCancelledReceipts === true && (receipt.postedPaymentCount ?? 0) > 0));
  const receiptTotal = roundPremiumMoney(activeBaseReceipts.reduce((sum, receipt) => sum + receipt.amount, 0));
  const sequences = baseReceipts.flatMap((receipt) => receipt.receiptSequence == null ? [] : [receipt.receiptSequence]);
  const latestReceiptSequence = sequences.length ? Math.max(...sequences) : null;
  const latestSequenceRows = latestReceiptSequence === null ? [] : baseReceipts.filter((receipt) => receipt.receiptSequence === latestReceiptSequence);
  const cancellationOffsets = latestSequenceRows.length === 1 && latestSequenceRows[0].status === "CANCELLED"
    && latestSequenceRows[0].cancellationReason === "NON_PAYMENT"
    && latestSequenceRows[0].cancelledAt != null
    && (latestSequenceRows[0].postedPaymentCount ?? 0) === 0
    ? latestSequenceRows
    : [];
  const cancellationOffset = roundPremiumMoney(cancellationOffsets.reduce((sum, receipt) => sum + receipt.amount, 0));
  const expectedTotal = roundPremiumMoney(policyPremium - cancellationOffset);
  const difference = roundPremiumMoney(expectedTotal - receiptTotal);
  const status = expectedTotal >= 0 && Math.abs(difference) <= PREMIUM_RECONCILIATION_TOLERANCE ? "RECONCILED" as const : "REVIEW" as const;
  return {
    expectedTotal,
    receiptTotal,
    difference,
    cancellationOffset,
    cancelledReceiptIds: cancellationOffsets.flatMap((receipt) => receipt.id ? [receipt.id] : []),
    status,
  };
}
