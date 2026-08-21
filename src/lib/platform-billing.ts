import "server-only";

import { requireSuperAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  buildMonthlyBillingMetrics,
  lastMonths,
  latestMetricTotals,
  type BillingChargeMetricInput,
  type BillingMonthlyMetric,
  type BillingSubscriptionMetricInput,
  type CurrencyTotals,
} from "@/lib/platform-billing.logic";

export const PLATFORM_BILLING_MONTHS = 6;
export const PLATFORM_BILLING_CHARGE_LIMIT = 50;

export type PlatformBillingPlan = {
  id: string;
  code: string;
  name: string;
  monthlyAmountMinor: number;
  currency: string;
  active: boolean;
};

export type PlatformBillingSubscription = {
  id: string;
  requestId: string;
  status: string;
  startedAt: string;
  endsAt: string | null;
  monthlyAmountMinor: number;
  currency: string;
  plan: { id: string; code: string; name: string };
};

export type PlatformBillingCharge = {
  id: string;
  requestId: string;
  periodStart: string;
  periodEnd: string;
  amountMinor: number;
  currency: string;
  status: string;
  paidAt: string | null;
  externalReference: string | null;
  reason: string;
};

export type PlatformBillingOverview = {
  currentMonth: string;
  currentMrrByCurrency: CurrencyTotals;
  cashThisMonthByCurrency: CurrencyTotals;
  monthlyTrend: BillingMonthlyMetric[];
  plans: PlatformBillingPlan[];
  currentSubscriptionCount: number;
  pendingChargeCount: number;
};

export type PlatformBillingDetail = {
  subscriptions: PlatformBillingSubscription[];
  charges: PlatformBillingCharge[];
  plans: PlatformBillingPlan[];
  monthlyTrend: BillingMonthlyMetric[];
};

type BillingMetricRow = {
  month: string;
  currency: string;
  amountMinor: bigint | number;
};

function numericAmount(value: bigint | number) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new Error("POLICYDESK_BILLING_METRIC_OVERFLOW");
  return amount;
}

function toBillingPlan(plan: { id: string; code: string; name: string; monthlyAmountMinor: number; currency: string; active: boolean }): PlatformBillingPlan {
  return plan;
}

function metricMap(months: Date[], mrrRows: BillingMetricRow[], cashRows: BillingMetricRow[]) {
  const metrics = months.map((month): BillingMonthlyMetric => ({ month: month.toISOString().slice(0, 7), mrrByCurrency: {}, cashByCurrency: {} }));
  const byMonth = new Map(metrics.map((metric) => [metric.month, metric]));
  for (const row of mrrRows) {
    const metric = byMonth.get(row.month);
    if (metric) metric.mrrByCurrency[row.currency] = numericAmount(row.amountMinor);
  }
  for (const row of cashRows) {
    const metric = byMonth.get(row.month);
    if (metric) metric.cashByCurrency[row.currency] = numericAmount(row.amountMinor);
  }
  return metrics;
}

async function queryMonthlyMetrics() {
  const db = getDb();
  const months = lastMonths(PLATFORM_BILLING_MONTHS);
  const firstMonth = months[0];
  const lastMonth = new Date(Date.UTC(months.at(-1)!.getUTCFullYear(), months.at(-1)!.getUTCMonth() + 1, 1));
  const [mrrRows, cashRows] = await Promise.all([
    db.$queryRaw<BillingMetricRow[]>`
      WITH months AS (
        SELECT generate_series(
          ${firstMonth}::timestamptz,
          ${lastMonth}::timestamptz - INTERVAL '1 month',
          INTERVAL '1 month'
        ) AS month
      )
      SELECT to_char(months.month, 'YYYY-MM') AS month,
             s."currency" AS currency,
             SUM(s."monthlyAmountMinor")::bigint AS "amountMinor"
      FROM months
      JOIN "OrganizationSubscription" s
        ON s."startedAt" < months.month + INTERVAL '1 month'
       AND (s."endsAt" IS NULL OR s."endsAt" >= months.month + INTERVAL '1 month')
       AND (s."status" IN ('ACTIVE', 'PAST_DUE') OR (s."status" = 'CANCELED' AND s."endsAt" IS NOT NULL))
      GROUP BY months.month, s."currency"
      ORDER BY months.month ASC, s."currency" ASC
    `,
    db.$queryRaw<BillingMetricRow[]>`
      SELECT to_char(date_trunc('month', "paidAt"), 'YYYY-MM') AS month,
             "currency" AS currency,
             SUM("amountMinor")::bigint AS "amountMinor"
      FROM "BillingCharge"
      WHERE "status" = 'PAID'
        AND "paidAt" IS NOT NULL
        AND "paidAt" >= ${firstMonth}
        AND "paidAt" < ${lastMonth}
      GROUP BY date_trunc('month', "paidAt"), "currency"
      ORDER BY date_trunc('month', "paidAt") ASC, "currency" ASC
    `,
  ]);
  return { months, metrics: metricMap(months, mrrRows, cashRows) };
}

