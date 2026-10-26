import { describe, expect, it } from "vitest";
import {
  aggregateCommissionStats,
  calculateCommission,
  calculateCommissionEstimate,
  calculateOverdueStatus,
  getCommissionStatusFromReceipt,
  shouldUseAggregatePolicyOverride,
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

  const dimensions = { policyType: "AUTO", productPlan: "AMPLIA", policyMode: "*", unitClass: "PARTICULAR", paymentFrequency: "ANNUAL" };
  const baseRule = { id: "q-auto", policyType: "AUTO", productPlan: "AMPLIA", policyMode: "*", unitClass: "PARTICULAR", paymentFrequency: "ANNUAL", rate: 8, validFrom: "2026-01-01", validTo: null, active: true, evidence: "Movimiento conciliado" };

  it("calculates net premium as total less tax, issuance and surcharge plus visible discounts", () => {
    const result = calculateCommissionEstimate({ totalPremium: 1190, iva: 190, issuanceExpense: 100, installmentSurcharge: 50, visibleDiscounts: 20 }, [baseRule], dimensions, new Date("2026-06-01T12:00:00Z"));
    expect(result).toMatchObject({ status: "CALCULATED", netPremium: 870, commissionableBase: 870, rate: 8, amount: 69.6 });
  });

  it("supports a negative installment surcharge without rejecting a valid net premium", () => {
    const result = calculateCommissionEstimate({ totalPremium: 12200.06, iva: 1682.77, issuanceExpense: 670, installmentSurcharge: -200.97, visibleDiscounts: 0 }, [baseRule], dimensions, new Date("2026-06-01T12:00:00Z"));
    expect(result).toMatchObject({ status: "CALCULATED", netPremium: 10048.26, commissionableBase: 10048.26, rate: 8, amount: 803.86 });
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

  it("selects AUTO commission by vehicle class and ignores policy unit-count modality", () => {
    const classRule = { ...baseRule, id: "private-car", rate: 8 };
    const fleetSpecific = { ...classRule, id: "fleet-private-car", policyMode: "FLOTILLA", rate: 10 };
    const individualSpecific = { ...classRule, id: "individual-private-car", policyMode: "INDIVIDUAL", rate: 12 };
    const components = { totalPremium: 1000, iva: 0, issuanceExpense: 0, installmentSurcharge: 0, visibleDiscounts: 0 };

    expect(calculateCommissionEstimate(components, [classRule, fleetSpecific, individualSpecific], dimensions, new Date("2026-06-01T12:00:00Z")).rule?.id).toBe("private-car");
    expect(calculateCommissionEstimate(components, [fleetSpecific], dimensions, new Date("2026-06-01T12:00:00Z")).status).toBe("REVIEW");
  });

  it("supports fleet units with different class rates and rejects incomplete premium data", () => {
    const truckRule = { ...baseRule, id: "truck", unitClass: "CARGA", rate: 10 };
    const truck = calculateCommissionEstimate({ totalPremium: 625, iva: 100, issuanceExpense: 25, installmentSurcharge: 0, visibleDiscounts: 0 }, [truckRule], { ...dimensions, unitClass: "CARGA" }, new Date("2026-06-01T12:00:00Z"));
    const privateCar = calculateCommissionEstimate({ totalPremium: 1250, iva: 200, issuanceExpense: 50, installmentSurcharge: 0, visibleDiscounts: 0 }, [baseRule], dimensions, new Date("2026-06-01T12:00:00Z"));
    expect((truck.amount ?? 0) + (privateCar.amount ?? 0)).toBe(130);
    expect(calculateCommissionEstimate(null, [baseRule], dimensions, new Date("2026-06-01T12:00:00Z")).status).toBe("REVIEW");
    expect(calculateCommissionEstimate({ totalPremium: 100, iva: Number.NaN, issuanceExpense: 0, installmentSurcharge: 0, visibleDiscounts: 0 }, [baseRule], dimensions, new Date("2026-06-01T12:00:00Z")).status).toBe("REVIEW");
  });

  it("uses a complete receipt-level base for a multi-person policy with one policy-specific rate", () => {
    const components = { totalPremium: 25011.92, iva: 3449.92, issuanceExpense: 1850, installmentSurcharge: 0, visibleDiscounts: 0 };
    expect(shouldUseAggregatePolicyOverride({ hasInsuredAssets: true, policyRateOverride: 14.61, aggregateComponents: components, unitBreakdownCount: 0 })).toBe(true);
    const result = calculateCommissionEstimate(components, [], { policyType: "GMM", productPlan: "FLEX PLUS", policyMode: "INDIVIDUAL", unitClass: "POLICY_OVERRIDE", paymentFrequency: "SINGLE" }, new Date("2026-03-23T12:00:00Z"), 14.61);
    expect(result).toMatchObject({ status: "CALCULATED", netPremium: 19712, commissionableBase: 19712, rate: 14.61, amount: 2879.92, rule: { source: "POLICY_OVERRIDE" } });
  });

  it("keeps per-unit handling when a rate override is absent, inputs are incomplete, or unit rows exist", () => {
    const components = { totalPremium: 1000, iva: 0, issuanceExpense: 0, installmentSurcharge: 0, visibleDiscounts: 0 };
    expect(shouldUseAggregatePolicyOverride({ hasInsuredAssets: true, policyRateOverride: null, aggregateComponents: components, unitBreakdownCount: 0 })).toBe(false);
    expect(shouldUseAggregatePolicyOverride({ hasInsuredAssets: true, policyRateOverride: 10, aggregateComponents: null, unitBreakdownCount: 0 })).toBe(false);
    expect(shouldUseAggregatePolicyOverride({ hasInsuredAssets: true, policyRateOverride: 10, aggregateComponents: components, unitBreakdownCount: 2 })).toBe(false);
    expect(shouldUseAggregatePolicyOverride({ hasInsuredAssets: false, policyRateOverride: 10, aggregateComponents: components, unitBreakdownCount: 0 })).toBe(false);
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
