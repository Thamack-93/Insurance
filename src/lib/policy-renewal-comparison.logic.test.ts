import { describe, expect, it } from "vitest";
import { compareRenewalPolicies, formatPremiumPercent, type RenewalComparisonPolicy } from "@/lib/policy-renewal-comparison";

function policy(overrides: Partial<RenewalComparisonPolicy> = {}): RenewalComparisonPolicy {
  return {
    insurerName: "Aseguradora Uno",
    policyType: "AUTO",
    premiumAmount: 12000,
    currency: "MXN",
    paymentFrequency: "ANNUAL",
    startDate: "2025-01-01",
    endDate: "2026-01-01",
    riskDetails: { version: 1, policyType: "AUTO", data: { vehicles: [{ make: "Mazda", model: "CX-5", year: "2022", version: "Touring", vin: "VIN123", plates: "ABC123" }] } },
    legacyText: null,
    insuredAssets: [{ assetType: "AUTO", description: "Mazda CX-5 2022", serialNumber: "VIN123", isPrimary: true }],
    insuredParties: [{ fullName: "Ana Pérez", isPrimary: true }],
    ...overrides,
  };
}

describe("compareRenewalPolicies", () => {
  it("marks an unchanged AUTO renewal and retains unchanged details for inspection", () => {
    const result = compareRenewalPolicies(policy(), policy());
    expect(result.counts.UNCHANGED).toBeGreaterThan(0);
    expect(result.differences).toHaveLength(0);
    expect(result.unchanged).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Vehículo · Vehículo 1 · Marca", oldValue: "Mazda", status: "UNCHANGED" })]));
    expect(result.premiumDifference).toEqual({ amount: 0, absoluteAmount: 0, percent: 0, currency: "MXN" });
  });

  it("compares representative non-AUTO structured fields", () => {
    const previous = policy({ policyType: "HOGAR", riskDetails: { version: 1, policyType: "HOGAR", data: { locations: [{ address: "Calle 1", use: "Casa", construction: "Concreto", activity: "", insuredValue: "2000000" }] } }, insuredAssets: [] });
    const renewal = policy({ policyType: "HOGAR", riskDetails: { version: 1, policyType: "HOGAR", data: { locations: [{ address: "Calle 1", use: "Casa", construction: "Concreto", activity: "", insuredValue: "2500000" }] } }, insuredAssets: [] });
    const result = compareRenewalPolicies(previous, renewal);
    expect(result.differences).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Ubicación · Ubicación 1 · Valor asegurado", oldValue: "2000000", newValue: "2500000", status: "CHANGED" })]));
  });

  it("reports changed terms, added and removed insured records, and the premium delta", () => {
    const result = compareRenewalPolicies(policy(), policy({
      insurerName: "Aseguradora Dos",
      premiumAmount: 15000,
      paymentFrequency: "SEMIAANNUAL",
      insuredAssets: [{ assetType: "AUTO", description: "Toyota Corolla 2024", serialNumber: null, isPrimary: true }],
      insuredParties: [{ fullName: "Luis Pérez", isPrimary: true }],
    }));
    expect(result.counts.CHANGED).toBeGreaterThan(0);
    expect(result.counts.ADDED).toBeGreaterThan(0);
    expect(result.counts.REMOVED).toBeGreaterThan(0);
    expect(result.premiumDifference).toEqual({ amount: 3000, absoluteAmount: 3000, percent: 25, currency: "MXN" });
  });

  it("reports missing structured data and preserves legacy text without parsing it", () => {
    const result = compareRenewalPolicies(policy({ riskDetails: null, legacyText: "Auto: quizá Toyota; modelo: Corolla" }), policy({ riskDetails: null }));
    expect(result.counts.MISSING).toBeGreaterThan(0);
    expect(result.legacyPreviousText).toBe("Auto: quizá Toyota; modelo: Corolla");
    expect(result.differences.some((entry) => entry.label === "Marca")).toBe(false);
  });

  it("treats valid but empty structured envelopes as missing and keeps the legacy fallback explicit", () => {
    const blankRisk = { version: 1, policyType: "AUTO", data: { vehicles: [] } };
    const result = compareRenewalPolicies(policy({ riskDetails: blankRisk, legacyText: "Auto: quizá Toyota; modelo: Corolla" }), policy({ riskDetails: blankRisk }));
    expect(result.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "risk:structured-data", status: "MISSING", oldValue: null, newValue: null }),
    ]));
    expect(result.legacyPreviousText).toBe("Auto: quizá Toyota; modelo: Corolla");
  });

  it("never computes a premium percentage across currencies or from zero", () => {
    expect(compareRenewalPolicies(policy(), policy({ currency: "USD" })).premiumDifference).toBeNull();
    expect(compareRenewalPolicies(policy({ premiumAmount: 0 }), policy({ premiumAmount: 100 })).premiumDifference).toBeNull();
  });

  it("keeps premium reductions signed", () => {
    const result = compareRenewalPolicies(policy({ premiumAmount: 15000 }), policy({ premiumAmount: 12000 }));
    expect(result.premiumDifference).toEqual({ amount: -3000, absoluteAmount: 3000, percent: -20, currency: "MXN" });
  });

  it("formats premium increases and reductions with exactly one sign", () => {
    expect(formatPremiumPercent(10)).toBe("+10.0%");
    expect(formatPremiumPercent(-10)).toBe("−10.0%");
    expect(formatPremiumPercent(0.01)).toBe("+<0.1%");
    expect(formatPremiumPercent(-0.01)).toBe("−<0.1%");
  });

  it("detects and preserves sub-unit premium changes", () => {
    const result = compareRenewalPolicies(policy({ premiumAmount: 12000.01 }), policy({ premiumAmount: 12000.49 }));
    expect(result.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "premium", status: "CHANGED", oldValue: expect.stringContaining("12,000.01"), newValue: expect.stringContaining("12,000.49") }),
    ]));
    expect(result.premiumDifference?.amount).toBeCloseTo(0.48);
  });
});
