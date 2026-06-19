import { describe, expect, it } from "vitest";
import { buildRenewalPolicyDefaults } from "@/lib/policy-renewal";

describe("policy-renewal", () => {
  it("builds a renewal draft with copied policy context", () => {
    const defaults = buildRenewalPolicyDefaults({
      id: "policy-1",
      policyNumber: "940416877",
      clientId: "client-1",
      clientName: "Cliente Demo",
      insurerId: "insurer-1",
      insurerName: "Aseguradora Demo",
      policyType: "AUTO",
      startDate: new Date("2026-05-28T00:00:00.000Z"),
      endDate: new Date("2027-05-28T00:00:00.000Z"),
      premiumAmount: 12345.67,
      currency: "MXN",
      paymentFrequency: "ANNUAL",
      paymentPlan: "Mensual",
      insuredObject: "Vehículo demo",
      beneficiaryInfo: "Beneficiario demo",
      notes: "Notas demo",
    });

    expect(defaults.clientId).toBe("client-1");
    expect(defaults.insurerId).toBe("insurer-1");
    expect(defaults.policyType).toBe("AUTO");
    expect(defaults.startDate).toBe("2027-05-28");
    expect(defaults.endDate).toBe("2028-05-28");
    expect(defaults.premiumAmount).toBe(12345.67);
    expect(defaults.paymentFrequency).toBe("ANNUAL");
    expect(defaults.renewedFromPolicyId).toBe("policy-1");
  });
});
