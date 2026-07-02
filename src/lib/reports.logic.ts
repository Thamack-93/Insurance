// Pure business logic for reports - no "use server"
// This file can be imported in tests without Next.js context

import { subMonths, subYears } from "date-fns";
import {
  businessEndOfMonth,
  businessStartOfMonth,
  businessToday,
  formatBusinessDateInput,
  parseBusinessDateInput,
} from "@/lib/business-dates";

// es-MX locale constants
const MONTH_NAMES_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export interface FinancialMetrics {
  totalPremium: number;
  totalReceipts: number;
  paidReceipts: number;
  pendingReceipts: number;
  totalCommission: number;
  averagePremium: number;
}

export function calculateFinancialMetrics(
  receipts: Array<{
    amount: number;
    status: string;
  }>,
  commissions: Array<{
    expectedAmount: number;
    actualAmount: number | null;
  }>
): FinancialMetrics {
  const totalPremium = receipts.reduce((sum, r) => sum + (r.amount || 0), 0);
  const paidReceipts = receipts.filter((r) => r.status === "PAID").length;
  const pendingReceipts = receipts.filter((r) => r.status === "PENDING").length;

  const totalCommission = commissions.reduce(
    (sum, c) => sum + (c.actualAmount || c.expectedAmount || 0),
    0
  );

  const averagePremium =
    receipts.length > 0 ? totalPremium / receipts.length : 0;

  return {
    totalPremium,
    totalReceipts: receipts.length,
    paidReceipts,
    pendingReceipts,
    totalCommission,
    averagePremium,
  };
}

export interface PolicyTypeMetrics {
  type: string;
  count: number;
  totalPremium: number;
  averagePremium: number;
  percentageOfTotal: number;
}

