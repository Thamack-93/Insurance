// Pure business logic for renewals - no "use server"
// This file can be imported in tests without Next.js context

import { addDays, differenceInDays } from "date-fns";

export type RenewalPriority = "URGENT" | "HIGH" | "MEDIUM" | "LOW";

export interface RenewalInfo {
  policyId: string;
  policyNumber: string;
  clientId: string;
  clientName: string;
  insurerId: string;
  insurerName: string;
  endDate: Date;
  daysUntilRenewal: number;
  priority: RenewalPriority;
  premiumAmount: number;
  currency: string;
  policyType: string;
}

export function calculateRenewalPriority(
  endDate: Date,
  today: Date = new Date()
): RenewalPriority {
  const daysUntil = differenceInDays(endDate, today);

  if (daysUntil <= 0) return "URGENT";
  if (daysUntil <= 14) return "HIGH";
  if (daysUntil <= 30) return "MEDIUM";
  return "LOW";
}

export function shouldIncludeInRenewals(
  policyStatus: string,
  endDate: Date | null,
  latestReceiptStatus: string | null = null,
): boolean {
  if (policyStatus !== "ACTIVE") return false;
  if (!endDate) return false;
  if (latestReceiptStatus === "CANCELLED") return false;
  return true;
}

export function createRenewalWorkItemTitle(
  priority: RenewalPriority,
  policyNumber: string
): string {
  const prefix =
    priority === "URGENT"
      ? "[URGENTE]"
      : priority === "HIGH"
        ? "[ALTA]"
        : priority === "MEDIUM"
          ? "[MEDIA]"
          : "[BAJA]";
  return `${prefix} Renovación ${policyNumber}`;
}

export function createRenewalWorkItemDescription(
  daysUntil: number,
  clientName: string,
  premiumAmount: number,
  currency: string
): string {
  const daysText =
    daysUntil <= 0
      ? `vencida hace ${Math.abs(daysUntil)} días`
      : `vence en ${daysUntil} días`;

  return `La póliza de ${clientName} ${daysText}. Prima: ${premiumAmount} ${currency}. Contactar al cliente para gestionar la renovación.`;
}

export interface RenewalStats {
  overdueCount: number;
  next30DaysCount: number;
  next60DaysCount: number;
  next90DaysCount: number;
  totalActive: number;
  totalRenewalPremium: number;
  averagePremium: number;
}

export function calculateRenewalStats(
  policies: Array<{
    endDate: Date | null;
    premiumAmount: number;
  }>,
  today: Date = new Date()
): RenewalStats {
  const next30Days = addDays(today, 30);
  const next60Days = addDays(today, 60);
  const next90Days = addDays(today, 90);

  let overdueCount = 0;
  let next30DaysCount = 0;
  let next60DaysCount = 0;
  let next90DaysCount = 0;
  let totalRenewalPremium = 0;
  let renewalCount = 0;

  for (const policy of policies) {
    if (!policy.endDate) continue;

    renewalCount++;
    totalRenewalPremium += policy.premiumAmount || 0;

    if (policy.endDate < today) {
      overdueCount++;
    } else if (policy.endDate <= next30Days) {
      next30DaysCount++;
    } else if (policy.endDate <= next60Days) {
      next60DaysCount++;
    } else if (policy.endDate <= next90Days) {
      next90DaysCount++;
    }
  }

  return {
    overdueCount,
    next30DaysCount,
    next60DaysCount,
    next90DaysCount,
    totalActive: policies.length,
    totalRenewalPremium,
    averagePremium: renewalCount > 0 ? totalRenewalPremium / renewalCount : 0,
  };
}

export function filterRenewalsByTimeRange(
  renewals: RenewalInfo[],
  days: number,
  today: Date = new Date()
): RenewalInfo[] {
  const cutoffDate = addDays(today, days);
  return renewals.filter((r) => r.endDate <= cutoffDate);
}

export function sortRenewalsByPriority(
  renewals: RenewalInfo[]
): RenewalInfo[] {
  const priorityOrder: Record<RenewalPriority, number> = {
    URGENT: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
  };

  return [...renewals].sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
  );
}
