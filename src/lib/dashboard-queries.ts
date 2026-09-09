import { subMonths } from "date-fns";
import { getDb } from "@/lib/db";
import { today } from "@/lib/dates";
import { bucketCommissionsByMonth, bucketDatesByMonth, MONTHLY_COMMISSION_STATUSES, pctChange } from "@/lib/dashboard.logic";
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
  requireOrganizationPortfolioReadScope,
} from "@/lib/portfolio-access";
import { loadEligibleRenewalPolicies } from "@/lib/renewals";

export async function getDashboardData() {
  const db = getDb();
  const scope = await requireOrganizationPortfolioReadScope();
  const now = today();
  const in7 = businessAddDays(now, 7);
  const in60 = businessAddDays(now, 60);
  const monthStart = businessStartOfMonth(now);
  const monthEnd = businessEndOfMonth(now);
  const policyWhere = policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId);
  const receiptWhere = receiptOperationalWhere(scope.portfolioOwnerId, scope.organizationId);
  const commissionWhere = commissionOperationalWhere(scope.portfolioOwnerId, scope.organizationId);
  const upcomingRenewalPoliciesPromise = loadEligibleRenewalPolicies(
    {
      endDate: {
        gte: now,
        lte: in60,
      },
    },
    scope.portfolioOwnerId,
    scope.organizationId,
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
      organizationId: scope.organizationId,
    }),
    countWorkItems({
      workItemTypes: ["TASK"],
      statuses: OPEN_WORK_ITEM_STATUSES,
      priorities: ["URGENT"],
      portfolioOwnerId: scope.portfolioOwnerId,
      organizationId: scope.organizationId,
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
      orderBy: [{ dueDate: "asc" }, { receiptSequence: { sort: "asc", nulls: "last" } }, { receiptNumber: "asc" }, { id: "asc" }],
      take: DASHBOARD_LIST_LIMIT,
    }),
    // Lightweight chart query — only the field we need, capped separately so the
    // urgent list size doesn't silently undercount the weekly chart.
    db.receipt.findMany({
      where: { ...receiptWhere, dueDate: { lte: in60 }, status: { notIn: ["CANCELLED"] } },
      select: { dueDate: true, id: true },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
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
      select: { id: true, expectedDate: true, expectedAmount: true, actualAmount: true },
      orderBy: [{ expectedDate: "asc" }, { id: "asc" }],
      take: 200,
    }),
    db.activityLog.findMany({ where: { organizationId: scope.organizationId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 8 }),
    db.alert.findMany({ where: { organizationId: scope.organizationId, status: "OPEN" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 8 }),
    db.alert.count({ where: { organizationId: scope.organizationId, status: "OPEN", alertType: { startsWith: "SECURITY_" } } }),
    detectRisks(scope.portfolioOwnerId, scope.organizationId),
    getWorkItems({
      workItemTypes: ["TASK"],
      statuses: OPEN_WORK_ITEM_STATUSES,
      limit: 12,
      portfolioOwnerId: scope.portfolioOwnerId,
      organizationId: scope.organizationId,
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
  const scope = await requireOrganizationPortfolioReadScope();
  const [insurers, clients, policies, receipts, dismissedRow] = await Promise.all([
    db.insurer.count({ where: { organizationId: scope.organizationId } }),
    db.client.count({ where: clientOperationalWhere(scope.portfolioOwnerId, scope.organizationId) }),
    db.policy.count({ where: policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId) }),
    db.receipt.count({ where: receiptOperationalWhere(scope.portfolioOwnerId, scope.organizationId) }),
    db.systemSetting.findUnique({ where: { key: `onboardingDismissed:${scope.organizationId}` } }),
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
  const scope = await requireOrganizationPortfolioReadScope();
  const now = today();
  const tomorrow = businessAddDays(now, 1);
  const in7 = businessAddDays(now, 7);
  const in30 = businessAddDays(now, 30);
  const receiptWhere = receiptOperationalWhere(scope.portfolioOwnerId, scope.organizationId);
  const commissionWhere = commissionOperationalWhere(scope.portfolioOwnerId, scope.organizationId);
  const urgentRenewalsPromise = loadEligibleRenewalPolicies(
    {
      endDate: {
        gte: now,
        lte: in30,
      },
    },
    scope.portfolioOwnerId,
    scope.organizationId,
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
      orderBy: [{ dueDate: "asc" }, { receiptSequence: { sort: "asc", nulls: "last" } }, { receiptNumber: "asc" }, { id: "asc" }],
    }),
    db.receipt.findMany({
      where: { ...receiptWhere, dueDate: { lt: now }, status: { notIn: ["PAID", "CANCELLED"] } },
      include: { client: true, policy: true, insurer: true },
      orderBy: [{ dueDate: "asc" }, { receiptSequence: { sort: "asc", nulls: "last" } }, { receiptNumber: "asc" }, { id: "asc" }],
      take: 8,
    }),
    db.receipt.findMany({
      where: { ...receiptWhere, dueDate: { gte: tomorrow, lte: in7 }, status: { notIn: ["PAID", "CANCELLED"] } },
      include: { client: true, policy: true, insurer: true },
      orderBy: [{ dueDate: "asc" }, { receiptSequence: { sort: "asc", nulls: "last" } }, { receiptNumber: "asc" }, { id: "asc" }],
      take: 8,
    }),
    urgentRenewalsPromise,
    getWorkItems({
      workItemTypes: ["TASK"],
      statuses: OPEN_WORK_ITEM_STATUSES,
      to: now,
      limit: 8,
      portfolioOwnerId: scope.portfolioOwnerId,
      organizationId: scope.organizationId,
    }),
    db.client.findMany({
      where: {
        ...clientOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
        workItems: {
          some: { workItemType: "TASK", status: { in: ["OPEN", "WAITING_CLIENT"] } },
        },
      },
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
      take: 6,
    }),
    db.commission.findMany({
      where: {
        ...commissionWhere,
        expectedDate: { lte: in30 },
        status: { in: ["EXPECTED", "PENDING", "OVERDUE"] },
      },
      include: { client: true, policy: true, insurer: true },
      orderBy: [{ expectedDate: "asc" }, { id: "asc" }],
      take: 8,
    }),
    db.activityLog.findMany({ where: { organizationId: scope.organizationId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 8 }),
    detectRisks(scope.portfolioOwnerId, scope.organizationId),
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

// --- Panel principal de /today: métricas con sparkline, gráficas y tablas ---

const monthKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  timeZone: BUSINESS_TIME_ZONE,
});
const monthLabelFormatter = new Intl.DateTimeFormat("es-MX", {
  month: "short",
  timeZone: BUSINESS_TIME_ZONE,
});
const prevMonthLabelFormatter = new Intl.DateTimeFormat("es-MX", {
  month: "short",
  year: "numeric",
  timeZone: BUSINESS_TIME_ZONE,
});

function lastSixMonths(now: Date) {
  const months: Array<{ key: string; label: string }> = [];
  for (let i = 5; i >= 0; i--) {
    const monthDate = subMonths(now, i);
    months.push({
      key: monthKeyFormatter.format(monthDate),
      label: monthLabelFormatter.format(monthDate).replace(".", ""),
    });
  }
  return months;
}

export type TodayDashboardData = Awaited<ReturnType<typeof getTodayDashboardData>>;

export async function getTodayDashboardData() {
  const db = getDb();
  const scope = await requireOrganizationPortfolioReadScope();
  const now = today();
  const in30 = businessAddDays(now, 30);
  const monthStart = businessStartOfMonth(now);
  const monthEnd = businessEndOfMonth(now);
  const prevMonthStart = businessStartOfMonth(subMonths(now, 1));
  const prevMonthEnd = businessEndOfMonth(subMonths(now, 1));
  const trendStart = businessStartOfMonth(subMonths(now, 5));
  const policyWhere = policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId);
  const receiptWhere = receiptOperationalWhere(scope.portfolioOwnerId, scope.organizationId);
  const commissionWhere = commissionOperationalWhere(scope.portfolioOwnerId, scope.organizationId);
  const commissionMonthStatuses = { in: [...MONTHLY_COMMISSION_STATUSES] };
  const overdueRenewalPoliciesPromise = loadEligibleRenewalPolicies(
    { endDate: { lt: now } },
    scope.portfolioOwnerId,
    scope.organizationId,
  );
  // Use the same eligibility rules as the renewal destination list. A raw
  // policy count includes records whose latest receipt or lifecycle makes
  // them ineligible, which caused Hoy and Operations to disagree.
  const upcomingRenewalPoliciesPromise = loadEligibleRenewalPolicies(
    { endDate: { gte: now, lte: in30 } },
    scope.portfolioOwnerId,
    scope.organizationId,
  );

  const [
    activePolicies,
    newPoliciesMonth,
    newPoliciesPrevMonth,
    renewalsMonth,
    renewalsPrevMonth,
    upcomingRenewalPolicies,
    pendingMonthAgg,
    pendingPrevMonthAgg,
    commissionMonthActual,
    commissionMonthExpected,
    commissionPrevActual,
    commissionPrevExpected,
    policiesForTrends,
    policiesForCaptureTrends,
    renewalsForTrends,
    receiptsForBusinessTrends,
    receiptsForCaptureTrends,
    commissionsForTrends,
    policyStatusRows,
    recentPolicies,
    overdueReceiptsCount,
    overdueRenewalPolicies,
    openTasksCount,
  ] = await Promise.all([
    db.policy.count({ where: { ...policyWhere, status: "ACTIVE" } }),
    db.policy.count({ where: { ...policyWhere, startDate: { gte: monthStart, lte: monthEnd } } }),
    db.policy.count({ where: { ...policyWhere, startDate: { gte: prevMonthStart, lte: prevMonthEnd } } }),
    db.policy.count({ where: { ...policyWhere, status: "ACTIVE", endDate: { gte: monthStart, lte: monthEnd } } }),
    db.policy.count({
      where: { ...policyWhere, status: "ACTIVE", endDate: { gte: prevMonthStart, lte: prevMonthEnd } },
    }),
    upcomingRenewalPoliciesPromise,
    db.receipt.aggregate({
      where: { ...receiptWhere, dueDate: { gte: monthStart, lte: monthEnd }, status: { in: ["PENDING", "OVERDUE"] } },
      _sum: { amount: true },
    }),
    db.receipt.aggregate({
      where: { ...receiptWhere, dueDate: { gte: prevMonthStart, lte: prevMonthEnd }, status: { in: ["PENDING", "OVERDUE"] } },
      _sum: { amount: true },
    }),
    db.commission.aggregate({
      where: { ...commissionWhere, expectedDate: { gte: monthStart, lte: monthEnd }, status: commissionMonthStatuses, actualAmount: { not: null } },
      _sum: { actualAmount: true },
    }),
    db.commission.aggregate({
      where: { ...commissionWhere, expectedDate: { gte: monthStart, lte: monthEnd }, status: commissionMonthStatuses, actualAmount: null },
      _sum: { expectedAmount: true },
    }),
    db.commission.aggregate({
      where: { ...commissionWhere, expectedDate: { gte: prevMonthStart, lte: prevMonthEnd }, status: commissionMonthStatuses, actualAmount: { not: null } },
      _sum: { actualAmount: true },
    }),
    db.commission.aggregate({
      where: { ...commissionWhere, expectedDate: { gte: prevMonthStart, lte: prevMonthEnd }, status: commissionMonthStatuses, actualAmount: null },
      _sum: { expectedAmount: true },
    }),
    db.policy.findMany({
      where: { ...policyWhere, startDate: { gte: trendStart } },
      select: { startDate: true },
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
      take: 5000,
    }),
    db.policy.findMany({
      where: { ...policyWhere, createdAt: { gte: trendStart } },
      select: { createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 5000,
    }),
    db.policy.findMany({
      where: { ...policyWhere, status: "ACTIVE", endDate: { gte: trendStart } },
      select: { endDate: true },
      orderBy: [{ endDate: "asc" }, { id: "asc" }],
      take: 5000,
    }),
    db.receipt.findMany({
      where: { ...receiptWhere, periodStartDate: { gte: trendStart }, status: { notIn: ["CANCELLED"] } },
      select: { periodStartDate: true },
      orderBy: [{ periodStartDate: "asc" }, { id: "asc" }],
      take: 5000,
    }),
    db.receipt.findMany({
      where: { ...receiptWhere, createdAt: { gte: trendStart }, status: { notIn: ["CANCELLED"] } },
      select: { createdAt: true, amount: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 5000,
    }),
    db.commission.findMany({
      where: { ...commissionWhere, expectedDate: { gte: trendStart }, status: commissionMonthStatuses },
      select: { expectedDate: true, expectedAmount: true, actualAmount: true },
      orderBy: [{ expectedDate: "asc" }, { id: "asc" }],
      take: 2000,
    }),
    db.policy.groupBy({ by: ["status"], where: policyWhere, _count: { status: true } }),
    db.policy.findMany({
      where: policyWhere,
      include: { client: { select: { fullName: true } }, insurer: { select: { name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 6,
    }),
    db.receipt.count({ where: { ...receiptWhere, dueDate: { lt: now }, status: { notIn: ["PAID", "CANCELLED"] } } }),
    overdueRenewalPoliciesPromise,
    countWorkItems({
      workItemTypes: ["TASK"],
      statuses: OPEN_WORK_ITEM_STATUSES,
      portfolioOwnerId: scope.portfolioOwnerId,
      organizationId: scope.organizationId,
    }),
  ]);

  const months = lastSixMonths(now);
  const monthKeys = months.map((month) => month.key);
  const monthIndex = new Map(monthKeys.map((key, index) => [key, index]));
  const newPoliciesSpark = bucketDatesByMonth(policiesForTrends.map((row) => row.startDate), monthKeys);
  const capturedPoliciesSpark = bucketDatesByMonth(policiesForCaptureTrends.map((row) => row.createdAt), monthKeys);
  const renewalsSpark = bucketDatesByMonth(renewalsForTrends.map((row) => row.endDate), monthKeys);

  const pendingByMonth = months.map(() => 0);
  const receiptsPerMonth = months.map(() => 0);
  const capturedReceiptsPerMonth = months.map(() => 0);
  for (const receipt of receiptsForBusinessTrends) {
    const bucket = monthIndex.get(monthKeyFormatter.format(receipt.periodStartDate));
    if (bucket !== undefined) receiptsPerMonth[bucket] += 1;
  }
  for (const receipt of receiptsForCaptureTrends) {
    const bucket = monthIndex.get(monthKeyFormatter.format(receipt.createdAt));
    if (bucket !== undefined) {
      pendingByMonth[bucket] += toNumber(receipt.amount);
      capturedReceiptsPerMonth[bucket] += 1;
    }
  }

  const commissionsSpark = bucketCommissionsByMonth(commissionsForTrends, months.map((month) => month.key));

  const pendingMonth = toNumber(pendingMonthAgg._sum.amount);
  const pendingPrevMonth = toNumber(pendingPrevMonthAgg._sum.amount);
  const commissionsMonth =
    toNumber(commissionMonthActual._sum.actualAmount) + toNumber(commissionMonthExpected._sum.expectedAmount);
  const commissionsPrevMonth =
    toNumber(commissionPrevActual._sum.actualAmount) + toNumber(commissionPrevExpected._sum.expectedAmount);

  return {
    metrics: {
      activePolicies: {
        value: activePolicies,
        delta: pctChange(newPoliciesMonth, newPoliciesPrevMonth),
        spark: newPoliciesSpark,
      },
      renewals: {
        value: upcomingRenewalPolicies.length,
        delta: pctChange(renewalsMonth, renewalsPrevMonth),
        spark: renewalsSpark,
      },
      pendingReceipts: {
        value: pendingMonth,
        delta: pctChange(pendingMonth, pendingPrevMonth),
        spark: pendingByMonth,
      },
      commissions: {
        value: commissionsMonth,
        delta: pctChange(commissionsMonth, commissionsPrevMonth),
        spark: commissionsSpark,
      },
    },
    activity: months.map((month, i) => ({
      name: month.label.charAt(0).toUpperCase() + month.label.slice(1),
      pólizas: newPoliciesSpark[i],
      recibos: receiptsPerMonth[i],
    })),
    captureActivity: months.map((month, i) => ({
      name: month.label.charAt(0).toUpperCase() + month.label.slice(1),
      pólizas: capturedPoliciesSpark[i],
      recibos: capturedReceiptsPerMonth[i],
    })),
    statusDistribution: policyStatusRows
      .map((row) => ({ status: row.status, value: row._count.status }))
      .sort((a, b) => b.value - a.value),
    recentPolicies: recentPolicies.map((policy) => ({
      id: policy.id,
      policyNumber: policy.policyNumber,
      clientName: policy.client.fullName,
      insurerName: policy.insurer.name,
      policyType: policy.policyType,
      startDate: policy.startDate,
      endDate: policy.endDate,
      premiumAmount: toNumber(policy.premiumAmount),
      currency: policy.currency,
      status: policy.status,
    })),
    alerts: [
      { id: "renewals", label: "Renovaciones próximas", detail: "Próximos 30 días", count: upcomingRenewalPolicies.length, tone: "warning" as const, href: "/operations?view=renewals" },
      { id: "overdue", label: "Cobros vencidos", detail: "Requieren atención", count: overdueReceiptsCount, tone: "critical" as const, href: "/receipts?tab=cobrar" },
      { id: "expired", label: "Renovaciones vencidas", detail: "Sin resolver", count: overdueRenewalPolicies.length, tone: "critical" as const, href: "/operations?view=renewals" },
      { id: "tasks", label: "Pendientes abiertos", detail: "Por resolver", count: openTasksCount, tone: "information" as const, href: "/operations?view=pending" },
    ],
    prevMonthLabel: prevMonthLabelFormatter.format(subMonths(now, 1)).replace(".", ""),
  };
}
