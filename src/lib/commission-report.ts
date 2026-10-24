export type CommissionReportRowSummaryInput = {
  status: "CALCULATED" | "REVIEW";
  currency: string;
  amount: number;
  expectedCommission: number | null;
};

export function summarizeCommissionReportRows(rows: CommissionReportRowSummaryInput[]) {
  const premiumByCurrency = new Map<string, { premiumPaid: number }>();
  const commissionByCurrency = new Map<string, { commissionExpected: number }>();
  let calculatedCount = 0;
  let pendingCount = 0;

  for (const row of rows) {
    const currency = row.currency.toUpperCase();
    const premiumTotal = premiumByCurrency.get(currency) ?? { premiumPaid: 0 };
    premiumTotal.premiumPaid += row.amount;
    premiumByCurrency.set(currency, premiumTotal);

    if (row.status !== "CALCULATED" || row.expectedCommission === null) {
      pendingCount += 1;
      continue;
    }

    calculatedCount += 1;
    const commissionTotal = commissionByCurrency.get(currency) ?? { commissionExpected: 0 };
    commissionTotal.commissionExpected += row.expectedCommission;
    commissionByCurrency.set(currency, commissionTotal);
  }

  return { calculatedCount, pendingCount, premiumByCurrency, commissionByCurrency };
}
