import { describe, expect, it } from "vitest";
import { allocatePaidNetPremium, deriveNetPremium, deriveReceiptNetPremium, reconcileEndorsementReceiptPremium, reconcilePolicyReceiptPremium } from "./premium-breakdown";

describe("shared receipt premium breakdown", () => {
  it("derives prima neta with the user-confirmed signs", () => {
    expect(deriveNetPremium(1160, { vatAmount: 160, issuanceExpenseAmount: 20, surchargeAmount: 10, discountAmount: 30 })).toBe(1000);
  });

  it("requires every component and rejects a negative result", () => {
    expect(deriveNetPremium(1160, {})).toBeNull();
    expect(deriveNetPremium(100, { vatAmount: 20, issuanceExpenseAmount: 20, surchargeAmount: 70, discountAmount: 0 })).toBeNull();
  });

  it("sums a complete per-unit breakdown only when gross unit totals reconcile", () => {
    const rows = [
      { insuredAssetId: "a", totalPremium: 600, vatAmount: 80, issuanceExpenseAmount: 10, surchargeAmount: 5, discountAmount: 15 },
      { insuredAssetId: "b", totalPremium: 560, vatAmount: 80, issuanceExpenseAmount: 10, surchargeAmount: 5, discountAmount: 15 },
    ];
    expect(deriveReceiptNetPremium({ amount: 1160, premiumBreakdownByUnit: rows })).toBe(1000);
    expect(deriveReceiptNetPremium({ amount: 1161, premiumBreakdownByUnit: rows })).toBeNull();
  });

  it("prorates only posted paid amounts and caps at the receipt amount", () => {
    expect(allocatePaidNetPremium(1000, 1160, 580)).toBe(500);
    expect(allocatePaidNetPremium(1000, 1160, 1300)).toBe(1000);
  });

  it("reconciles policy total to non-cancelled base receipts and excludes endorsement receipts", () => {
    expect(reconcilePolicyReceiptPremium(1160, [
      { amount: 580, status: "PENDING" }, { amount: 580, status: "PAID" },
      { amount: 40, status: "PENDING", endorsementId: "endorsement-1" }, { amount: 20, status: "CANCELLED" },
    ])).toMatchObject({ receiptTotal: 1160, difference: 0, status: "RECONCILED" });
  });

  it("reconciles an endorsement against only its own non-cancelled receipts", () => {
    expect(reconcileEndorsementReceiptPremium(100, [
      { amount: 40, status: "PENDING" }, { amount: 60, status: "PAID" }, { amount: 20, status: "CANCELLED" },
    ])).toMatchObject({ receiptTotal: 100, difference: 0, status: "RECONCILED" });
  });

  it("accepts premium reconciliation differences up to one peso and reviews larger differences", () => {
    expect(reconcilePolicyReceiptPremium(101, [{ amount: 100, status: "PAID" }])).toMatchObject({ difference: 1, status: "RECONCILED" });
    expect(reconcilePolicyReceiptPremium(101.01, [{ amount: 100, status: "PAID" }])).toMatchObject({ difference: 1.01, status: "REVIEW" });
    expect(reconcileEndorsementReceiptPremium(101, [{ amount: 100, status: "PAID" }])).toMatchObject({ difference: 1, status: "RECONCILED" });
    expect(reconcileEndorsementReceiptPremium(101.01, [{ amount: 100, status: "PAID" }])).toMatchObject({ difference: 1.01, status: "REVIEW" });
  });
});
