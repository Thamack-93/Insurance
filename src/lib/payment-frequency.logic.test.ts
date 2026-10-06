import { describe, expect, it } from "vitest";
import { inferClearPaymentFrequency, supportsDomiciliatedPaymentMethod } from "./payment-frequency";

describe("payment-frequency", () => {
  it("allows domiciliado only for non-annual installment frequencies", () => {
    expect(supportsDomiciliatedPaymentMethod("MONTHLY")).toBe(true);
    expect(supportsDomiciliatedPaymentMethod("SEMIANNUAL")).toBe(true);
    expect(supportsDomiciliatedPaymentMethod("ANNUAL")).toBe(false);
    expect(supportsDomiciliatedPaymentMethod("SINGLE")).toBe(false);
  });
  it("normalizes a clear semianual SINGLE policy with two contiguous receipts", () => {
    const result = inferClearPaymentFrequency(
      {
        startDate: new Date("2024-03-15T00:00:00Z"),
        endDate: new Date("2025-03-15T00:00:00Z"),
        paymentFrequency: "SINGLE",
      },
      [
        {
          periodStartDate: new Date("2024-03-15T00:00:00Z"),
          periodEndDate: new Date("2024-09-15T00:00:00Z"),
          amount: 231194.81,
        },
        {
          periodStartDate: new Date("2024-09-15T00:00:00Z"),
          periodEndDate: new Date("2025-03-15T00:00:00Z"),
          amount: 230107.32,
        },
      ],
    );

    expect(result.normalizedFrequency).toBe("SEMIANNUAL");
    expect(result.reviewRequired).toBe(false);
    expect(result.receiptCount).toBe(2);
  });

  it("flags ambiguous SINGLE policies with multiple receipts for review", () => {
    const result = inferClearPaymentFrequency(
      {
        startDate: new Date("2024-03-15T00:00:00Z"),
        endDate: new Date("2025-03-15T00:00:00Z"),
        paymentFrequency: "SINGLE",
      },
      [
        {
          periodStartDate: new Date("2024-03-15T00:00:00Z"),
          periodEndDate: new Date("2024-07-15T00:00:00Z"),
          amount: 100000,
        },
        {
          periodStartDate: new Date("2024-07-15T00:00:00Z"),
          periodEndDate: new Date("2024-11-15T00:00:00Z"),
          amount: 100000,
        },
        {
          periodStartDate: new Date("2024-11-15T00:00:00Z"),
          periodEndDate: new Date("2025-03-15T00:00:00Z"),
          amount: 100000,
        },
      ],
    );

    expect(result.normalizedFrequency).toBeNull();
    expect(result.reviewRequired).toBe(true);
    expect(result.reason).toMatch(/3 recibos/);
    expect(result.receiptCount).toBe(3);
  });
});
