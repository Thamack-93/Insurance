export type CurrencyTotals = Record<string, number>;

export type BillingMonthlyMetric = {
  month: string;
  mrrByCurrency: CurrencyTotals;
  cashByCurrency: CurrencyTotals;
};

export type BillingSubscriptionMetricInput = {
  status: string;
  monthlyAmountMinor: number;
  currency: string;
  startedAt: Date;
  endsAt: Date | null;
};

export type BillingChargeMetricInput = {
  status: string;
  amountMinor: number;
  currency: string;
  paidAt: Date | null;
};

export const CURRENT_SUBSCRIPTION_STATUSES = new Set(["ACTIVE", "PAST_DUE"]);

export function normalizeBillingCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("POLICYDESK_BILLING_CURRENCY_INVALID");
  return currency;
}

export function parseMinorAmount(value: string | number): number {
  const amount = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("POLICYDESK_BILLING_AMOUNT_INVALID");
  return amount;
}

export function addCurrencyTotal(target: CurrencyTotals, currency: string, amountMinor: number) {
  target[currency] = (target[currency] ?? 0) + amountMinor;
  return target;
}

export function formatMinorAmount(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: normalizeBillingCurrency(currency) }).format(amountMinor / 100);
}

export function monthKey(date: Date) {
  return date.toISOString().slice(0, 7);
}

function monthStart(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function nextMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

export function lastMonths(count: number, now = new Date()) {
  if (!Number.isInteger(count) || count < 1 || count > 24) throw new Error("POLICYDESK_BILLING_MONTH_WINDOW_INVALID");
  const current = monthStart(now);
  return Array.from({ length: count }, (_, index) =>
    new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - (count - index - 1), 1)),
  );
}

export function buildMonthlyBillingMetrics(
  months: Date[],
  subscriptions: BillingSubscriptionMetricInput[],
  charges: BillingChargeMetricInput[],
): BillingMonthlyMetric[] {
  return months.map((month) => {
    const start = monthStart(month);
    const end = nextMonth(start);
    const mrrByCurrency: CurrencyTotals = {};
    const cashByCurrency: CurrencyTotals = {};

    for (const subscription of subscriptions) {
      const contributesToHistoricalMrr = CURRENT_SUBSCRIPTION_STATUSES.has(subscription.status)
        || (subscription.status === "CANCELED" && subscription.endsAt !== null);
      const activeAtMonth = contributesToHistoricalMrr
        && subscription.startedAt < end
        && (!subscription.endsAt || subscription.endsAt >= end);
      if (activeAtMonth) addCurrencyTotal(mrrByCurrency, normalizeBillingCurrency(subscription.currency), subscription.monthlyAmountMinor);
    }

    for (const charge of charges) {
      if (charge.status !== "PAID" || !charge.paidAt) continue;
      if (charge.paidAt >= start && charge.paidAt < end) {
        addCurrencyTotal(cashByCurrency, normalizeBillingCurrency(charge.currency), charge.amountMinor);
      }
    }

    return { month: monthKey(start), mrrByCurrency, cashByCurrency };
  });
}

export function latestMetricTotals(metrics: BillingMonthlyMetric[]) {
  return metrics.at(-1) ?? { month: "", mrrByCurrency: {}, cashByCurrency: {} };
}
