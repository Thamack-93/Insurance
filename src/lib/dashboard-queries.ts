import { getDb } from "@/lib/db";
import { today } from "@/lib/dates";
import { BUSINESS_TIME_ZONE, businessAddDays, businessEndOfMonth, businessStartOfMonth } from "@/lib/business-dates";
import { toNumber } from "@/lib/money";
import { detectRisks } from "@/lib/risk-engine";
import { DASHBOARD_LIST_LIMIT } from "@/lib/constants";
import { OPEN_WORK_ITEM_STATUSES, countWorkItems, getWorkItems } from "@/lib/work-queue";
import {
  commissionOperationalWhere,
  clientOperationalWhere,
  policyOperationalWhere,
  receiptOperationalWhere,
  requirePortfolioReadScope,
} from "@/lib/portfolio-access";
import { loadEligibleRenewalPolicies } from "@/lib/renewals";

export async function getDashboardData() {
  const db = getDb();
  const scope = await requirePortfolioReadScope();
  const now = today();
  const in7 = businessAddDays(now, 7);
  const in60 = businessAddDays(now, 60);
  const monthStart = businessStartOfMonth(now);
  const monthEnd = businessEndOfMonth(now);
  const policyWhere = policyOperationalWhere(scope.portfolioOwnerId);
  const receiptWhere = receiptOperationalWhere(scope.portfolioOwnerId);
  const commissionWhere = commissionOperationalWhere(scope.portfolioOwnerId);
  const upcomingRenewalPoliciesPromise = loadEligibleRenewalPolicies(
    {
      endDate: {
        gte: now,
        lte: in60,
      },
    },
    scope.portfolioOwnerId,
  );

  const [
    activePolicies,
    duePayments60,
    overduePayments,
    upcomingRenewalPolicies,
    openWorkItems,
    urgentWorkItems,
    commissionsAggregateParts,
    upcomingReceipts,
    upcomingReceiptsForChart,
    insurerDistributionRows,
    policyTypeDistributionRows,
    commissionsByMonthRows,
    recentActivity,
    openNotifications,
    securityAlerts,
    risks,
    criticalWorkItems,
  ] = await Promise.all([
    db.policy.count({ where: { ...policyWhere, status: "ACTIVE" } }),
    db.receipt.count({
      where: { ...receiptWhere, dueDate: { gte: now, lte: in60 }, status: { in: ["PENDING", "OVERDUE"] } },
    }),
    db.receipt.count({
      where: { ...receiptWhere, dueDate: { lt: now }, status: { notIn: ["PAID", "CANCELLED"] } },
    }),
    upcomingRenewalPoliciesPromise,
    countWorkItems({
      workItemTypes: ["TASK"],
      statuses: OPEN_WORK_ITEM_STATUSES,
      portfolioOwnerId: scope.portfolioOwnerId,
    }),
    countWorkItems({
      workItemTypes: ["TASK"],
      statuses: OPEN_WORK_ITEM_STATUSES,
      priorities: ["URGENT"],
      portfolioOwnerId: scope.portfolioOwnerId,
    }),
    // Per-row fallback: actualAmount when set, otherwise expectedAmount.
    // We split into two aggregates to reproduce SUM(COALESCE(actualAmount, expectedAmount))
    // without scanning every row in JS.
    Promise.all([
      db.commission.aggregate({
        where: { ...commissionWhere, status: { in: ["EXPECTED", "PENDING", "OVERDUE"] }, actualAmount: { not: null } },
        _sum: { actualAmount: true },
      }),
      db.commission.aggregate({
        where: { ...commissionWhere, status: { in: ["EXPECTED", "PENDING", "OVERDUE"] }, actualAmount: null },
        _sum: { expectedAmount: true },
      }),
    ]),
    db.receipt.findMany({
      where: { ...receiptWhere, dueDate: { lte: in60 }, status: { notIn: ["CANCELLED"] } },
      include: { client: true, insurer: true, policy: true },
      orderBy: { dueDate: "asc" },
      take: DASHBOARD_LIST_LIMIT,
    }),
    // Lightweight chart query — only the field we need, capped separately so the
    // urgent list size doesn't silently undercount the weekly chart.
    db.receipt.findMany({
      where: { ...receiptWhere, dueDate: { lte: in60 }, status: { notIn: ["CANCELLED"] } },
      select: { dueDate: true },
      orderBy: { dueDate: "asc" },
      take: 500,
    }),
    db.policy.groupBy({
      by: ["insurerId"],
      where: { ...policyWhere, status: "ACTIVE" },
      _count: { insurerId: true },
    }),
    db.policy.groupBy({
      by: ["policyType"],
      where: policyWhere,
      _count: { policyType: true },
    }),
    db.commission.findMany({
      where: { ...commissionWhere, status: { in: ["EXPECTED", "PENDING", "OVERDUE"] } },
      select: { expectedDate: true, expectedAmount: true, actualAmount: true },
      take: 200,
    }),
    db.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    db.alert.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 8 }),
    db.alert.count({ where: { status: "OPEN", alertType: { startsWith: "SECURITY_" } } }),
    detectRisks(scope.portfolioOwnerId),
    getWorkItems({
      workItemTypes: ["TASK"],
      statuses: OPEN_WORK_ITEM_STATUSES,
      limit: 12,
      portfolioOwnerId: scope.portfolioOwnerId,
    }),
  ]);

  const insurerIds = insurerDistributionRows.map((row) => row.insurerId);
  const insurerNamesById = new Map(
    insurerIds.length
      ? (await db.insurer.findMany({ where: { id: { in: insurerIds } }, select: { id: true, name: true } })).map(
          (insurer) => [insurer.id, insurer.name] as const,
        )
      : [],
  );

  const [actualSumAgg, expectedFallbackAgg] = commissionsAggregateParts;
  const commissionsReceivable =
    toNumber(actualSumAgg._sum.actualAmount) + toNumber(expectedFallbackAgg._sum.expectedAmount);

  const urgentPayments = upcomingReceipts
    .filter((receipt) => receipt.status !== "PAID" && receipt.dueDate <= in7)
    .slice(0, 6);

  return {
    kpis: {
      activePolicies,
      duePayments60,
      overduePayments,
      renewals60: upcomingRenewalPolicies.length,
      openWorkItems,
      urgentWorkItems,
      commissionsReceivable,
      risksDetected: risks.length,
      securityAlerts,
    },
    charts: {
      dueByWeek: groupDatesByWeek(upcomingReceiptsForChart, "dueDate"),
      renewalsByWeek: groupDatesByWeek(upcomingRenewalPolicies, "endDate"),
      policyTypeDistribution: policyTypeDistributionRows.map((row) => ({
        name: row.policyType,
        value: row._count.policyType,
      })),
      insurerDistribution: insurerDistributionRows.map((row) => ({
        name: insurerNamesById.get(row.insurerId) ?? "—",
        value: row._count.insurerId,
      })),
      commissionsByMonth: groupCommissionsByMonth(commissionsByMonthRows),
    },
    sections: {
      urgentPayments,
      urgentRenewals: upcomingRenewalPolicies,
      criticalWorkItems,
      recentActivity,
      topRisks: risks.slice(0, 6),
      openNotifications,
      monthRange: { monthStart, monthEnd },
    },
  };
}

