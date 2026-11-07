export type HistoricalPaymentEvidence = {
  amount: number;
  paidDate: Date;
  createdAt: Date;
  status: "POSTED" | "REVERSED";
  reversedAt: Date | null;
};

export type HistoricalReceiptEvidence = {
  id: string;
  dueDate: Date;
  createdAt: Date;
  updatedAt: Date;
  amount: number;
  currency: string;
  status: string;
  cancelledAt: Date | null;
  payments: HistoricalPaymentEvidence[];
};

export type HistoricalCollectionsMonth = {
  month: string;
  cutoff: Date;
  currencies: Array<{
    currency: string;
    receipts: number;
    incompleteReceipts: number;
    dueAmount: number | null;
    collectedAmount: number | null;
    outstandingAmount: number | null;
  }>;
};

/** Reconstructs receipt cohorts as of a month-end cutoff using only dated evidence. */
export function buildHistoricalCollections(
  receipts: HistoricalReceiptEvidence[],
  months: Array<{ month: string; start: Date; cutoff: Date }>,
): HistoricalCollectionsMonth[] {
  return months.map(({ month, start, cutoff }) => {
    const byCurrency = new Map<string, { receipts: number; incompleteReceipts: number; dueAmount: number; collectedAmount: number }>();
    for (const receipt of receipts) {
      if (receipt.dueDate < start || receipt.dueDate > cutoff || receipt.createdAt > cutoff) continue;
      if (receipt.cancelledAt && receipt.cancelledAt <= cutoff) continue;

      const currency = receipt.currency || "MXN";
      const bucket = byCurrency.get(currency) ?? { receipts: 0, incompleteReceipts: 0, dueAmount: 0, collectedAmount: 0 };
      bucket.receipts += 1;
      let incomplete = receipt.status === "CANCELLED" && !receipt.cancelledAt;
      // Receipt edits are not versioned, so the historical face value cannot be asserted.
      if (receipt.updatedAt > cutoff) incomplete = true;

      let collected = 0;
      for (const payment of receipt.payments) {
        if (payment.createdAt > cutoff || payment.paidDate > cutoff) continue;
        if (payment.status === "REVERSED") {
          if (!payment.reversedAt) {
            incomplete = true;
            continue;
          }
          if (payment.reversedAt <= cutoff) continue;
        }
        collected += payment.amount;
      }
      bucket.dueAmount += receipt.amount;
      bucket.collectedAmount += collected;
      if (incomplete) bucket.incompleteReceipts += 1;
      byCurrency.set(currency, bucket);
    }

    const currencies = [...byCurrency.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, bucket]) => {
      const exact = bucket.incompleteReceipts === 0;
      return {
        currency,
        receipts: bucket.receipts,
        incompleteReceipts: bucket.incompleteReceipts,
        dueAmount: exact ? bucket.dueAmount : null,
        collectedAmount: exact ? bucket.collectedAmount : null,
        outstandingAmount: exact ? bucket.dueAmount - bucket.collectedAmount : null,
      };
    });
    return { month, cutoff, currencies };
  });
}
