import { describe, expect, it } from "vitest";
import {
  aggregateCommissionStats,
  calculateCommission,
  calculateCommissionEstimate,
  calculateOverdueStatus,
  getCommissionStatusFromReceipt,
} from "./commissions.logic";

describe("commissions.logic", () => {
  it("calculates commission using the explicitly supplied rate", () => {
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

  const dimensions = { policyType: "AUTO", productPlan: "AMPLIA", policyMode: "INDIVIDUAL", unitClass: "PARTICULAR", paymentFrequency: "ANNUAL" };
  const baseRule = { id: "q-auto", policyType: "AUTO", productPlan: "AMPLIA", policyMode: "INDIVIDUAL", unitClass: "PARTICULAR", paymentFrequency: "ANNUAL", rate: 8, validFrom: "2026-01-01", validTo: null, active: true, evidence: "Movimiento conciliado" };

  it("calculates net premium as total less tax, issuance and surcharge plus visible discounts", () => {
    const result = calculateCommissionEstimate({ totalPremium: 1190, iva: 190, issuanceExpense: 100, installmentSurcharge: 50, visibleDiscounts: 20 }, [baseRule], dimensions, new Date("2026-06-01T12:00:00Z"));
    expect(result).toMatchObject({ status: "CALCULATED", netPremium: 870, commissionableBase: 870, rate: 8, amount: 69.6 });
  });

  it("selects a more specific class and requires review for no match or a tie", () => {
    const wildcard = { ...baseRule, id: "wildcard", unitClass: "*", rate: 10 };
    const specific = { ...baseRule, id: "specific", rate: 8 };
    const components = { totalPremium: 100, iva: 0, issuanceExpense: 0, installmentSurcharge: 0, visibleDiscounts: 0 };
    expect(calculateCommissionEstimate(components, [wildcard, specific], dimensions, new Date("2026-06-01T12:00:00Z")).rule?.id).toBe("specific");
    expect(calculateCommissionEstimate(components, [], dimensions, new Date("2026-06-01T12:00:00Z")).status).toBe("REVIEW");
    expect(calculateCommissionEstimate(components, [specific, { ...specific, id: "duplicate", rate: 9 }], dimensions, new Date("2026-06-01T12:00:00Z")).reason).toMatch(/misma prioridad/);
    expect(calculateCommissionEstimate(components, [{ ...specific, evidence: "" }], dimensions, new Date("2026-06-01T12:00:00Z")).reason).toMatch(/evidencia documentada/);
  });

  it("supports fleet units with different class rates and rejects incomplete premium data", () => {
    const truckRule = { ...baseRule, id: "truck", unitClass: "CARGA", rate: 10 };
    const truck = calculateCommissionEstimate({ totalPremium: 625, iva: 100, issuanceExpense: 25, installmentSurcharge: 0, visibleDiscounts: 0 }, [truckRule], { ...dimensions, unitClass: "CARGA" }, new Date("2026-06-01T12:00:00Z"));
    const privateCar = calculateCommissionEstimate({ totalPremium: 1250, iva: 200, issuanceExpense: 50, installmentSurcharge: 0, visibleDiscounts: 0 }, [baseRule], dimensions, new Date("2026-06-01T12:00:00Z"));
    expect((truck.amount ?? 0) + (privateCar.amount ?? 0)).toBe(130);
    expect(calculateCommissionEstimate(null, [baseRule], dimensions, new Date("2026-06-01T12:00:00Z")).status).toBe("REVIEW");
    expect(calculateCommissionEstimate({ totalPremium: 100, iva: Number.NaN, issuanceExpense: 0, installmentSurcharge: 0, visibleDiscounts: 0 }, [baseRule], dimensions, new Date("2026-06-01T12:00:00Z")).status).toBe("REVIEW");
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
