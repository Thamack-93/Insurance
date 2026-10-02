import { describe, expect, it } from "vitest";
import { POLICY_TYPES } from "@/lib/domain-values";
import {
  convertLegacyPolicyDescription,
  emptyPolicyRiskDetails,
  getPolicyRiskDetailEntries,
  policyRiskDetailsSchema,
  projectPolicyRiskRelations,
  riskDetailsFromExisting,
  summarizePolicyRiskDetails,
} from "@/lib/policy-risk-details";

describe("policy risk details", () => {
  it("provides a versioned, valid dynamic shape for every supported ramo", () => {
    for (const policyType of POLICY_TYPES) {
      const empty = emptyPolicyRiskDetails(policyType);
      expect(policyRiskDetailsSchema.safeParse(empty).success, policyType).toBe(true);
    }
  });

  it("summarizes multiple vehicles without losing the underlying details", () => {
    const details = {
      version: 1,
      policyType: "AUTO",
      data: {
        vehicles: [
          { make: "Buick", model: "Encore", year: "2016", version: "Leatherette", vin: "VIN123", plates: "ABC-123" },
          { make: "Mazda", model: "CX7", year: "2009", version: "Grand Touring", vin: "", plates: "" },
        ],
      },
    };
    expect(summarizePolicyRiskDetails(details)).toContain("Buick Encore 2016 Leatherette");
    expect(summarizePolicyRiskDetails(details)).toContain("Mazda CX7 2009 Grand Touring");
    const projection = projectPolicyRiskRelations(details);
    expect(projection.assets).toHaveLength(2);
    expect(projection.assets[0]).toMatchObject({ assetType: "AUTO", serialNumber: "VIN123", isPrimary: true });
  });

  it("projects multiple insured people to the existing party relation", () => {
    const details = {
      version: 1,
      policyType: "GMM",
      data: {
        insuredPeople: [
          { fullName: "Ana Pérez", birthDate: "1990-02-03", relationship: "Titular" },
          { fullName: "Luis Pérez", birthDate: "2018-05-01", relationship: "Hijo" },
        ],
        plan: "Integral",
        insuredAmount: "5000000",
        deductible: "20000",
        coinsurance: "10%",
      },
    };
    expect(projectPolicyRiskRelations(details).insuredParties).toEqual([
      { fullName: "Ana Pérez", isPrimary: true, sourceLabel: "Datos estructurados de póliza" },
      { fullName: "Luis Pérez", isPrimary: false, sourceLabel: "Datos estructurados de póliza" },
    ]);
    expect(getPolicyRiskDetailEntries(details).some((entry) => entry.label.includes("Luis Pérez"))).toBe(false);
    expect(getPolicyRiskDetailEntries(details)).toContainEqual({ label: "Persona asegurada 2 · Nombre", value: "Luis Pérez" });
  });

  it("converts clearly delimited auto descriptions and preserves their source text", () => {
    const result = convertLegacyPolicyDescription("AUTO", "BUICK, ENCORE, 2016, LEATHERETTE", "1G1ABC");
    expect(result.status).toBe("CONVERTED");
    expect(result.riskDetails).toMatchObject({ sourceText: "BUICK, ENCORE, 2016, LEATHERETTE", data: { vehicles: [{ make: "BUICK", model: "ENCORE", year: "2016", vin: "1G1ABC" }] } });
  });

  it("converts several auto assets from registered rows when the generic text is empty", () => {
    const details = riskDetailsFromExisting("AUTO", null, null, [
      { description: "BUICK, ENCORE, 2016, PREMIUM", serialNumber: "VIN111" },
      { description: "MAZDA, CX7, 2009, GRAND TOURING", serialNumber: "VIN222" },
    ]);
    expect(summarizePolicyRiskDetails(details)).toContain("MAZDA CX7 2009 GRAND TOURING");
    expect(projectPolicyRiskRelations(details).assets).toHaveLength(2);
    expect(projectPolicyRiskRelations(details).assets[1].serialNumber).toBe("VIN222");
  });

  it("converts explicitly labeled details for a non-auto ramo", () => {
    const result = convertLegacyPolicyDescription("FIANZAS", "Obligación: Cumplimiento de contrato; Contrato: CT-123; Monto afianzado: 250000; Beneficiario: Cliente ABC");
    expect(result.status).toBe("CONVERTED");
    expect(summarizePolicyRiskDetails(result.riskDetails)).toContain("Cumplimiento de contrato");
  });

  it("leaves ambiguous text intact and marks it for review", () => {
    const raw = "NO ESPECIFICADA, NO ESPECIFICADA, ...";
    expect(convertLegacyPolicyDescription("AUTO", raw).status).toBe("REVIEW");
    expect(convertLegacyPolicyDescription("HOGAR", "Una casa en zona centro").status).toBe("REVIEW");
    const existing = riskDetailsFromExisting("HOGAR", null, raw);
    expect(existing?.sourceText).toBe(raw);
    expect(summarizePolicyRiskDetails(existing)).toBe("");
    const ambiguousAuto = riskDetailsFromExisting("AUTO", null, raw);
    expect(ambiguousAuto?.sourceText).toBe(raw);
    expect(ambiguousAuto?.policyType === "AUTO" && ambiguousAuto.data.vehicles[0].make).toBe("");
  });
});
