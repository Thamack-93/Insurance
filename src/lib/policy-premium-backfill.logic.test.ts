import { describe, expect, it } from "vitest";
import { evaluatePolicyPremiumBackfill, type PolicyPremiumBackfillPolicy } from "./policy-premium-backfill";

function policy(overrides: Partial<PolicyPremiumBackfillPolicy> = {}): PolicyPremiumBackfillPolicy {
  return {
    id: "policy-1",
    policyNumber: "POL-1",
    policyType: "AUTO",
    premiumAmount: 1160,
    receipts: [{ id: "receipt-1", status: "PENDING", amount: 1160, vatAmount: 160, issuanceExpenseAmount: 20, surchargeAmount: -10, discountAmount: 30 }],
    ...overrides,
  };
}

describe("policy premium backfill classifier", () => {
  it("consolidates complete active base receipt components without mutating receipt values", () => {
    expect(evaluatePolicyPremiumBackfill(policy())).toMatchObject({
      status: "CANDIDATE",
      totals: { vatAmount: 160, issuanceExpenseAmount: 20, surchargeAmount: -10, discountAmount: 30 },
      receiptIds: ["receipt-1"],
    });
  });

  it("excludes endorsements and cancelled installments from live premium totals", () => {
    const result = evaluatePolicyPremiumBackfill(policy({ receipts: [
      { id: "active", status: "PAID", amount: 1160, vatAmount: 160, issuanceExpenseAmount: 20, surchargeAmount: 0, discountAmount: 0 },
      { id: "cancelled", status: "CANCELLED", amount: 500, vatAmount: 68.97, issuanceExpenseAmount: 0, surchargeAmount: 0, discountAmount: 0 },
      { id: "endorsement", status: "PENDING", endorsementId: "endo-1", amount: 100, vatAmount: 13.79, issuanceExpenseAmount: 0, surchargeAmount: 0, discountAmount: 0 },
    ] }));

    expect(result.status).toBe("CANDIDATE");
    expect(result.receiptIds).toEqual(["active"]);
  });

  it("sums valid unit rows for policy totals while retaining the receipt row identity", () => {
    const result = evaluatePolicyPremiumBackfill(policy({ receipts: [{
      id: "fleet-receipt",
      status: "PENDING",
      amount: 1160,
      premiumBreakdownByUnit: [
        { insuredAssetId: "asset-1", totalPremium: 600, vatAmount: 80, issuanceExpenseAmount: 10, surchargeAmount: -5, discountAmount: 15 },
        { insuredAssetId: "asset-2", totalPremium: 560, vatAmount: 80, issuanceExpenseAmount: 10, surchargeAmount: -5, discountAmount: 15 },
      ],
    }] }));

    expect(result).toMatchObject({ status: "CANDIDATE", totals: { vatAmount: 160, issuanceExpenseAmount: 20, surchargeAmount: -10, discountAmount: 30 }, receiptIds: ["fleet-receipt"] });
  });

  it("holds policies with a gross mismatch, missing active receipts, or incomplete receipt values", () => {
    expect(evaluatePolicyPremiumBackfill(policy({ premiumAmount: 1160.05 })).status).toBe("REVIEW");
    expect(evaluatePolicyPremiumBackfill(policy({ receipts: [{ id: "cancelled", status: "CANCELLED", amount: 1160 }] })).reason).toContain("No hay recibos base activos");
    expect(evaluatePolicyPremiumBackfill(policy({ receipts: [{ id: "incomplete", status: "PAID", amount: 1160 }] })).reason).toContain("sin desglose completo");
    expect(evaluatePolicyPremiumBackfill(policy({ receipts: [{
      id: "null-unit-component",
      status: "PAID",
      amount: 1160,
      premiumBreakdownByUnit: [{ insuredAssetId: "asset-1", totalPremium: 1160, vatAmount: null, issuanceExpenseAmount: 0, surchargeAmount: 0, discountAmount: 0 }],
    }] })).reason).toContain("sin desglose completo");
  });

  it("does not overwrite a partial or already complete policy-level breakdown", () => {
    expect(evaluatePolicyPremiumBackfill(policy({ premiumVatAmount: 160 })).status).toBe("REVIEW");
    expect(evaluatePolicyPremiumBackfill(policy({ premiumVatAmount: 160, premiumIssuanceExpenseAmount: 20, premiumSurchargeAmount: -10, premiumDiscountAmount: 30 })).status).toBe("ALREADY_COMPLETE");
  });
});
