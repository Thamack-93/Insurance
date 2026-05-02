import { addDays, endOfMonth, format, startOfMonth } from "date-fns";
import { es } from "date-fns/locale";
import { getDb } from "@/lib/db";
import { daysUntil, today } from "@/lib/dates";
import { toNumber } from "@/lib/money";
import { detectRisks } from "@/lib/risk-engine";

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
    commissions,
    receipts,
    policies,
    insurers,
    recentActivity,
    openAlerts,
    risks,
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
    db.commission.findMany({
      where: { status: { in: ["EXPECTED", "PENDING", "OVERDUE"] } },
      include: { insurer: true, client: true, policy: true },
    }),
    db.receipt.findMany({
      where: { status: { notIn: ["CANCELLED"] } },
      include: { client: true, insurer: true, policy: true },
      orderBy: { dueDate: "asc" },
    }),
    db.policy.findMany({ include: { insurer: true, client: true } }),
    db.insurer.findMany({ include: { policies: true } }),
    db.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    db.alert.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 8 }),
    detectRisks(),
  ]);

  const commissionsReceivable = commissions.reduce(
    (sum, commission) => sum + toNumber(commission.actualAmount ?? commission.expectedAmount),
    0,
  );

  const urgentPayments = receipts
    .filter((receipt) => receipt.status !== "PAID" && daysUntil(receipt.dueDate) <= 7)
    .slice(0, 6);

  const urgentRenewals = policies
    .filter((policy) => policy.renewalDate && daysUntil(policy.renewalDate) <= 60)
    .sort((a, b) => Number(a.renewalDate) - Number(b.renewalDate))
    .slice(0, 6);

  const criticalTasks = await db.task.findMany({
    where: {
      OR: [{ priority: "URGENT" }, { dueDate: { lte: in7 } }],
      status: { notIn: ["RESOLVED", "CANCELLED", "ARCHIVED"] },
    },
    include: { client: true, policy: true, insurer: true },
    orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
    take: 6,
  });

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
      dueByWeek: groupDatesByWeek(receipts.filter((receipt) => receipt.dueDate <= in60), "dueDate"),
      renewalsByWeek: groupDatesByWeek(
        policies.filter((policy) => policy.renewalDate && policy.renewalDate <= in60),
        "renewalDate",
      ),
      policyTypeDistribution: groupByCount(policies, (policy) => policy.policyType),
      insurerDistribution: insurers.map((insurer) => ({
        name: insurer.name,
        value: insurer.policies.length,
      })),
      commissionsByMonth: groupCommissionsByMonth(commissions),
    },
    sections: {
      urgentPayments,
      urgentRenewals,
      criticalTasks,
      recentActivity,
      documentsMissing,
      topRisks: risks.slice(0, 6),
      openAlerts,
      monthRange: { monthStart, monthEnd },
    },
  };
}

export async function getTodayData() {
  const db = getDb();
  const now = today();
  const tomorrow = addDays(now, 1);
  const in7 = addDays(now, 7);
  const in30 = addDays(now, 30);
  const risks = await detectRisks();

  const [
    paymentsDueToday,
    overduePayments,
    paymentsDue7,
    urgentRenewals,
    overdueTasks,
    clientsToContact,
    commissionsToReview,
    recentActivity,
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
          some: {
            status: { in: ["OPEN", "WAITING_CLIENT"] },
          },
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
  ]);

  return {
    paymentsDueToday,
    overduePayments,
    paymentsDue7,
    urgentRenewals,
    overdueTasks,
    clientsToContact,
    commissionsToReview,
    documentsMissing: risks.filter((risk) => ["POLICY_MISSING_PDF", "PAID_RECEIPT_WITHOUT_PROOF"].includes(risk.alertType)).slice(0, 6),
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

function groupByCount<T>(items: T[], getKey: (item: T) => string) {
  const buckets = new Map<string, number>();

  for (const item of items) {
    const key = getKey(item);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
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