export async function getPlatformBillingOverview(): Promise<PlatformBillingOverview> {
  await requireSuperAdmin();
  const db = getDb();
  const [{ months, metrics }, plans, currentSubscriptionCount, pendingChargeCount] = await Promise.all([
    queryMonthlyMetrics(),
    db.plan.findMany({ where: { active: true }, select: { id: true, code: true, name: true, monthlyAmountMinor: true, currency: true, active: true }, orderBy: { code: "asc" } }),
    db.organizationSubscription.count({ where: { status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } } }),
    db.billingCharge.count({ where: { status: "PENDING" } }),
  ]);
  const current = latestMetricTotals(metrics);
  return {
    currentMonth: current.month || months.at(-1)!.toISOString().slice(0, 7),
    currentMrrByCurrency: current.mrrByCurrency,
    cashThisMonthByCurrency: current.cashByCurrency,
    monthlyTrend: metrics,
    plans: plans.map(toBillingPlan),
    currentSubscriptionCount,
    pendingChargeCount,
  };
}

export async function getPlatformBillingDetail(organizationId: string): Promise<PlatformBillingDetail | null> {
  await requireSuperAdmin();
  const db = getDb();
  const [organization, subscriptions, charges, plans] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { id: true } }),
    db.organizationSubscription.findMany({
      where: { organizationId },
      select: { id: true, requestId: true, status: true, startedAt: true, endsAt: true, monthlyAmountMinor: true, currency: true, plan: { select: { id: true, code: true, name: true } } },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    }),
    db.billingCharge.findMany({
      where: { organizationId },
      select: { id: true, requestId: true, periodStart: true, periodEnd: true, amountMinor: true, currency: true, status: true, paidAt: true, externalReference: true, reason: true },
      orderBy: [{ periodStart: "desc" }, { id: "desc" }],
      take: PLATFORM_BILLING_CHARGE_LIMIT,
    }),
    db.plan.findMany({ where: { active: true }, select: { id: true, code: true, name: true, monthlyAmountMinor: true, currency: true, active: true }, orderBy: { code: "asc" } }),
  ]);
  if (!organization) return null;

  const months = lastMonths(PLATFORM_BILLING_MONTHS);

  const subscriptionMetrics: BillingSubscriptionMetricInput[] = subscriptions.map((subscription) => ({
    status: subscription.status,
    monthlyAmountMinor: subscription.monthlyAmountMinor,
    currency: subscription.currency,
    startedAt: subscription.startedAt,
    endsAt: subscription.endsAt,
  }));
  const chargeMetrics: BillingChargeMetricInput[] = charges.map((charge) => ({
    status: charge.status,
    amountMinor: charge.amountMinor,
    currency: charge.currency,
    paidAt: charge.paidAt,
  }));
  const monthlyTrend = buildMonthlyBillingMetrics(months, subscriptionMetrics, chargeMetrics);

  return {
    subscriptions: subscriptions.map((subscription) => ({ ...subscription, startedAt: subscription.startedAt.toISOString(), endsAt: subscription.endsAt?.toISOString() ?? null })),
    charges: charges.map((charge) => ({ ...charge, periodStart: charge.periodStart.toISOString(), periodEnd: charge.periodEnd.toISOString(), paidAt: charge.paidAt?.toISOString() ?? null })),
    plans: plans.map(toBillingPlan),
    monthlyTrend,
  };
}
