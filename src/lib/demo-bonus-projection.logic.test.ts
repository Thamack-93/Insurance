import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { calculateBonusProjection } from "@/lib/bonus-calculation";
import { BONUS_PROGRAMS } from "@/lib/bonus-rules";
import { serializeBonusEligibilityEvidence } from "@/lib/bonus-evidence";

const sellerId = "demo-owner";
const paidDate = new Date("2026-10-01T12:00:00.000Z");

function projectionDb(policyType: string, insurerName: string, evidence: string) {
  const receipt = {
    id: "demo-receipt-1", amount: 1160, currency: "MXN", endorsementId: null,
    vatAmount: 160, issuanceExpenseAmount: 0, surchargeAmount: 0, discountAmount: 0,
    premiumBreakdownByUnit: null,
  };
  const payment = {
    id: "demo-payment-1", organizationId: "demo-org", receiptId: receipt.id, policyId: "demo-policy-1",
    amount: 1160, currency: "MXN", status: "POSTED", paidDate, receipt,
    policy: {
      id: "demo-policy-1", organizationId: "demo-org", policyNumber: "DEMO-1", policyType,
      status: "ACTIVE", startDate: new Date("2026-01-01T12:00:00.000Z"), premiumAmount: 1160,
      bonusSellerId: sellerId, bonusEligibilityJson: evidence, riskDetails: { data: { vehicles: [{ unitClass: "DEMO" }] } },
      client: { portfolioOwnerId: sellerId }, insurer: { name: insurerName }, insuredAssets: [{ id: "demo-asset-1" }],
    },
  };
  return {
    payment: {
      findMany: vi.fn().mockResolvedValue([payment]),
      groupBy: vi.fn().mockResolvedValue([{ receiptId: receipt.id, _sum: { amount: 1160 } }]),
    },
    currencyRate: { findMany: vi.fn().mockResolvedValue([]) },
    receipt: {
      findMany: vi.fn().mockResolvedValue([{
        id: receipt.id, policyId: payment.policyId, receiptSequence: 1, endorsementId: null, amount: 1160,
        status: "PAID", cancelledAt: null, cancellationReason: null, payments: [{ id: payment.id }],
      }]),
    },
    policyEndorsement: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

describe("demo bonus projection readiness", () => {
  it.each([
    ["AUTO_2026", "AUTO", "Quálitas · DEMO"],
    ["DAMAGE_CHUBB_2026", "HOGAR", "Chubb · DEMO"],
    ["DAMAGE_Q_2026", "EMPRESARIAL", "Banorte · DEMO"],
  ])("calculates %s from eligible synthetic evidence without review", async (programKey, policyType, insurerName) => {
    const evidence = serializeBonusEligibilityEvidence({
      productEligible: true,
      sellerAttributionConfirmed: true,
      sourceReference: "Semilla sintética DEMO",
      evidenceAsOf: "2026-10-26",
      reviewedById: sellerId,
      reviewedAt: "2026-10-26T12:00:00.000Z",
      ...(policyType === "AUTO" ? { fleetUnder50: true, autoExclusionsReviewed: true } : {
        businessType: "Ejemplo sintético DEMO", facultativeInsuranceReviewed: true,
        specialConditionsReviewed: true, directedBusinessReviewed: true,
        frontingReviewed: true, damageExclusionsReviewed: true,
      }),
    });
    const program = BONUS_PROGRAMS.find((rule) => rule.key === programKey)!;
    const db = projectionDb(policyType, insurerName, evidence);
    const result = await calculateBonusProjection(db as never, "demo-org", program, {
      programKey, sellerId, year: 2026, periodNumber: 4,
      ...(programKey.startsWith("DAMAGE_") ? {
        damagePortfolioLossRatio: 0.3,
        damagePortfolioLossRatioAsOf: "2026-10-26",
        damagePortfolioLossRatioSource: "Dato sintético DEMO para la prueba.",
      } : {}),
    });

    expect(result.status).toBe("READY");
    expect(result.reviewReasons).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ status: "INCLUDED", netPremiumPaid: "1000.00", eligibleAmount: "1000.00" });
  });
});
