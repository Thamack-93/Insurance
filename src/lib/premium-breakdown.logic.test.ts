import { describe, expect, it } from "vitest";
import { allocatePaidNetPremium, commissionPremiumBase, deriveNetPremium } from "./premium-breakdown";

describe("receipt premium breakdown", () => {
  it("derives net premium from the billed total and explicit components", () => {
    expect(deriveNetPremium(1160, { vatAmount: 160, issuanceExpenseAmount: 20, surchargeAmount: 10, discountAmount: 30 })).toBe(1000);
  });

  it("keeps net premium unavailable when the breakdown is missing", () => {
    expect(deriveNetPremium(1160, {})).toBeNull();
    expect(deriveNetPremium(1160, { vatAmount: 160, issuanceExpenseAmount: 20 })).toBeNull();
  });

  it("allocates net premium proportionally to posted partial payments and caps overpayment", () => {
    expect(allocatePaidNetPremium(1000, 1160, 580)).toBe(500);
    expect(allocatePaidNetPremium(1000, 1160, 1300)).toBe(1000);
  });

  it("shares the derived receipt base with commissions while preserving legacy fallback", () => {
    expect(commissionPremiumBase(1000, 1160)).toBe(1000);
    expect(commissionPremiumBase(null, 1160)).toBe(1160);
  });
});
