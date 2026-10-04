import { subMonths } from "date-fns";
import { today } from "@/lib/dates";
import { bucketCommissionsByMonth, bucketDatesByMonth, MONTHLY_COMMISSION_STATUSES, pctChange } from "@/lib/dashboard.logic";
import { BUSINESS_TIME_ZONE, businessAddDays, businessEndOfMonth, businessStartOfMonth, getBusinessDateParts } from "@/lib/business-dates";
import { toNumber } from "@/lib/money";
import { convertMoneyValue, loadCurrencyRates, summarizeMoney } from "@/lib/currency-rates";
import { detectRisks } from "@/lib/risk-engine";
import { DASHBOARD_LIST_LIMIT } from "@/lib/constants";
import { OPEN_WORK_ITEM_STATUSES, countWorkItems, getWorkItems } from "@/lib/work-queue";
import {
  commissionOperationalWhere,
  clientOperationalWhere,
  policyOperationalWhere,
  receiptOperationalWhere,
  type PortfolioReadScope,
  requireOrganizationPortfolioReadScope,
} from "@/lib/portfolio-access";
import { loadEligibleRenewalPolicies } from "@/lib/renewals";
import { withTenantOrganization, type TenantDb } from "@/lib/tenant-dal";

export async function getDashboardData() {
  const scope = await requireOrganizationPortfolioReadScope();
  return withTenantOrganization(scope.organizationId, async (db) => {
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
    db,
  );
  const [
    activePolicies,
    duePayments60,
    overduePayments,
    upcomingRenewalPolicies,
    openWorkItems,
    urgentWorkItems,
    commissionsReceivableRows,
    ratesForDashboard,
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
    }, db),
    countWorkItems({
      workItemTypes: ["TASK"],
      statuses: OPEN_WORK_ITEM_STATUSES,
      priorities: ["URGENT"],
      portfolioOwnerId: scope.portfolioOwnerId,
      organizationId: scope.organizationId,
    }, db),
    db.commission.findMany({
      where: { ...commissionWhere, status: { in: ["EXPECTED", "PENDING", "OVERDUE"] } },
      select: {
        expectedAmount: true,
        actualAmount: true,
        expectedDate: true,
        policy: { select: { currency: true } },
      },
    }),
    loadCurrencyRates(db, scope.organizationId, now),
    db.receipt.findMany({
      where: { ...receiptWhere, dueDate: { lte: in60 }, status: { in: ["PENDING", "OVERDUE"] } },
      include: { client: true, insurer: true, policy: true },
      orderBy: [{ dueDate: "asc" }, { receiptSequence: { sort: "asc", nulls: "last" } }, { receiptNumber: "asc" }, { id: "asc" }],
      take: DASHBOARD_LIST_LIMIT,
    }),
    // Chart source is complete; the urgent list preview is capped independently.
    db.receipt.findMany({
      where: { ...receiptWhere, dueDate: { lte: in60 }, status: { in: ["PENDING", "OVERDUE"] } },
      select: { dueDate: true, id: true },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    }),
    db.policy.groupBy({
      by: ["insurerId"],
      where: { ...policyWhere, status: "ACTIVE" },
      _count: { insurerId: true },
    }),
    db.policy.groupBy({
      by: ["policyType"],
      where: { ...policyWhere, status: "ACTIVE" },
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
    detectRisks(scope.portfolioOwnerId, scope.organizationId, db),
    getWorkItems({
      workItemTypes: ["TASK"],
      statuses: OPEN_WORK_ITEM_STATUSES,
      limit: 12,
      portfolioOwnerId: scope.portfolioOwnerId,
      organizationId: scope.organizationId,
    }, db),
  ]);

  const insurerIds = insurerDistributionRows.map((row) => row.insurerId);
  const insurerNamesById = new Map(
    insurerIds.length
      ? (await db.insurer.findMany({ where: { id: { in: insurerIds } }, select: { id: true, name: true } })).map(
          (insurer) => [insurer.id, insurer.name] as const,
        )
      : [],
  );

  const commissionsReceivableMoney = summarizeMoney(
    commissionsReceivableRows.map((row) => convertMoneyValue(
      row.actualAmount ?? row.expectedAmount,
      row.policy.currency,
      row.expectedDate,
      ratesForDashboard,
    )),
  );
  const commissionsReceivable = commissionsReceivableMoney.totalMxn === null
    ? null
    : toNumber(commissionsReceivableMoney.totalMxn);

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
      commissionsReceivableMoney,
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
  });
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
  const scope = await requireOrganizationPortfolioReadScope();
  return withTenantOrganization(scope.organizationId, (db) => getOnboardingStatusFromDb(scope, db));
}

