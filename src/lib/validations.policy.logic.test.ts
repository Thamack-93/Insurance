import { describe, expect, it } from "vitest";
import {
  policySchema,
  policyUpdateSchemaForOriginalTerm,
  policyUpdateTermIsValid,
  type PolicyFormValues,
} from "@/lib/validations";

const historicalTerm = { startDate: "2025-10-10", endDate: "2027-09-10" };

function policy(overrides: Partial<PolicyFormValues> = {}): PolicyFormValues {
  return {
    policyNumber: "DEMO-POLICY-001",
    clientId: "demo-client",
    insurerId: "demo-insurer",
    policyType: "AUTO",
    status: "ACTIVE",
    startDate: historicalTerm.startDate,
    endDate: historicalTerm.endDate,
    premiumAmount: 1000,
    currency: "MXN",
    paymentFrequency: "ANNUAL",
    paymentPlan: "",
    insuredObject: "Synthetic vehicle",
    beneficiaryInfo: "",
    notes: "",
    renewedFromPolicyId: "",
    ...overrides,
  };
}

describe("policy term validation", () => {
  it("keeps the 366-day limit for new policies", () => {
    expect(policySchema.safeParse(policy()).success).toBe(false);
    expect(policySchema.safeParse(policy({ endDate: "2026-10-10" })).success).toBe(true);
  });

  it("allows editing an unchanged historical multiyear term", () => {
    const parsed = policyUpdateSchemaForOriginalTerm(historicalTerm).safeParse(policy());
    expect(parsed.success).toBe(true);
  });

  it("rejects extending a historical multiyear term during edit", () => {
    const next = { startDate: historicalTerm.startDate, endDate: "2028-09-10" };
    expect(policyUpdateSchemaForOriginalTerm(historicalTerm).safeParse(policy(next)).success).toBe(false);
    expect(policyUpdateTermIsValid(historicalTerm, next)).toBe(false);
  });

  it("allows replacing a historical term with a valid annual term", () => {
    const next = { startDate: "2025-10-10", endDate: "2026-10-10" };
    expect(policyUpdateSchemaForOriginalTerm(historicalTerm).safeParse(policy(next)).success).toBe(true);
    expect(policyUpdateTermIsValid(historicalTerm, next)).toBe(true);
  });
});
