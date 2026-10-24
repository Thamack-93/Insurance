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

export function roundPremiumMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Returns null until every component is explicitly captured. */
export function deriveNetPremium(amount: number, breakdown: PremiumBreakdown): number | null {
  const nonnegativeComponents = [breakdown.vatAmount, breakdown.issuanceExpenseAmount, breakdown.discountAmount];
  const surcharge = breakdown.surchargeAmount;
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    nonnegativeComponents.some((value) => value == null || !Number.isFinite(value) || value < 0) ||
    surcharge == null ||
    !Number.isFinite(surcharge)
  ) return null;
  const net = roundPremiumMoney(amount - Number(breakdown.vatAmount) - Number(breakdown.issuanceExpenseAmount) - surcharge + Number(breakdown.discountAmount));
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
  return { expectedTotal, receiptTotal, difference, status: Math.abs(difference) <= 0.01 ? "RECONCILED" as const : "REVIEW" as const };
}

export function allocatePaidNetPremium(netPremium: number, receiptAmount: number, postedPaymentAmount: number) {
  if (![netPremium, receiptAmount, postedPaymentAmount].every(Number.isFinite) || receiptAmount <= 0 || netPremium < 0 || postedPaymentAmount < 0) return null;
  return roundPremiumMoney(netPremium * Math.min(postedPaymentAmount, receiptAmount) / receiptAmount);
}

export function reconcilePolicyReceiptPremium(policyPremium: number, receiptAmounts: Array<{ amount: number; status: string; endorsementId?: string | null }>) {
  const baseReceipts = receiptAmounts.filter((receipt) => receipt.status !== "CANCELLED" && !receipt.endorsementId);
  const receiptTotal = roundPremiumMoney(baseReceipts.reduce((sum, receipt) => sum + receipt.amount, 0));
  const expectedTotal = roundPremiumMoney(policyPremium);
  const difference = roundPremiumMoney(expectedTotal - receiptTotal);
  return { expectedTotal, receiptTotal, difference, status: Math.abs(difference) <= 0.01 ? "RECONCILED" as const : "REVIEW" as const };
}
