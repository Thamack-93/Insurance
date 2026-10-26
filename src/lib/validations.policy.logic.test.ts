import { describe, expect, it } from "vitest";
import {
  policySchema,
  policyUpdateSchemaForOriginalTerm,
  policyUpdateTermIsValid,
  policyPremiumBreakdownCaptureSchema,
  receiptSchema,
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

describe("financing premium validation", () => {
  it("accepts a negative surcharge from PDF policy capture", () => {
    expect(policyPremiumBreakdownCaptureSchema.safeParse({ premiumSurchargeAmount: -193.18 }).success).toBe(true);
  });

  it("accepts a negative policy-level financing adjustment", () => {
    const parsed = policyUpdateSchemaForOriginalTerm(historicalTerm).safeParse(
      policy({ premiumSurchargeAmount: -193.18 }),
    );

    expect(parsed.success).toBe(true);
  });

  it("accepts a negative receipt financing adjustment, including per-risk breakdown", () => {
    const parsed = receiptSchema.safeParse({
      receiptNumber: "1",
      policyId: "demo-policy",
      endorsementId: "",
      periodStartDate: "2026-10-30",
      periodEndDate: "2027-10-30",
      dueDate: "2026-11-13",
      amount: 11757.31,
      surchargeAmount: -193.18,
      premiumBreakdownByUnit: [{
        insuredAssetId: "demo-asset",
        totalPremium: 11757.31,
        vatAmount: 1621.70,
        issuanceExpenseAmount: 670,
        surchargeAmount: -193.18,
        discountAmount: 0,
      }],
      currency: "MXN",
      status: "PENDING",
      paidDate: "",
      paymentMethod: "",
      notes: "",
    });

    expect(parsed.success).toBe(true);
  });

  it("continues to reject negative issuance expense and discount values", () => {
    expect(policyUpdateSchemaForOriginalTerm(historicalTerm).safeParse(
      policy({ premiumIssuanceExpenseAmount: -1 }),
    ).success).toBe(false);
    expect(policyUpdateSchemaForOriginalTerm(historicalTerm).safeParse(
      policy({ premiumDiscountAmount: -1 }),
    ).success).toBe(false);
  });
});
