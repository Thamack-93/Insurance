import { describe, expect, it } from "vitest";
import {
  aggregateCommissionStats,
  calculateCommission,
  calculateOverdueStatus,
  getCommissionStatusFromReceipt,
} from "./commissions.logic";

describe("commissions.logic", () => {
  it("calculates commission at 10% rate", () => {
    const result = calculateCommission({
      policyId: "policy-123",
      clientId: "client-123",
      insurerId: "insurer-123",
      premiumAmount: 1000,
      commissionRate: 10,
      receiptDueDate: new Date("2024-06-01"),
      receiptStatus: "PENDING",
    });
    expect(result.expectedAmount).toBe(100);
    expect(result.status).toBe("EXPECTED");
  });

  it("sets status to PENDING when receipt is PAID", () => {
    const result = calculateCommission({
      policyId: "p",
      clientId: "c",
      insurerId: "i",
      premiumAmount: 1000,
      commissionRate: 10,
      receiptStatus: "PAID",
    });
    expect(result.status).toBe("PENDING");
  });

  it("maps receipt status to commission status", () => {
    expect(getCommissionStatusFromReceipt("PENDING")).toBe("EXPECTED");
    expect(getCommissionStatusFromReceipt("PAID")).toBe("PENDING");
  });

  it("transitions overdue commission statuses", () => {
    const today = new Date("2024-06-20");
    expect(calculateOverdueStatus("EXPECTED", new Date("2024-06-01"), today)).toBe("PENDING");
    expect(calculateOverdueStatus("PENDING", new Date("2024-05-01"), today)).toBe("OVERDUE");
  });

  it("aggregates commission stats", () => {
    const stats = aggregateCommissionStats([
      { status: "EXPECTED", expectedAmount: 100, actualAmount: null },
      { status: "PAID", expectedAmount: 200, actualAmount: 200 },
    ]);
    expect(stats.totalExpected).toBe(300);
    expect(stats.totalActual).toBe(200);
    expect(stats.statusBreakdown).toHaveLength(2);
  });
});
