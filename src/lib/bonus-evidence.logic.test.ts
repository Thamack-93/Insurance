import { describe, expect, it } from "vitest";
import {
  autoFleetEligibilityFromInventory,
  bonusEligibilityEvidenceSchema,
  damagePortfolioLossRatioEvidenceSchema,
  isBonusReceiptOverpaid,
  validEvidenceDate,
} from "./bonus-evidence";

describe("bonus evidence and safeguards", () => {
  it("detects an overpayment when posted payments from different quarters exceed the receipt", () => {
    const receipt = 100;
    const postedAcrossQuarters = [40, 35, 25.02].reduce((sum, amount) => sum + amount, 0);
    expect(isBonusReceiptOverpaid(receipt, postedAcrossQuarters)).toBe(true);
    expect(isBonusReceiptOverpaid(receipt, 100.01)).toBe(false);
  });

  it("requires a supported fleet count and excludes the inclusive 50-vehicle limit", () => {
    expect(autoFleetEligibilityFromInventory({ insuredAssetCount: 49, structuredVehicleCount: 12, adminConfirmedInventoryComplete: true }))
      .toEqual({ fleetUnder50: true, vehicleCount: 49 });
    expect(autoFleetEligibilityFromInventory({ insuredAssetCount: 50, structuredVehicleCount: 12, adminConfirmedInventoryComplete: true }))
      .toEqual({ fleetUnder50: false, vehicleCount: 50 });
    expect(autoFleetEligibilityFromInventory({ insuredAssetCount: 0, structuredVehicleCount: 0, adminConfirmedInventoryComplete: true }))
      .toEqual({ fleetUnder50: null, vehicleCount: null });
  });

  it("accepts only valid dates and typed evidence fields", () => {
    expect(validEvidenceDate("2026-02-28")).toBe(true);
    expect(validEvidenceDate("2026-02-30")).toBe(false);
    expect(bonusEligibilityEvidenceSchema.safeParse({ productEligible: true, fleetUnder50: null, evidenceAsOf: "2026-02-28" }).success).toBe(true);
    expect(bonusEligibilityEvidenceSchema.safeParse({ productEligible: "true" }).success).toBe(false);
  });

  it("validates damage loss-ratio source, cutoff, and percentage", () => {
    expect(damagePortfolioLossRatioEvidenceSchema.safeParse({ lossRatioPercent: 50, asOf: "2026-03-31", sourceReference: "Reporte de cartera total" }).success).toBe(true);
    expect(damagePortfolioLossRatioEvidenceSchema.safeParse({ lossRatioPercent: 100.01, asOf: "2026-03-31", sourceReference: "Reporte válido" }).success).toBe(false);
    expect(damagePortfolioLossRatioEvidenceSchema.safeParse({ lossRatioPercent: 40, asOf: "2026-02-30", sourceReference: "Reporte válido" }).success).toBe(false);
  });
});
