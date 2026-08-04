export type CurrencyTotals = Record<string, number>;

export type MonthlyMetric = {
  month: string;
  mrrByCurrency: CurrencyTotals;
  cashByCurrency: CurrencyTotals;
};

export function addCurrencyTotal(target: CurrencyTotals, currency: string, amountMinor: number) {
  target[currency] = (target[currency] ?? 0) + amountMinor;
  return target;
}

export function formatMinorAmount(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(amountMinor / 100);
}

export function monthKey(date: Date) {
  return date.toISOString().slice(0, 7);
}

export function buildMonthlyMetrics(
  months: Date[],
  subscriptions: Array<{ status: string; monthlyAmountMinor: number; currency: string; startedAt: Date; endsAt: Date | null }>,
  charges: Array<{ status: string; amountMinor: number; currency: string; paidAt: Date | null; periodStart: Date }>,
): MonthlyMetric[] {
  return months.map((month) => {
    const start = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
    const end = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
    const mrrByCurrency: CurrencyTotals = {};
    const cashByCurrency: CurrencyTotals = {};
    for (const subscription of subscriptions) {
      const activeAtMonth = subscription.status === "ACTIVE" && subscription.startedAt < end && (!subscription.endsAt || subscription.endsAt >= start);
      if (activeAtMonth) addCurrencyTotal(mrrByCurrency, subscription.currency, subscription.monthlyAmountMinor);
    }
    for (const charge of charges) {
      const paidAt = charge.paidAt ?? charge.periodStart;
      if (charge.status === "PAID" && paidAt >= start && paidAt < end) {
        addCurrencyTotal(cashByCurrency, charge.currency, charge.amountMinor);
      }
    }
    return { month: monthKey(start), mrrByCurrency, cashByCurrency };
  });
}

export function lastMonths(count: number, now = new Date()) {
  const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return Array.from({ length: count }, (_, index) =>
    new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - (count - index - 1), 1)),
  );
}
