import { describe, expect, it } from "vitest";
import { allocatePaidNetPremium, deriveNetPremium, deriveReceiptNetPremium, exceedsReceiptPaymentTolerance, policyPremiumBreakdownChanged, reconcileEndorsementReceiptPremium, reconcilePolicyReceiptPremium } from "./premium-breakdown";

describe("shared receipt premium breakdown", () => {
  it("derives prima neta with the user-confirmed signs", () => {
    expect(deriveNetPremium(1160, { vatAmount: 160, issuanceExpenseAmount: 20, surchargeAmount: 10, discountAmount: 30 })).toBe(1000);
    expect(deriveNetPremium(1160, { vatAmount: 160, issuanceExpenseAmount: 20, surchargeAmount: -10, discountAmount: 30 })).toBe(1020);
  });

  it("detects policy breakdown changes without treating unchanged totals as a receipt resync", () => {
    const saved = { vatAmount: 160, issuanceExpenseAmount: 20, surchargeAmount: -10, discountAmount: 30 };
    expect(policyPremiumBreakdownChanged(saved, { ...saved })).toBe(false);
    expect(policyPremiumBreakdownChanged(saved, { ...saved, surchargeAmount: -11 })).toBe(true);
    expect(policyPremiumBreakdownChanged({ vatAmount: null }, { vatAmount: 0 })).toBe(true);
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

  it("offsets a cancelled unpaid final installment while preserving the original policy premium", () => {
    const cancelledAt = new Date("2026-08-05T18:20:21.325Z");
    const result = reconcilePolicyReceiptPremium(28826.67, [
      { amount: 7772.16, status: "PAID", receiptSequence: 1 },
      { amount: 7018.17, status: "PAID", receiptSequence: 2 },
      { amount: 7018.17, status: "PAID", receiptSequence: 3 },
      { id: "cancelled-fourth-installment", amount: 7018.17, status: "CANCELLED", receiptSequence: 4, cancelledAt, cancellationReason: "NON_PAYMENT", postedPaymentCount: 0 },
    ]);

    expect(result).toMatchObject({
      expectedTotal: 21808.5,
      receiptTotal: 21808.5,
      difference: 0,
      cancellationOffset: 7018.17,
      cancelledReceiptIds: ["cancelled-fourth-installment"],
      status: "RECONCILED",
    });
  });

  it("does not offset non-final, paid, or unsupported cancelled receipts", () => {
    const cancelledAt = new Date("2026-08-05T18:20:21.325Z");
    const finalUnpaid = { id: "cancelled-final", amount: 7018.17, status: "CANCELLED", receiptSequence: 4, cancelledAt, cancellationReason: "NON_PAYMENT", postedPaymentCount: 0 };
    expect(reconcilePolicyReceiptPremium(28826.67, [
      { amount: 7772.16, status: "PAID", receiptSequence: 1 },
      { amount: 7018.17, status: "PAID", receiptSequence: 2 },
      { amount: 7018.17, status: "PAID", receiptSequence: 3 },
      { ...finalUnpaid, postedPaymentCount: 1 },
    ])).toMatchObject({ cancellationOffset: 0, difference: 7018.17, status: "REVIEW" });
    expect(reconcilePolicyReceiptPremium(28826.67, [
      { amount: 7772.16, status: "PAID", receiptSequence: 1 },
      { amount: 7018.17, status: "PAID", receiptSequence: 2 },
      { ...finalUnpaid, receiptSequence: 3 },
      { amount: 7018.17, status: "PAID", receiptSequence: 4 },
    ])).toMatchObject({ cancellationOffset: 0, difference: 7018.17, status: "REVIEW" });
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

  it("accepts posted-payment excess up to one peso and reviews larger excess", () => {
    expect(exceedsReceiptPaymentTolerance(3737.21, 3737.16)).toBe(false);
    expect(exceedsReceiptPaymentTolerance(101, 100)).toBe(false);
    expect(exceedsReceiptPaymentTolerance(101.01, 100)).toBe(true);
  });
});
