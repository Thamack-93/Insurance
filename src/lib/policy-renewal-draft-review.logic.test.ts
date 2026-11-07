import { describe, expect, it } from "vitest";
import { buildRenewalDraftReview, getRenewalDraftFingerprint } from "@/lib/policy-renewal-draft-review.logic";
import type { PolicyRenewalSource } from "@/lib/policy-renewal";
import type { PolicyFormValues } from "@/lib/validations";

const risk = (vin: string) => ({
  version: 1 as const, policyType: "AUTO" as const,
  commissionUnitClass: "",
  data: { vehicles: [{ make: "Toyota", model: "Corolla", year: "2022", version: "", vin, plates: "", unitClass: "" }] },
});
const source: PolicyRenewalSource = {
  id: "old", clientId: "client", insurerId: "insurer", clientName: "Cliente", insurerName: "Aseguradora",
  policyNumber: "AAA-123", policyType: "AUTO", startDate: new Date("2025-06-01T00:00:00Z"),
  endDate: new Date("2026-06-01T00:00:00Z"), premiumAmount: 10000, currency: "MXN",
  paymentFrequency: "ANNUAL", paymentPlan: null, insuredObject: null,
  beneficiaryInfo: null, notes: null, riskDetails: risk("VIN001"),
};
const draft = {
  clientId: "client", insurerId: "insurer", policyType: "AUTO", policyNumber: "AAA-123",
  startDate: "2026-06-01", endDate: "2027-06-01", premiumAmount: 12000,
  currency: "MXN", paymentFrequency: "ANNUAL", riskDetails: risk("VIN002"),
  premiumIssuanceExpenseAmount: 0, premiumSurchargeAmount: 0, premiumDiscountAmount: 0,
} as PolicyFormValues;

describe("pre-save renewal review", () => {
  it("reveals premium and asset-identity changes without inferring a wrong source", () => {
    const result = buildRenewalDraftReview(source, draft);
    expect(result.issue).toBeNull();
    expect(result.changes.some((entry) => entry.label === "Prima total")).toBe(true);
    expect(result.changes.some((entry) => entry.label.includes("VIN"))).toBe(true);
  });
  it("blocks missing identity or an already-renewed predecessor", () => {
    expect(buildRenewalDraftReview(source, { ...draft, clientId: "other" }).issue).toMatch(/cliente/);
    expect(buildRenewalDraftReview({ ...source, hasRenewal: true }, draft).issue).toMatch(/ya tiene/);
  });
  it("flags unverified risk data and cross-currency premiums", () => {
    const result = buildRenewalDraftReview(source, { ...draft, riskDetails: undefined, currency: "USD" });
    expect(result.warnings.some((note) => note.includes("estructurados"))).toBe(true);
    expect(result.warnings.some((note) => note.includes("monedas"))).toBe(true);
  });
  it("invalidates a prior acknowledgement whenever relevant draft details change", () => {
    expect(getRenewalDraftFingerprint(source.id, draft)).not.toBe(getRenewalDraftFingerprint(source.id, { ...draft, premiumAmount: 14000 }));
    expect(getRenewalDraftFingerprint(source.id, draft)).not.toBe(getRenewalDraftFingerprint("other", draft));
  });
});