export type OnboardingStatus = {
  insurers: number;
  clients: number;
  policies: number;
  receipts: number;
  dismissed: boolean;
  complete: boolean;
};

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const db = getDb();
  const scope = await requirePortfolioReadScope();
  const [insurers, clients, policies, receipts, dismissedRow] = await Promise.all([
    db.insurer.count(),
    db.client.count({ where: clientOperationalWhere(scope.portfolioOwnerId) }),
    db.policy.count({ where: policyOperationalWhere(scope.portfolioOwnerId) }),
    db.receipt.count({ where: receiptOperationalWhere(scope.portfolioOwnerId) }),
    db.systemSetting.findUnique({ where: { key: "onboardingDismissed" } }),
  ]);
  return {
    insurers,
    clients,
    policies,
    receipts,
    dismissed: dismissedRow?.value === "true",
    complete: insurers > 0 && clients > 0 && policies > 0 && receipts > 0,
  };
}

export async function getTodayData() {
  const db = getDb();
  const scope = await requirePortfolioReadScope();
  const now = today();
  const tomorrow = businessAddDays(now, 1);
  const in7 = businessAddDays(now, 7);
  const in30 = businessAddDays(now, 30);
  const receiptWhere = receiptOperationalWhere(scope.portfolioOwnerId);
  const commissionWhere = commissionOperationalWhere(scope.portfolioOwnerId);
  const urgentRenewalsPromise = loadEligibleRenewalPolicies(
    {
      endDate: {
        gte: now,
        lte: in30,
      },
    },
    scope.portfolioOwnerId,
  );

  const [
    paymentsDueToday,
    overduePayments,
    paymentsDue7,
    urgentRenewals,
    overdueWorkItems,
    clientsToContact,
    commissionsToReview,
    recentActivity,
    risks,
  ] = await Promise.all([
    db.receipt.findMany({
      where: { ...receiptWhere, dueDate: { gte: now, lt: tomorrow }, status: { notIn: ["PAID", "CANCELLED"] } },
      include: { client: true, policy: true, insurer: true },
    }),
    db.receipt.findMany({
      where: { ...receiptWhere, dueDate: { lt: now }, status: { notIn: ["PAID", "CANCELLED"] } },
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
      take: 8,
    }),
    db.receipt.findMany({
      where: { ...receiptWhere, dueDate: { gte: tomorrow, lte: in7 }, status: { notIn: ["PAID", "CANCELLED"] } },
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
      take: 8,
    }),
    urgentRenewalsPromise,
    getWorkItems({
      workItemTypes: ["TASK"],
      statuses: OPEN_WORK_ITEM_STATUSES,
      to: now,
      limit: 8,
      portfolioOwnerId: scope.portfolioOwnerId,
    }),
    db.client.findMany({
      where: {
        ...clientOperationalWhere(scope.portfolioOwnerId),
        workItems: {
          some: { workItemType: "TASK", status: { in: ["OPEN", "WAITING_CLIENT"] } },
        },
      },
      take: 6,
    }),
    db.commission.findMany({
      where: {
        ...commissionWhere,
        expectedDate: { lte: in30 },
        status: { in: ["EXPECTED", "PENDING", "OVERDUE"] },
      },
      include: { client: true, policy: true, insurer: true },
      orderBy: { expectedDate: "asc" },
      take: 8,
    }),
    db.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    detectRisks(scope.portfolioOwnerId),
  ]);

  const overdueWorkItemRows = overdueWorkItems.map((item) => ({
    id: item.id,
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    workItemType: item.workItemType,
    entityType: item.entityType,
    entityId: item.entityId,
    clientId: item.clientId,
    policyId: item.policyId,
    receiptId: item.receiptId,
    folio: item.folio ?? item.sourceId ?? item.id,
    title: item.title,
    status: item.status,
    priority: item.priority,
    startDate: item.startDate,
    dueDate: item.dueDate,
    client: item.client,
    policy: item.policy,
    insurer: item.insurer,
    receipt: item.receipt,
  }));

  return {
    paymentsDueToday,
    overduePayments,
    paymentsDue7,
    urgentRenewals,
    overdueWorkItems: overdueWorkItemRows,
    clientsToContact,
    commissionsToReview,
    criticalRisks: risks.filter((risk) => risk.severity === "CRITICAL").slice(0, 6),
    recentActivity,
  };
}

function groupDatesByWeek<T extends Record<string, unknown>>(items: T[], field: keyof T) {
  const buckets = new Map<string, number>();
  const formatter = new Intl.DateTimeFormat("es-MX", {
    month: "short",
    day: "numeric",
    timeZone: BUSINESS_TIME_ZONE,
  });

  for (const item of items) {
    const date = item[field] as Date | null;
    if (!date) continue;
    const label = formatter.format(date);
    buckets.set(label, (buckets.get(label) ?? 0) + 1);
  }

  return [...buckets.entries()].map(([name, value]) => ({ name, value }));
}

function groupCommissionsByMonth(
  commissions: Array<{ expectedDate: Date; expectedAmount: unknown; actualAmount: unknown }>,
) {
  const buckets = new Map<string, number>();
  const formatter = new Intl.DateTimeFormat("es-MX", {
    month: "short",
    year: "numeric",
    timeZone: BUSINESS_TIME_ZONE,
  });

  for (const commission of commissions) {
    const label = formatter.format(commission.expectedDate);
    buckets.set(label, (buckets.get(label) ?? 0) + toNumber(commission.actualAmount ?? commission.expectedAmount));
  }

  return [...buckets.entries()].map(([name, value]) => ({ name, value }));
}
