import { getDb } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/auth";
import { addCurrencyTotal, buildMonthlyMetrics, lastMonths, type CurrencyTotals } from "@/lib/platform-metrics";

export type PlatformOrganizationRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  users: number;
  activeUsers: number;
  plan: string;
  mrrByCurrency: CurrencyTotals;
  cashByCurrency: CurrencyTotals;
  lastAccessAt: string | null;
};

export type PlatformOverview = {
  organizationCounts: { total: number; active: number; suspended: number };
  activeUsers: number;
  mrrByCurrency: CurrencyTotals;
  cashThisMonthByCurrency: CurrencyTotals;
  monthlyTrend: ReturnType<typeof buildMonthlyMetrics>;
  organizations: PlatformOrganizationRow[];
};

function activeSubscription(subscription: { status: string; endsAt: Date | null }) {
  return subscription.status === "ACTIVE" && (!subscription.endsAt || subscription.endsAt >= new Date());
}

export async function getPlatformOverview(): Promise<PlatformOverview> {
  await requireSuperAdmin();
  const db = getDb();
  const organizations = await db.organization.findMany({
    orderBy: { name: "asc" },
    include: {
      memberships: { include: { user: { select: { lastLoginAt: true } } } },
      subscriptions: { include: { plan: true } },
      billingCharges: true,
    },
  });
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const mrrByCurrency: CurrencyTotals = {};
  const cashThisMonthByCurrency: CurrencyTotals = {};
  const rows = organizations.map((organization) => {
    const activeSubs = organization.subscriptions.filter(activeSubscription);
    const mrr: CurrencyTotals = {};
    for (const sub of activeSubs) addCurrencyTotal(mrr, sub.currency, sub.monthlyAmountMinor);
    const cash: CurrencyTotals = {};
    for (const charge of organization.billingCharges) {
      const paidAt = charge.paidAt ?? charge.periodStart;
      if (charge.status === "PAID" && paidAt >= monthStart) addCurrencyTotal(cash, charge.currency, charge.amountMinor);
    }
    for (const [currency, amount] of Object.entries(mrr)) addCurrencyTotal(mrrByCurrency, currency, amount);
    for (const [currency, amount] of Object.entries(cash)) addCurrencyTotal(cashThisMonthByCurrency, currency, amount);
    const lastAccessAt = organization.memberships
      .map((membership) => membership.user.lastLoginAt)
      .filter((value): value is Date => Boolean(value))
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
      users: organization.memberships.length,
      activeUsers: organization.memberships.filter((membership) => membership.active).length,
      plan: activeSubs[0]?.plan.name ?? organization.subscriptions[0]?.plan.name ?? "Sin plan",
      mrrByCurrency: mrr,
      cashByCurrency: cash,
      lastAccessAt: lastAccessAt?.toISOString() ?? null,
    } satisfies PlatformOrganizationRow;
  });
  const monthlyTrend = buildMonthlyMetrics(
    lastMonths(6),
    organizations.flatMap((organization) => organization.subscriptions),
    organizations.flatMap((organization) => organization.billingCharges),
  );
  return {
    organizationCounts: {
      total: organizations.length,
      active: organizations.filter((organization) => organization.status === "ACTIVE").length,
      suspended: organizations.filter((organization) => organization.status === "SUSPENDED").length,
    },
    activeUsers: organizations.reduce((total, organization) => total + organization.memberships.filter((membership) => membership.active).length, 0),
    mrrByCurrency,
    cashThisMonthByCurrency,
    monthlyTrend,
    organizations: rows,
  };
}

export async function getPlatformOrganization(organizationId: string) {
  await requireSuperAdmin();
  const db = getDb();
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    include: {
      memberships: { include: { user: { select: { id: true, email: true, name: true, role: true, platformRole: true, active: true, lastLoginAt: true } } }, orderBy: { createdAt: "asc" } },
      subscriptions: { include: { plan: true }, orderBy: { startedAt: "desc" } },
      billingCharges: { orderBy: { periodStart: "desc" }, take: 100 },
    },
  });
  if (!organization) return null;
  const activity = await db.activityLog.findMany({
    where: { organizationId }, orderBy: { createdAt: "desc" }, take: 100,
  });
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    status: organization.status,
    timeZone: organization.timeZone,
    defaultCurrency: organization.defaultCurrency,
    memberships: organization.memberships.map((membership) => ({
      id: membership.id, role: membership.role, active: membership.active,
      user: membership.user, createdAt: membership.createdAt.toISOString(),
    })),
    subscriptions: organization.subscriptions.map((subscription) => ({
      id: subscription.id, status: subscription.status, startedAt: subscription.startedAt.toISOString(), endsAt: subscription.endsAt?.toISOString() ?? null,
      monthlyAmountMinor: subscription.monthlyAmountMinor, currency: subscription.currency,
      plan: { id: subscription.plan.id, code: subscription.plan.code, name: subscription.plan.name },
    })),
    charges: organization.billingCharges.map((charge) => ({
      id: charge.id, periodStart: charge.periodStart.toISOString(), periodEnd: charge.periodEnd.toISOString(), amountMinor: charge.amountMinor,
      currency: charge.currency, status: charge.status, paidAt: charge.paidAt?.toISOString() ?? null, reason: charge.reason,
    })),
    activity: activity.map((entry) => ({ id: entry.id, action: entry.action, entityType: entry.entityType, entityId: entry.entityId, createdAt: entry.createdAt.toISOString(), oldValue: entry.oldValue, newValue: entry.newValue })),
  };
}

export async function getPlatformPlans() {
  await requireSuperAdmin();
  return getDb().plan.findMany({ where: { active: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, monthlyAmountMinor: true, currency: true } });
}
