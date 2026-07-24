import { describe, expect, it } from "vitest";
import { getRemainingReceiptAmount, validatePaymentAgainstBalance } from "@/lib/payment-amount";

describe("payment balance rules", () => {
  it("calculates the remaining balance after partial payments", () => {
    expect(getRemainingReceiptAmount(1_000, [250, 125])).toBe(625);
  });

  it("accepts both partial and exact remaining payments", () => {
    expect(validatePaymentAgainstBalance({ amount: 200, totalAmount: 1_000, paidAmounts: [250], receiptStatus: "PENDING", currency: "MXN" })).toBeNull();
    expect(validatePaymentAgainstBalance({ amount: 750, totalAmount: 1_000, paidAmounts: [250], receiptStatus: "PENDING", currency: "MXN" })).toBeNull();
  });

  it("rejects negative, cancelled, paid and over-balance payments", () => {
    expect(validatePaymentAgainstBalance({ amount: 0, totalAmount: 1_000, paidAmounts: [], receiptStatus: "PENDING", currency: "MXN" })).toMatch(/mayor a cero/);
    expect(validatePaymentAgainstBalance({ amount: -1, totalAmount: 1_000, paidAmounts: [], receiptStatus: "PENDING", currency: "MXN" })).toMatch(/mayor a cero/);
    expect(validatePaymentAgainstBalance({ amount: 100, totalAmount: 1_000, paidAmounts: [], receiptStatus: "CANCELLED", currency: "MXN" })).toMatch(/cancelado/);
    expect(validatePaymentAgainstBalance({ amount: 100, totalAmount: 1_000, paidAmounts: [1_000], receiptStatus: "PAID", currency: "MXN" })).toMatch(/saldo pendiente/);
    expect(validatePaymentAgainstBalance({ amount: 751, totalAmount: 1_000, paidAmounts: [250], receiptStatus: "PENDING", currency: "MXN" })).toBe("El pago excede el saldo pendiente de 750.00 MXN.");
  });

  it("allows the one-cent floating-point tolerance but rejects a material overpayment", () => {
    expect(validatePaymentAgainstBalance({ amount: 100.005, totalAmount: 100, paidAmounts: [], receiptStatus: "PENDING", currency: "MXN" })).toBeNull();
    expect(validatePaymentAgainstBalance({ amount: 100.011, totalAmount: 100, paidAmounts: [], receiptStatus: "PENDING", currency: "MXN" })).toMatch(/excede/);
  });
});
