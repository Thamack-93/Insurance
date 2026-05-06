// Pure business logic for commissions - no "use server"
// This file can be imported in tests without Next.js context

import { addDays } from "date-fns";

export interface CommissionCalculationInput {
  policyId: string;
  clientId: string;
  insurerId: string;
  receiptId?: string;
  premiumAmount: number;
  commissionRate: number;
  receiptDueDate?: Date;
  receiptStatus?: string;
}

export interface CommissionCalculation {
  policyId: string;
  clientId: string;
  insurerId: string;
  receiptId?: string;
  expectedAmount: number;
  actualAmount?: number;
  percentage: number;
  expectedDate: Date;
  status: "EXPECTED" | "PENDING" | "PAID" | "OVERDUE" | "CANCELLED";
}

export function calculateCommission(
  input: CommissionCalculationInput
): CommissionCalculation {
  const expectedAmount = (input.premiumAmount * input.commissionRate) / 100;

  let status: CommissionCalculation["status"] = "EXPECTED";
  if (input.receiptStatus === "PAID") {
    status = "PENDING";
  }

  return {
    policyId: input.policyId,
    clientId: input.clientId,
    insurerId: input.insurerId,
    receiptId: input.receiptId,
    expectedAmount,
    actualAmount: undefined,
    percentage: input.commissionRate,
    expectedDate: input.receiptDueDate || addDays(new Date(), 30),
    status,
  };
}

export function getCommissionStatusFromReceipt(
  receiptStatus: string
): CommissionCalculation["status"] {
  switch (receiptStatus) {
    case "PAID":
      return "PENDING";
    case "CANCELLED":
      return "CANCELLED";
    case "PENDING":
    default:
      return "EXPECTED";
  }
}

export function calculateOverdueStatus(
  currentStatus: string,
  expectedDate: Date,
  today: Date
): CommissionCalculation["status"] | null {
  if (currentStatus === "EXPECTED" && expectedDate <= today) {
    return "PENDING";
  }
  if (currentStatus === "PENDING" && expectedDate < today) {
    return "OVERDUE";
  }
  return null;
}

export interface CommissionStats {
  totalExpected: number;
  totalActual: number;
  statusBreakdown: Array<{
    status: string;
    count: number;
    totalExpected: number;
    totalActual: number;
  }>;
}

export function aggregateCommissionStats(
  commissions: Array<{
    status: string;
    expectedAmount: number;
    actualAmount: number | null;
  }>
): CommissionStats {
  const totalExpected = commissions.reduce(
    (sum, c) => sum + (c.expectedAmount || 0),
    0
  );
  const totalActual = commissions.reduce(
    (sum, c) => sum + (c.actualAmount || 0),
    0
  );

  const byStatus = new Map<
    string,
    { count: number; expected: number; actual: number }
  >();

  for (const commission of commissions) {
    const current = byStatus.get(commission.status) || {
      count: 0,
      expected: 0,
      actual: 0,
    };
    current.count++;
    current.expected += commission.expectedAmount || 0;
    current.actual += commission.actualAmount || 0;
    byStatus.set(commission.status, current);
  }

  const statusBreakdown = Array.from(byStatus.entries()).map(
    ([status, data]) => ({
      status,
      count: data.count,
      totalExpected: data.expected,
      totalActual: data.actual,
    })
  );

  return {
    totalExpected,
    totalActual,
    statusBreakdown,
  };
}