export function calculatePolicyTypeMetrics(
  policies: Array<{
    policyType: string;
    premiumAmount: number;
  }>
): PolicyTypeMetrics[] {
  const byType = new Map<
    string,
    { count: number; totalPremium: number }
  >();

  for (const policy of policies) {
    const current = byType.get(policy.policyType) || {
      count: 0,
      totalPremium: 0,
    };
    current.count++;
    current.totalPremium += policy.premiumAmount || 0;
    byType.set(policy.policyType, current);
  }

  const totalPremium = policies.reduce(
    (sum, p) => sum + (p.premiumAmount || 0),
    0
  );

  return Array.from(byType.entries())
    .map(([type, data]) => ({
      type,
      count: data.count,
      totalPremium: data.totalPremium,
      averagePremium: data.count > 0 ? data.totalPremium / data.count : 0,
      percentageOfTotal:
        totalPremium > 0 ? (data.totalPremium / totalPremium) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

export interface ClientMetrics {
  clientId: string;
  clientName: string;
  policyCount: number;
  totalPremium: number;
  lastPolicyDate: Date | null;
}

export function calculateClientMetrics(
  clients: Array<{
    id: string;
    fullName: string;
    policies: Array<{
      premiumAmount: number;
      startDate: Date;
    }>;
  }>
): ClientMetrics[] {
  return clients
    .map((client) => {
      const totalPremium = client.policies.reduce(
        (sum, p) => sum + (p.premiumAmount || 0),
        0
      );
      const lastPolicyDate = client.policies.length > 0
        ? client.policies.sort(
            (a, b) => b.startDate.getTime() - a.startDate.getTime()
          )[0].startDate
        : null;

      return {
        clientId: client.id,
        clientName: client.fullName,
        policyCount: client.policies.length,
        totalPremium,
        lastPolicyDate,
      };
    })
    .sort((a, b) => b.totalPremium - a.totalPremium);
}

export interface MonthlyTrend {
  month: string;
  year: number;
  fullLabel: string;
  policyCount: number;
  totalPremium: number;
  receiptCount: number;
}

export function calculateMonthlyTrends(
  policies: Array<{
    startDate: Date;
    premiumAmount: number;
  }>,
  receipts: Array<{
    createdAt: Date;
  }>,
  months: number = 12
): MonthlyTrend[] {
  const trends: MonthlyTrend[] = [];
  const today = businessToday();

  for (let i = months - 1; i >= 0; i--) {
    const monthDate = subMonths(today, i);
    const start = businessStartOfMonth(monthDate);
    const end = businessEndOfMonth(monthDate);

    const monthPolicies = policies.filter((p) => {
      const date = new Date(p.startDate);
      return date >= start && date <= end;
    });

    const monthReceipts = receipts.filter((r) => {
      const date = new Date(r.createdAt);
      return date >= start && date <= end;
    });

    const totalPremium = monthPolicies.reduce(
      (sum, p) => sum + (p.premiumAmount || 0),
      0
    );

    trends.push({
      month: MONTH_NAMES_ES[monthDate.getMonth()],
      year: monthDate.getFullYear(),
      fullLabel: `${MONTH_NAMES_ES[monthDate.getMonth()]} ${monthDate.getFullYear()}`,
      policyCount: monthPolicies.length,
      totalPremium,
      receiptCount: monthReceipts.length,
    });
  }

  return trends;
}

export interface InsurerMetrics {
  insurerId: string;
  insurerName: string;
  policyCount: number;
  totalPremium: number;
  totalCommission: number;
  commissionRate: number;
}

export function calculateInsurerMetrics(
  insurers: Array<{
    id: string;
    name: string;
    commissionRate: number | null;
    policies: Array<{
      premiumAmount: number;
      commission: Array<{
        expectedAmount: number;
        actualAmount: number | null;
      }>;
    }>;
  }>
): InsurerMetrics[] {
  return insurers
    .map((insurer) => {
      const policyCount = insurer.policies.length;
      const totalPremium = insurer.policies.reduce(
        (sum, p) => sum + (p.premiumAmount || 0),
        0
      );

      const totalCommission = insurer.policies.reduce((sum, p) => {
        return (
          sum +
          p.commission.reduce(
            (cSum, c) => cSum + (c.actualAmount || c.expectedAmount || 0),
            0
          )
        );
      }, 0);

      return {
        insurerId: insurer.id,
        insurerName: insurer.name,
        policyCount,
        totalPremium,
        totalCommission,
        commissionRate: insurer.commissionRate || 0,
      };
    })
    .sort((a, b) => b.totalPremium - a.totalPremium);
}

export interface ReportPeriod {
  label: string;
  value: string;
  startDate: Date;
  endDate: Date;
}

export function getDefaultReportPeriods(
  oldestPolicyDate: Date | null,
  newestPolicyDate: Date | null
): {
  available: boolean;
  periods: ReportPeriod[];
  dataRange: { start: string; end: string } | null;
} {
  const today = businessToday();
  const periods: ReportPeriod[] = [
    {
      label: "Último mes",
      value: "last_month",
      startDate: subMonths(today, 1),
      endDate: today,
    },
    {
      label: "Últimos 3 meses",
      value: "last_3_months",
      startDate: subMonths(today, 3),
      endDate: today,
    },
    {
      label: "Últimos 6 meses",
      value: "last_6_months",
      startDate: subMonths(today, 6),
      endDate: today,
    },
    {
      label: "Último año",
      value: "last_year",
      startDate: subYears(today, 1),
      endDate: today,
    },
  ];

  // Add year-based periods if we have enough data
  if (oldestPolicyDate && newestPolicyDate) {
    const currentYear = today.getFullYear();
    const previousYear = currentYear - 1;

    if (oldestPolicyDate.getFullYear() <= previousYear) {
      periods.push({
        label: `Año ${previousYear}`,
        value: `year_${previousYear}`,
        startDate: parseBusinessDateInput(`${previousYear}-01-01`),
        endDate: parseBusinessDateInput(`${previousYear}-12-31`),
      });
    }
  }

  return {
    available: true,
    periods,
    dataRange:
      oldestPolicyDate && newestPolicyDate
        ? {
            start: formatBusinessDateInput(oldestPolicyDate),
            end: formatBusinessDateInput(newestPolicyDate),
        }
        : null,
  };
}
