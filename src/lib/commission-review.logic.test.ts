import { describe, expect, it } from "vitest";
import {
  classifyCommissionReviewCandidate,
  groupCommissionReviewsByPolicy,
  isMissingCommissionPremiumInformation,
  type CommissionReviewCandidateInput,
} from "./commission-review";

const candidate = (overrides: Partial<CommissionReviewCandidateInput> = {}): CommissionReviewCandidateInput => ({
  receiptId: "receipt-1",
  receiptNumber: "REC-1",
  policyId: "policy-1",
  policyNumber: "POL-1",
  clientName: "Cliente",
  insurerName: "Aseguradora",
  amount: 1000,
  currency: "MXN",
  reason: "Falta evidencia de prima.",
  calculationStatus: "REVIEW",
  receiptStatus: "PAID",
  postedPaymentCount: 1,
  updatedAt: new Date("2026-11-01T00:00:00.000Z"),
  ...overrides,
});

describe("commission review classification", () => {
  it("prioritizes a paid receipt with posted payment evidence", () => {
    expect(classifyCommissionReviewCandidate(candidate())).toBe("ACTIONABLE");
  });

  it("keeps posted payment evidence actionable after a receipt is cancelled", () => {
    expect(classifyCommissionReviewCandidate(candidate({ receiptStatus: "CANCELLED" }))).toBe("ACTIONABLE");
  });

  it("separates cancelled unpaid and pending unpaid reviews", () => {
    expect(classifyCommissionReviewCandidate(candidate({ receiptStatus: "CANCELLED", postedPaymentCount: 0 }))).toBe("CANCELLED_UNPAID");
    expect(classifyCommissionReviewCandidate(candidate({ receiptStatus: "PENDING", postedPaymentCount: 0 }))).toBe("PENDING_UNPAID");
  });

  it("does not imply a commission for other unpaid receipt states", () => {
    expect(classifyCommissionReviewCandidate(candidate({ receiptStatus: "OVERDUE", postedPaymentCount: 0 }))).toBeNull();
  });

  it("groups receipts once by policy while preserving distinct reasons and currencies", () => {
    const groups = groupCommissionReviewsByPolicy([
      candidate({ receiptId: "receipt-2", receiptNumber: "REC-2", reason: "Falta IVA.", currency: "USD", amount: 25 }),
      candidate({ receiptId: "receipt-1", receiptNumber: "REC-1", reason: "Falta prima total.", currency: "MXN", amount: 1000 }),
      candidate({ receiptId: "receipt-3", policyId: "policy-2", policyNumber: "POL-2", receiptNumber: "REC-3" }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.receipts.map((row) => [row.receiptNumber, row.reason, row.amount, row.currency])).toEqual([
      ["REC-1", "Falta prima total.", 1000, "MXN"],
      ["REC-2", "Falta IVA.", 25, "USD"],
    ]);
    expect(groups[1]?.policyNumber).toBe("POL-2");
  });

  it("recognizes missing premium information for a guided editor link", () => {
    expect(isMissingCommissionPremiumInformation("El desglose de prima por unidad está incompleto.")).toBe(true);
    expect(isMissingCommissionPremiumInformation("Falta capturar uno o más componentes para derivar la prima neta.")).toBe(true);
    expect(isMissingCommissionPremiumInformation("No existe una regla de comisión vigente.")).toBe(false);
  });
});