export async function getOnboardingStatusFromDb(scope: PortfolioReadScope, db: TenantDb): Promise<OnboardingStatus> {
  const [insurers, clients, policies, receipts, dismissedRow] = await Promise.all([
    db.insurer.count({ where: { organizationId: scope.organizationId } }),
    db.client.count({ where: clientOperationalWhere(scope.portfolioOwnerId, scope.organizationId) }),
    db.policy.count({ where: policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId) }),
    db.receipt.count({ where: receiptOperationalWhere(scope.portfolioOwnerId, scope.organizationId) }),
    db.organizationSetting.findUnique({ where: { organizationId_key: { organizationId: scope.organizationId, key: "onboardingDismissed" } } }),
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
  const scope = await requireOrganizationPortfolioReadScope();
  return withTenantOrganization(scope.organizationId, async (db) => {
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
    db,
  );

  const [
    paymentsDueToday,
    overduePayments,
    paymentsDue7,
    urgentRenewals,
    overdueWorkItems,
    dueTodayWorkItems,
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
      to: businessAddDays(now, -1),
      limit: 8,
      portfolioOwnerId: scope.portfolioOwnerId,
      organizationId: scope.organizationId,
    }, db),
    getWorkItems({
      workItemTypes: ["TASK"],
      statuses: OPEN_WORK_ITEM_STATUSES,
      from: now,
      to: now,
      limit: 8,
      portfolioOwnerId: scope.portfolioOwnerId,
      organizationId: scope.organizationId,
    }, db),
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
    detectRisks(scope.portfolioOwnerId, scope.organizationId, db),
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
    dueTodayWorkItems,
    clientsToContact,
    commissionsToReview,
    criticalRisks: risks.filter((risk) => risk.severity === "CRITICAL").slice(0, 6),
    recentActivity,
  };
  });
}

