import { describe, expect, it } from "vitest";
import {
  calculateClientMetrics,
  calculateFinancialMetrics,
  calculateInsurerMetrics,
  calculateMonthlyTrends,
  calculatePolicyTypeMetrics,
  getDefaultReportPeriods,
} from "./reports.logic";

describe("reports.logic", () => {
  it("calculates financial metrics from receipts and commissions", () => {
    const metrics = calculateFinancialMetrics(
      [
        { amount: 500, status: "PAID" },
        { amount: 300, status: "PENDING" },
      ],
      [
        { expectedAmount: 50, actualAmount: 50 },
        { expectedAmount: 30, actualAmount: null },
      ],
    );
    expect(metrics.totalPremium).toBe(800);
    expect(metrics.paidReceipts).toBe(1);
    expect(metrics.totalCommission).toBe(80);
  });

  it("aggregates policy type metrics", () => {
    const rows = calculatePolicyTypeMetrics([
      { policyType: "AUTO", premiumAmount: 100 },
      { policyType: "AUTO", premiumAmount: 200 },
      { policyType: "HOME", premiumAmount: 400 },
    ]);
    expect(rows.find((r) => r.type === "AUTO")?.count).toBe(2);
    expect(rows[0].totalPremium).toBeGreaterThan(0);
  });

  it("builds client metrics", () => {
    const rows = calculateClientMetrics([
      {
        id: "c1",
        fullName: "Acme",
        policies: [{ premiumAmount: 100, startDate: new Date("2024-01-01") }],
      },
    ]);
    expect(rows[0].policyCount).toBe(1);
    expect(rows[0].totalPremium).toBe(100);
  });

  it("builds insurer metrics and report periods", () => {
    const insurers = calculateInsurerMetrics([
      {
        id: "i1",
        name: "Insurer",
        commissionRate: 10,
        policies: [
          {
            premiumAmount: 1000,
            commission: [{ expectedAmount: 100, actualAmount: 50 }],
          },
        ],
      },
    ]);
    expect(insurers[0].totalPremium).toBe(1000);
    const periods = getDefaultReportPeriods(new Date("2023-01-01"), new Date("2024-12-31"));
    expect(periods.available).toBe(true);
    expect(periods.periods.length).toBeGreaterThan(0);
  });

  it("calculates monthly trends", () => {
    const trends = calculateMonthlyTrends(
      [{ startDate: new Date(), premiumAmount: 100 }],
      [{ createdAt: new Date() }],
      3,
    );
    expect(trends).toHaveLength(3);
  });
});
