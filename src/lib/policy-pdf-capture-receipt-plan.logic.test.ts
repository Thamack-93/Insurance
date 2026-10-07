import { describe, expect, it } from "vitest";
import { mergePolicyPdfCaptureReceiptPlan } from "@/lib/policy-pdf-capture.shared";

describe("mergePolicyPdfCaptureReceiptPlan", () => {
  it("shows matching single-receipt evidence in the review schedule", () => {
    const plan = mergePolicyPdfCaptureReceiptPlan(
      {
        policyNumber: "0940463089",
        startDate: "2026-10-25",
        endDate: "2027-10-25",
        paymentFrequency: "SINGLE",
        premiumAmount: 7067.18,
        currency: "MXN",
      },
      [],
      {
        policyNumber: "940463089",
        receiptControlNumber: "0312242788",
        dueDate: "2026-11-08",
        periodLabel: "01/01",
        amountDue: 7067.18,
        depositAmount: 7067,
        currency: "MXN",
        paymentMethod: "CONTADO",
        paymentConfirmed: false,
        warnings: [],
      },
    );

    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ receiptNumber: "0312242788", dueDate: "2026-11-08" });
  });

  it("applies matching period evidence to one term in the review schedule", () => {
    const plan = mergePolicyPdfCaptureReceiptPlan(
      {
        policyNumber: "P-123",
        startDate: "2026-07-22",
        endDate: "2027-07-22",
        paymentFrequency: "SEMIANNUAL",
        premiumAmount: 1200,
        currency: "MXN",
      },
      [],
      {
        policyNumber: "P-123",
        receiptControlNumber: "CONTROL-1",
        dueDate: "2027-01-05",
        periodLabel: "02/02",
        amountDue: 600,
        depositAmount: 0,
        currency: "MXN",
        paymentMethod: null,
        paymentConfirmed: false,
        warnings: [],
      },
    );

    expect(plan[0]?.dueDate).toBe("2026-07-22");
    expect(plan[1]?.dueDate).toBe("2027-01-05");
    expect(plan[1]?.receiptNumber).toBe("2");
  });

  it("ignores evidence belonging to a different policy", () => {
    const plan = mergePolicyPdfCaptureReceiptPlan(
      {
        policyNumber: "P-123",
        startDate: "2026-10-25",
        endDate: "2027-10-25",
        paymentFrequency: "ANNUAL",
        premiumAmount: 1000,
        currency: "MXN",
      },
      [],
      {
        policyNumber: "P-OTHER",
        receiptControlNumber: "CONTROL-1",
        dueDate: "2026-11-08",
        periodLabel: null,
        amountDue: 1000,
        depositAmount: 1000,
        currency: "MXN",
        paymentMethod: null,
        paymentConfirmed: false,
        warnings: [],
      },
    );

    expect(plan[0]).toMatchObject({ receiptNumber: "1", dueDate: "2026-10-25" });
  });
});