function groupDatesByWeek<T extends Record<string, unknown>>(items: T[], field: keyof T) {
  const buckets = new Map<string, number>();

  for (const item of items) {
    const date = item[field] as Date | null;
    if (!date) continue;
    const parts = getBusinessDateParts(date, BUSINESS_TIME_ZONE);
    const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    const mondayOffset = (day.getUTCDay() + 6) % 7;
    const monday = new Date(day.getTime() - mondayOffset * 86_400_000);
    const sunday = new Date(monday.getTime() + 6 * 86_400_000);
    const labelFormatter = new Intl.DateTimeFormat("es-MX", { month: "short", day: "numeric", timeZone: BUSINESS_TIME_ZONE });
    const label = `${labelFormatter.format(monday)}–${labelFormatter.format(sunday)}`;
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
  const scope = await requireOrganizationPortfolioReadScope();
  return withTenantOrganization(scope.organizationId, async (db) => {
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
    db,
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
    pendingMonthRows,
    pendingPrevMonthRows,
    commissionMonthActualRows,
    commissionMonthExpectedRows,
    commissionPrevActualRows,
    commissionPrevExpectedRows,
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
    ratesForDashboard,
  ] = await Promise.all([
    db.policy.count({ where: { ...policyWhere, status: "ACTIVE" } }),
    db.policy.count({ where: { ...policyWhere, startDate: { gte: monthStart, lte: monthEnd } } }),
    db.policy.count({ where: { ...policyWhere, startDate: { gte: prevMonthStart, lte: prevMonthEnd } } }),
    db.policy.count({ where: { ...policyWhere, status: "ACTIVE", endDate: { gte: monthStart, lte: monthEnd } } }),
    db.policy.count({
      where: { ...policyWhere, status: "ACTIVE", endDate: { gte: prevMonthStart, lte: prevMonthEnd } },
    }),
    upcomingRenewalPoliciesPromise,
    db.receipt.findMany({
      where: { ...receiptWhere, dueDate: { gte: monthStart, lte: monthEnd }, status: { in: ["PENDING", "OVERDUE"] } },
      select: { amount: true, currency: true, dueDate: true },
    }),
    db.receipt.findMany({
      where: { ...receiptWhere, dueDate: { gte: prevMonthStart, lte: prevMonthEnd }, status: { in: ["PENDING", "OVERDUE"] } },
      select: { amount: true, currency: true, dueDate: true },
    }),
    db.commission.findMany({
      where: { ...commissionWhere, expectedDate: { gte: monthStart, lte: monthEnd }, status: commissionMonthStatuses, actualAmount: { not: null } },
      select: { expectedDate: true, expectedAmount: true, actualAmount: true, policy: { select: { currency: true } } },
    }),
    db.commission.findMany({
      where: { ...commissionWhere, expectedDate: { gte: monthStart, lte: monthEnd }, status: commissionMonthStatuses, actualAmount: null },
      select: { expectedDate: true, expectedAmount: true, actualAmount: true, policy: { select: { currency: true } } },
    }),
    db.commission.findMany({
      where: { ...commissionWhere, expectedDate: { gte: prevMonthStart, lte: prevMonthEnd }, status: commissionMonthStatuses, actualAmount: { not: null } },
      select: { expectedDate: true, expectedAmount: true, actualAmount: true, policy: { select: { currency: true } } },
    }),
    db.commission.findMany({
      where: { ...commissionWhere, expectedDate: { gte: prevMonthStart, lte: prevMonthEnd }, status: commissionMonthStatuses, actualAmount: null },
      select: { expectedDate: true, expectedAmount: true, actualAmount: true, policy: { select: { currency: true } } },
    }),
    db.policy.findMany({
      where: { ...policyWhere, startDate: { gte: trendStart } },
      select: { startDate: true },
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
    }),
    db.policy.findMany({
      where: { ...policyWhere, createdAt: { gte: trendStart } },
      select: { createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    db.policy.findMany({
      where: { ...policyWhere, status: "ACTIVE", endDate: { gte: trendStart } },
      select: { endDate: true },
      orderBy: [{ endDate: "asc" }, { id: "asc" }],
    }),
    db.receipt.findMany({
      where: { ...receiptWhere, periodStartDate: { gte: trendStart }, status: { notIn: ["CANCELLED"] } },
      select: { periodStartDate: true },
      orderBy: [{ periodStartDate: "asc" }, { id: "asc" }],
    }),
    db.receipt.findMany({
      where: { ...receiptWhere, createdAt: { gte: trendStart }, status: { notIn: ["CANCELLED"] } },
      select: { createdAt: true, amount: true, currency: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    db.commission.findMany({
      where: { ...commissionWhere, expectedDate: { gte: trendStart }, status: commissionMonthStatuses },
      select: { expectedDate: true, expectedAmount: true, actualAmount: true, policy: { select: { currency: true } } },
      orderBy: [{ expectedDate: "asc" }, { id: "asc" }],
    }),
    db.policy.groupBy({ by: ["status"], where: policyWhere, _count: { status: true } }),
    db.policy.findMany({
      where: policyWhere,
      include: {
        client: { select: { fullName: true } },
        insurer: { select: { name: true } },
        insuredAssets: { select: { description: true, isPrimary: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      },
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
    }, db),
    loadCurrencyRates(db, scope.organizationId, monthEnd),
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
      pendingByMonth[bucket] += toNumber(convertMoneyValue(receipt.amount, receipt.currency, receipt.createdAt, ratesForDashboard).amountMxn);
      capturedReceiptsPerMonth[bucket] += 1;
    }
  }

  const commissionsSpark = bucketCommissionsByMonth(
    commissionsForTrends.map((row) => {
      const money = convertMoneyValue(row.actualAmount ?? row.expectedAmount, row.policy.currency, row.expectedDate, ratesForDashboard);
      return { expectedDate: row.expectedDate, expectedAmount: money.amountMxn ?? 0, actualAmount: null };
    }),
    months.map((month) => month.key),
  );

  const pendingMonthMoney = summarizeMoney(pendingMonthRows.map((row) => convertMoneyValue(row.amount, row.currency, row.dueDate, ratesForDashboard)));
  const pendingPrevMonthMoney = summarizeMoney(pendingPrevMonthRows.map((row) => convertMoneyValue(row.amount, row.currency, row.dueDate, ratesForDashboard)));
  const commissionsMonthRows = [...commissionMonthActualRows, ...commissionMonthExpectedRows];
  const commissionsPrevMonthRows = [...commissionPrevActualRows, ...commissionPrevExpectedRows];
  const commissionsMonthMoney = summarizeMoney(commissionsMonthRows.map((row) => convertMoneyValue(row.actualAmount ?? row.expectedAmount, row.policy.currency, row.expectedDate, ratesForDashboard)));
  const commissionsPrevMonthMoney = summarizeMoney(commissionsPrevMonthRows.map((row) => convertMoneyValue(row.actualAmount ?? row.expectedAmount, row.policy.currency, row.expectedDate, ratesForDashboard)));
  const pendingMonth = toNumber(pendingMonthMoney.totalMxn);
  const pendingPrevMonth = toNumber(pendingPrevMonthMoney.totalMxn);
  const commissionsMonth = toNumber(commissionsMonthMoney.totalMxn);
  const commissionsPrevMonth = toNumber(commissionsPrevMonthMoney.totalMxn);

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
        currency: "MXN",
        money: pendingMonthMoney,
        delta: pctChange(pendingMonth, pendingPrevMonth),
        spark: pendingByMonth,
      },
      commissions: {
        value: commissionsMonth,
        currency: "MXN",
        money: commissionsMonthMoney,
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
      insuredObject: policy.insuredObject,
      insuredAssets: policy.insuredAssets,
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
  });
}
