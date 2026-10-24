import { describe, expect, it } from "vitest";
import { summarizeCommissionReportRows } from "./commission-report";

describe("commission report summary", () => {
  it("keeps all-review payments pending and excludes them from commission subtotals", () => {
    const summary = summarizeCommissionReportRows([
      { status: "REVIEW", currency: "MXN", amount: 1000, expectedCommission: null },
      { status: "REVIEW", currency: "MXN", amount: 2500, expectedCommission: null },
    ]);

    expect(summary.calculatedCount).toBe(0);
    expect(summary.pendingCount).toBe(2);
    expect(summary.commissionByCurrency.size).toBe(0);
    expect(summary.premiumByCurrency.get("MXN")?.premiumPaid).toBe(3500);
  });

  it("shows calculated subtotals alongside pending counts and separates currencies", () => {
    const summary = summarizeCommissionReportRows([
      { status: "CALCULATED", currency: "mxn", amount: 1000, expectedCommission: 100 },
      { status: "REVIEW", currency: "MXN", amount: 500, expectedCommission: null },
      { status: "CALCULATED", currency: "USD", amount: 200, expectedCommission: 20 },
    ]);

    expect(summary.calculatedCount).toBe(2);
    expect(summary.pendingCount).toBe(1);
    expect(summary.commissionByCurrency.get("MXN")?.commissionExpected).toBe(100);
    expect(summary.commissionByCurrency.get("USD")?.commissionExpected).toBe(20);
    expect(summary.premiumByCurrency.get("MXN")?.premiumPaid).toBe(1500);
  });
});
