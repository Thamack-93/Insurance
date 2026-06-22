import { describe, expect, it } from "vitest";
import { reconcileReceiptState } from "./receipt-reconciliation";

describe("receipt-reconciliation", () => {
  it("keeps a fully paid receipt as PAID and uses the latest payment metadata", () => {
    const result = reconcileReceiptState({
      amount: 1000,
      status: "PENDING",
      dueDate: new Date("2024-06-01T00:00:00Z"),
      paidDate: null,
      paymentMethod: null,
      payments: [
        {
          amount: 400,
          paidDate: new Date("2024-06-05T10:00:00Z"),
          paymentMethod: "TRANSFER",
        },
        {
          amount: 600,
          paidDate: new Date("2024-06-06T10:00:00Z"),
          paymentMethod: "SPEI",
        },
      ],
      now: new Date("2024-06-07T00:00:00Z"),
    });

    expect(result.nextStatus).toBe("PAID");
    expect(result.nextPaidDate?.toISOString()).toBe("2024-06-06T10:00:00.000Z");
    expect(result.nextPaymentMethod).toBe("SPEI");
    expect(result.shouldReview).toBe(false);
  });

  it("downgrades a stale PAID receipt without payments to OVERDUE and clears paid fields", () => {
    const result = reconcileReceiptState({
      amount: 1500,
      status: "PAID",
      dueDate: new Date("2024-05-01T00:00:00Z"),
      paidDate: new Date("2024-05-02T00:00:00Z"),
      paymentMethod: "CARD",
      payments: [],
      now: new Date("2024-06-07T00:00:00Z"),
    });

    expect(result.nextStatus).toBe("OVERDUE");
    expect(result.nextPaidDate).toBeNull();
    expect(result.nextPaymentMethod).toBeNull();
    expect(result.shouldReview).toBe(true);
  });

  it("keeps a receipt pending when the due date is still the same calendar day", () => {
    const result = reconcileReceiptState({
      amount: 1500,
      status: "PENDING",
      dueDate: new Date("2024-06-13T06:00:00Z"),
      paidDate: null,
      paymentMethod: null,
      payments: [],
      now: new Date("2024-06-14T05:59:59Z"),
    });

    expect(result.nextStatus).toBe("PENDING");
    expect(result.shouldReview).toBe(false);
  });

  it("marks a partially paid future receipt as PENDING and flags it for review", () => {
    const result = reconcileReceiptState({
      amount: 2000,
      status: "PAID",
      dueDate: new Date("2024-07-01T00:00:00Z"),
      paidDate: new Date("2024-06-02T00:00:00Z"),
      paymentMethod: "TRANSFER",
      payments: [
        {
          amount: 500,
          paidDate: new Date("2024-06-03T00:00:00Z"),
          paymentMethod: "TRANSFER",
        },
      ],
      now: new Date("2024-06-07T00:00:00Z"),
    });

    expect(result.nextStatus).toBe("PENDING");
    expect(result.nextPaidDate).toBeNull();
    expect(result.nextPaymentMethod).toBeNull();
    expect(result.shouldReview).toBe(true);
    expect(result.reasons).toContain("partial_payment");
  });

  it("preserves cancelled receipts", () => {
    const result = reconcileReceiptState({
      amount: 1000,
      status: "CANCELLED",
      dueDate: new Date("2024-05-01T00:00:00Z"),
      paidDate: new Date("2024-05-02T00:00:00Z"),
      paymentMethod: "TRANSFER",
      payments: [
        {
          amount: 1000,
          paidDate: new Date("2024-05-02T00:00:00Z"),
          paymentMethod: "TRANSFER",
        },
      ],
    });

    expect(result.nextStatus).toBe("CANCELLED");
    expect(result.nextPaidDate?.toISOString()).toBe("2024-05-02T00:00:00.000Z");
    expect(result.nextPaymentMethod).toBe("TRANSFER");
    expect(result.shouldReview).toBe(true);
  });
});
