// Pure dashboard logic - no DB or Next.js context, safe to unit test.

import { BUSINESS_TIME_ZONE } from "@/lib/business-dates";
import { toNumber } from "@/lib/money";

// Commissions counted in the monthly "Comisiones del mes" KPI and its trend:
// everything the month produced, whether still expected or already paid.
export const MONTHLY_COMMISSION_STATUSES = ["EXPECTED", "PENDING", "OVERDUE", "PAID"];

const monthKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  timeZone: BUSINESS_TIME_ZONE,
});

export function pctChange(current: number, previous: number) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function bucketCommissionsByMonth(
  commissions: Array<{ expectedDate: Date; expectedAmount: unknown; actualAmount: unknown }>,
  monthKeys: string[],
) {
  const index = new Map(monthKeys.map((key, i) => [key, i]));
  const buckets = monthKeys.map(() => 0);
  for (const commission of commissions) {
    const bucket = index.get(monthKeyFormatter.format(commission.expectedDate));
    if (bucket !== undefined) {
      buckets[bucket] += toNumber(commission.actualAmount ?? commission.expectedAmount);
    }
  }
  return buckets;
}
