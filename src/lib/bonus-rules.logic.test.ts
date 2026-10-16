import { describe, expect, it } from "vitest";
import { BONUS_PROGRAMS, damagePortfolioLossRatioStatus, selectBonusTier } from "./bonus-rules";

describe("2026 incentive rules", () => {
  it("selects Auto tiers at the exact published lower boundaries", () => {
    const rules = BONUS_PROGRAMS.find((program) => program.key === "AUTO_2026");
    expect(rules).toBeDefined();
    expect(selectBonusTier(300000, rules?.tiers)?.rate).toBe(0.01);
    expect(selectBonusTier(500000, rules?.tiers)?.rate).toBe(0.01);
    expect(selectBonusTier(500000.00000001, rules?.tiers)?.rate).toBe(0.02);
    expect(selectBonusTier(1250000, rules?.tiers)?.rate).toBe(0.02);
    expect(selectBonusTier(1250000.00000001, rules?.tiers)?.rate).toBe(0.03);
    expect(selectBonusTier(5100000.00000001, rules?.tiers)?.rate).toBe(0.06);
    expect(selectBonusTier(9999999, rules?.tiers)?.rate).toBe(0.06);
    expect(selectBonusTier(10000000, rules?.tiers)).toBeNull();
    expect(selectBonusTier(299999, rules?.tiers)).toBeNull();
  });

  it("limits the active phase to Auto and Damage periods", () => {
    expect(BONUS_PROGRAMS.find((program) => program.key === "AUTO_2026")?.accumulation).toBe("YEAR_TO_DATE");
    expect(BONUS_PROGRAMS.find((program) => program.key === "DAMAGE_CHUBB_2026")?.period).toBe("ANNUAL");
    expect(BONUS_PROGRAMS.find((program) => program.key === "DAMAGE_Q_2026")?.period).toBe("QUARTERLY");
    expect(BONUS_PROGRAMS.map((program) => program.key)).toEqual(["AUTO_2026", "DAMAGE_CHUBB_2026", "DAMAGE_Q_2026"]);
    expect(BONUS_PROGRAMS.find((program) => program.key === "AUTO_2026")?.requiresEvidence).not.toContain("newBusiness");
    expect(BONUS_PROGRAMS.find((program) => program.key === "AUTO_2026")?.requiresEvidence).not.toContain("lossRatio");
  });

  it("selects the two Damage programs on their published bands", () => {
    const annual = BONUS_PROGRAMS.find((program) => program.key === "DAMAGE_CHUBB_2026");
    const quarterly = BONUS_PROGRAMS.find((program) => program.key === "DAMAGE_Q_2026");
    expect(selectBonusTier(350000, annual?.tiers)?.rate).toBe(0.005);
    expect(selectBonusTier(350000.00000001, annual?.tiers)?.rate).toBe(0.01);
    expect(selectBonusTier(8000000, annual?.tiers)?.rate).toBe(0.08);
    expect(selectBonusTier(8000000.00000001, annual?.tiers)?.rate).toBe(0.1);
    expect(selectBonusTier(200000, quarterly?.tiers)?.rate).toBe(0.01);
    expect(selectBonusTier(300000, quarterly?.tiers)?.rate).toBe(0.01);
    expect(selectBonusTier(300000.00000001, quarterly?.tiers)?.rate).toBe(0.02);
    expect(selectBonusTier(1400000, quarterly?.tiers)?.rate).toBe(0.06);
    expect(selectBonusTier(1400000.00000001, quarterly?.tiers)?.rate).toBe(0.07);
  });

  it("uses one total Damage portfolio loss ratio and accepts exactly 50 percent", () => {
    expect(damagePortfolioLossRatioStatus(undefined)).toBe("MISSING");
    expect(damagePortfolioLossRatioStatus(0.5)).toBe("ELIGIBLE");
    expect(damagePortfolioLossRatioStatus(0.50000001)).toBe("EXCLUDED");
  });
});
