import { addDays, endOfMonth, format, startOfMonth } from "date-fns";
import { es } from "date-fns/locale";
import { getDb } from "@/lib/db";
import { today } from "@/lib/dates";
import { toNumber } from "@/lib/money";
import { detectRisks } from "@/lib/risk-engine";
import { DASHBOARD_LIST_LIMIT } from "@/lib/constants";

export async function getDashboardData() {
  const db = getDb();
  const now = today();
  const in7 = addDays(now, 7);
  const in60 = addDays(now, 60);
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  const [
    activePolicies,
    duePayments60,
    overduePayments,
    renewals60,
    openTasks,
    urgentTasks,
    commissionsAggregateParts,
    upcomingReceipts,
    upcomingReceiptsForChart,
    upcomingRenewalPolicies,
    upcomingRenewalsForChart,
    insurerDistributionRows,
    policyTypeDistributionRows,
    commissionsByMonthRows,
    recentActivity,
    openAlerts,
    risks,
    criticalTasks,
  ] = await Promise.all([
    db.policy.count({ where: { status: "ACTIVE" } }),
    db.receipt.count({
      where: { dueDate: { gte: now, lte: in60 }, status: { in: ["PENDING", "OVERDUE"] } },
    }),
    db.receipt.count({
      where: { dueDate: { lt: now }, status: { notIn: ["PAID", "CANCELLED"] } },
    }),
    db.policy.count({
      where: { renewalDate: { gte: now, lte: in60 }, status: "ACTIVE" },
    }),
    db.task.count({
      where: { status: { notIn: ["RESOLVED", "CANCELLED", "ARCHIVED"] } },
    }),
    db.task.count({
      where: {
        priority: "URGENT",
        status: { notIn: ["RESOLVED", "CANCELLED", "ARCHIVED"] },
      },
    }),
    // Per-row fallback: actualAmount when set, otherwise expectedAmount.
    // We split into two aggregates to reproduce SUM(COALESCE(actualAmount, expectedAmount))
    // without scanning every row in JS.
    Promise.all([
      db.commission.aggregate({
        where: { status: { in: ["EXPECTED", "PENDING", "OVERDUE"] }, actualAmount: { not: null } },
        _sum: { actualAmount: true },
      }),
      db.commission.aggregate({
        where: { status: { in: ["EXPECTED", "PENDING", "OVERDUE"] }, actualAmount: null },
        _sum: { expectedAmount: true },
      }),
    ]),
    db.receipt.findMany({
      where: { dueDate: { lte: in60 }, status: { notIn: ["CANCELLED"] } },
      include: { client: true, insurer: true, policy: true },
      orderBy: { dueDate: "asc" },
      take: DASHBOARD_LIST_LIMIT,
    }),
    // Lightweight chart query — only the field we need, capped separately so the
    // urgent list size doesn't silently undercount the weekly chart.
    db.receipt.findMany({
      where: { dueDate: { lte: in60 }, status: { notIn: ["CANCELLED"] } },
      select: { dueDate: true },
      orderBy: { dueDate: "asc" },
      take: 500,
    }),
    db.policy.findMany({
      where: { renewalDate: { gte: now, lte: in60 }, status: "ACTIVE" },
      include: { client: true, insurer: true },
      orderBy: { renewalDate: "asc" },
      take: 6,
    }),
    // Lightweight chart query — only the field we need, capped separately so the
    // urgent renewals list size doesn't silently undercount the weekly chart.
    db.policy.findMany({
      where: { renewalDate: { gte: now, lte: in60 }, status: "ACTIVE" },
      select: { renewalDate: true },
      orderBy: { renewalDate: "asc" },
      take: 500,
    }),
    db.policy.groupBy({
      by: ["insurerId"],
      where: { status: "ACTIVE" },
      _count: { insurerId: true },
    }),
    db.policy.groupBy({
      by: ["policyType"],
      _count: { policyType: true },
    }),
    db.commission.findMany({
      where: { status: { in: ["EXPECTED", "PENDING", "OVERDUE"] } },
      select: { expectedDate: true, expectedAmount: true, actualAmount: true },
      take: 200,
    }),
    db.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    db.alert.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 8 }),
    detectRisks(),
    db.task.findMany({
      where: {
        OR: [{ priority: "URGENT" }, { dueDate: { lte: in7 } }],
        status: { notIn: ["RESOLVED", "CANCELLED", "ARCHIVED"] },
      },
      include: { client: true, policy: true, insurer: true },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      take: 6,
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

  const documentsMissing = risks
    .filter((risk) => ["POLICY_MISSING_PDF", "PAID_RECEIPT_WITHOUT_PROOF"].includes(risk.alertType))
    .slice(0, 6);

  return {
    kpis: {
      activePolicies,
      duePayments60,
      overduePayments,
      renewals60,
      openTasks,
      urgentTasks,
      commissionsReceivable,
      risksDetected: risks.length,
    },
    charts: {
      dueByWeek: groupDatesByWeek(upcomingReceiptsForChart, "dueDate"),
      renewalsByWeek: groupDatesByWeek(upcomingRenewalsForChart, "renewalDate"),
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
      criticalTasks,
      recentActivity,
      documentsMissing,
      topRisks: risks.slice(0, 6),
      openAlerts,
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
  const [insurers, clients, policies, receipts, dismissedRow] = await Promise.all([
    db.insurer.count(),
    db.client.count(),
    db.policy.count(),
    db.receipt.count(),
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
  const now = today();
  const tomorrow = addDays(now, 1);
  const in7 = addDays(now, 7);
  const in30 = addDays(now, 30);

  const [
    paymentsDueToday,
    overduePayments,
    paymentsDue7,
    urgentRenewals,
    overdueTasks,
    clientsToContact,
    commissionsToReview,
    recentActivity,
    risks,
  ] = await Promise.all([
    db.receipt.findMany({
      where: { dueDate: { gte: now, lt: tomorrow }, status: { notIn: ["PAID", "CANCELLED"] } },
      include: { client: true, policy: true, insurer: true },
    }),
    db.receipt.findMany({
      where: { dueDate: { lt: now }, status: { notIn: ["PAID", "CANCELLED"] } },
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
      take: 8,
    }),
    db.receipt.findMany({
      where: { dueDate: { gte: tomorrow, lte: in7 }, status: { notIn: ["PAID", "CANCELLED"] } },
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
      take: 8,
    }),
    db.policy.findMany({
      where: { renewalDate: { gte: now, lte: in30 }, status: "ACTIVE" },
      include: { client: true, insurer: true },
      orderBy: { renewalDate: "asc" },
      take: 8,
    }),
    db.task.findMany({
      where: {
        dueDate: { lt: now },
        status: { notIn: ["RESOLVED", "CANCELLED", "ARCHIVED"] },
      },
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
      take: 8,
    }),
    db.client.findMany({
      where: {
        tasks: {
          some: { status: { in: ["OPEN", "WAITING_CLIENT"] } },
        },
      },
      take: 6,
    }),
    db.commission.findMany({
      where: {
        expectedDate: { lte: in30 },
        status: { in: ["EXPECTED", "PENDING", "OVERDUE"] },
      },
      include: { client: true, policy: true, insurer: true },
      orderBy: { expectedDate: "asc" },
      take: 8,
    }),
    db.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    detectRisks(),
  ]);

  return {
    paymentsDueToday,
    overduePayments,
    paymentsDue7,
    urgentRenewals,
    overdueTasks,
    clientsToContact,
    commissionsToReview,
    documentsMissing: risks
      .filter((risk) => ["POLICY_MISSING_PDF", "PAID_RECEIPT_WITHOUT_PROOF"].includes(risk.alertType))
      .slice(0, 6),
    criticalRisks: risks.filter((risk) => risk.severity === "CRITICAL").slice(0, 6),
    recentActivity,
  };
}

function groupDatesByWeek<T extends Record<string, unknown>>(items: T[], field: keyof T) {
  const buckets = new Map<string, number>();

  for (const item of items) {
    const date = item[field] as Date | null;
    if (!date) continue;
    const label = format(date, "MMM d", { locale: es });
    buckets.set(label, (buckets.get(label) ?? 0) + 1);
  }

  return [...buckets.entries()].map(([name, value]) => ({ name, value }));
}

function groupCommissionsByMonth(
  commissions: Array<{ expectedDate: Date; expectedAmount: unknown; actualAmount: unknown }>,
) {
  const buckets = new Map<string, number>();

  for (const commission of commissions) {
    const label = format(commission.expectedDate, "MMM yyyy", { locale: es });
    buckets.set(label, (buckets.get(label) ?? 0) + toNumber(commission.actualAmount ?? commission.expectedAmount));
  }

  return [...buckets.entries()].map(([name, value]) => ({ name, value }));
}
