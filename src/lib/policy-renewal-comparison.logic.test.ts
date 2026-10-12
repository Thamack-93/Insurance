import { describe, expect, it } from "vitest";
import { compareRenewalPolicies, formatPremiumPercent, type RenewalComparisonPolicy } from "@/lib/policy-renewal-comparison";

function policy(overrides: Partial<RenewalComparisonPolicy> = {}): RenewalComparisonPolicy {
  return {
    policyType: "AUTO",
    premiumAmount: 12000,
    currency: "MXN",
    riskDetails: { version: 1, policyType: "AUTO", data: { vehicles: [{ make: "Mazda", model: "CX-5", year: "2022", version: "Touring", vin: "VIN123", plates: "ABC123" }] } },
    ...overrides,
  };
}

describe("compareRenewalPolicies", () => {
  it("compares only changed AUTO coverage context and hides identifiers and unchanged fields", () => {
    const result = compareRenewalPolicies(policy(), policy({
      riskDetails: { version: 1, policyType: "AUTO", data: { vehicles: [{ make: "Toyota", model: "CX-5", year: "2022", version: "Touring", vin: "VIN999", plates: "XYZ789" }] } },
    }));

    expect(result.differences).toEqual([
      expect.objectContaining({ label: "Vehículo · Vehículo 1 · Marca", oldValue: "Mazda", newValue: "Toyota", status: "CHANGED" }),
    ]);
    expect(JSON.stringify(result.differences)).not.toContain("VIN");
    expect(JSON.stringify(result.differences)).not.toContain("ABC123");
  });

  it("compares only ramo-specific fields for each supported policy type", () => {
    const scenarios: Array<{
      policyType: string;
      previousData: Record<string, unknown>;
      renewalData: Record<string, unknown>;
      expectedLabel: string;
      excludedText: string;
    }> = [
      { policyType: "GMM", previousData: { insuredPeople: [{ fullName: "Ana" }], plan: "A", insuredAmount: "100", deductible: "10", coinsurance: "5" }, renewalData: { insuredPeople: [{ fullName: "Luis" }], plan: "B", insuredAmount: "100", deductible: "10", coinsurance: "5" }, expectedLabel: "Plan", excludedText: "Ana" },
      { policyType: "VIDA", previousData: { insuredPeople: [{ fullName: "Ana" }], plan: "A", insuredAmount: "100", term: "1", beneficiaries: [{ fullName: "Bea", relationship: "Hija", percentage: "50" }] }, renewalData: { insuredPeople: [{ fullName: "Luis" }], plan: "A", insuredAmount: "200", term: "1", beneficiaries: [{ fullName: "Carlos", relationship: "Hijo", percentage: "50" }] }, expectedLabel: "Suma asegurada", excludedText: "Bea" },
      { policyType: "DANOS", previousData: { locations: [{ address: "Calle 1", use: "Local", construction: "Concreto", activity: "Venta", insuredValue: "100" }], activity: "Venta", coverageLimit: "500" }, renewalData: { locations: [{ address: "Calle 2", use: "Local", construction: "Concreto", activity: "Venta", insuredValue: "200" }], activity: "Venta", coverageLimit: "500" }, expectedLabel: "Ubicación · Ubicación 1 · Valor asegurado", excludedText: "Calle 1" },
      { policyType: "FIANZAS", previousData: { obligation: "Obra A", contractNumber: "A-1", beneficiary: "Cliente", bondedAmount: "100", term: "1" }, renewalData: { obligation: "Obra B", contractNumber: "B-2", beneficiary: "Otro", bondedAmount: "200", term: "2" }, expectedLabel: "Obligación afianzada", excludedText: "A-1" },
      { policyType: "HOGAR", previousData: { locations: [{ address: "Calle 1", use: "Casa", construction: "Concreto", activity: "", insuredValue: "100" }] }, renewalData: { locations: [{ address: "Calle 2", use: "Casa", construction: "Concreto", activity: "", insuredValue: "200" }] }, expectedLabel: "Ubicación · Ubicación 1 · Valor asegurado", excludedText: "Calle 1" },
      { policyType: "RESPONSABILIDAD_CIVIL", previousData: { activity: "Obra", territory: "México", coverageLimit: "100", operations: "A" }, renewalData: { activity: "Obra", territory: "México", coverageLimit: "200", operations: "A" }, expectedLabel: "Límite de cobertura", excludedText: "operations" },
      { policyType: "EMPRESARIAL", previousData: { activity: "Comercio", locations: [{ address: "Calle 1", use: "Tienda", construction: "Concreto", activity: "Comercio", insuredValue: "10" }], buildingValue: "100", contentsValue: "50", businessInterruptionValue: "20" }, renewalData: { activity: "Comercio", locations: [{ address: "Calle 2", use: "Tienda", construction: "Concreto", activity: "Comercio", insuredValue: "20" }], buildingValue: "200", contentsValue: "50", businessInterruptionValue: "20" }, expectedLabel: "Valor del edificio", excludedText: "Calle 1" },
      { policyType: "ACCIDENTES", previousData: { insuredPeople: [{ fullName: "Ana" }], plan: "A", insuredAmount: "100", accidentCoverage: "Básica" }, renewalData: { insuredPeople: [{ fullName: "Luis" }], plan: "B", insuredAmount: "100", accidentCoverage: "Básica" }, expectedLabel: "Plan", excludedText: "Ana" },
      { policyType: "OTRO", previousData: { category: "Equipo", attributes: [{ label: "Robo", value: "No" }] }, renewalData: { category: "Equipo", attributes: [{ label: "Robo", value: "Sí" }] }, expectedLabel: "Atributo · Robo", excludedText: "Dato" },
    ];

    for (const scenario of scenarios) {
      const result = compareRenewalPolicies(
        policy({ policyType: scenario.policyType, riskDetails: { version: 1, policyType: scenario.policyType, data: scenario.previousData } }),
        policy({ policyType: scenario.policyType, riskDetails: { version: 1, policyType: scenario.policyType, data: scenario.renewalData } }),
      );
      expect(result.differences.some((entry) => entry.label === scenario.expectedLabel), scenario.policyType).toBe(true);
      expect(JSON.stringify(result.differences), scenario.policyType).not.toContain(scenario.excludedText);
    }
  });

  it("includes the premium pair and signed difference when the currency matches", () => {
    const result = compareRenewalPolicies(policy(), policy({ premiumAmount: 15000 }));

    expect(result.premiums).toEqual({
      previous: { amount: 12000, currency: "MXN" },
      renewal: { amount: 15000, currency: "MXN" },
    });
    expect(result.premiumDifference).toEqual({ amount: 3000, absoluteAmount: 3000, percent: 25, currency: "MXN" });
  });

  it("keeps both premium currencies without calculating a cross-currency delta", () => {
    const result = compareRenewalPolicies(policy(), policy({ currency: "USD", premiumAmount: 700 }));

    expect(result.premiums.previous?.currency).toBe("MXN");
    expect(result.premiums.renewal?.currency).toBe("USD");
    expect(result.premiumDifference).toBeNull();
  });

  it("does not compare ramo-specific fields when the policy type changed", () => {
    const result = compareRenewalPolicies(policy(), policy({
      policyType: "GMM",
      riskDetails: { version: 1, policyType: "GMM", data: { insuredPeople: [], plan: "B", insuredAmount: "100", deductible: "10", coinsurance: "5" } },
    }));

    expect(result.policyTypeChanged).toBe(true);
    expect(result.differences).toEqual([]);
    expect(result.premiumDifference).not.toBeNull();
  });

  it("does not calculate percentage from a zero prior premium", () => {
    expect(compareRenewalPolicies(policy({ premiumAmount: 0 }), policy({ premiumAmount: 100 })).premiumDifference).toBeNull();
  });

  it("formats premium increases and reductions with one sign", () => {
    expect(formatPremiumPercent(10)).toBe("+10.0%");
    expect(formatPremiumPercent(-10)).toBe("−10.0%");
    expect(formatPremiumPercent(0.01)).toBe("+<0.1%");
    expect(formatPremiumPercent(-0.01)).toBe("−<0.1%");
  });
});
