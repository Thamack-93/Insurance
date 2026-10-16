export type PremiumBreakdown = {
  vatAmount?: number | null;
  issuanceExpenseAmount?: number | null;
  surchargeAmount?: number | null;
  discountAmount?: number | null;
};

function cents(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Receipt amount is the billed total after discounts. Discount is added back
 * when deriving the underlying net premium; each component must be explicit.
 */
export function deriveNetPremium(amount: number, breakdown: PremiumBreakdown): number | null {
  const components = [breakdown.vatAmount, breakdown.issuanceExpenseAmount, breakdown.surchargeAmount, breakdown.discountAmount];
  if (components.every((value) => value === undefined || value === null)) return null;
  if (components.some((value) => value === undefined || value === null)) return null;
  return cents(amount - Number(breakdown.vatAmount) - Number(breakdown.issuanceExpenseAmount) - Number(breakdown.surchargeAmount) + Number(breakdown.discountAmount));
}

export function allocatePaidNetPremium(netPremium: number, receiptAmount: number, postedPaymentAmount: number) {
  if (receiptAmount <= 0 || netPremium < 0 || postedPaymentAmount <= 0) return 0;
  return cents(netPremium * Math.min(postedPaymentAmount, receiptAmount) / receiptAmount);
}

/** Shared receipt premium input; insurer-specific commission rules may apply their own adjustments. */
export function commissionPremiumBase(netPremiumAmount: number | null | undefined, receiptAmount: number) {
  return netPremiumAmount ?? receiptAmount;
}

