import { describe, expect, it } from "vitest";
import { getCommissionPeriodRange } from "@/lib/commissions-periods";

describe("commission period shortcuts", () => {
  it("uses the complete previous month and crosses the year boundary", () => {
    expect(getCommissionPeriodRange("2026-01-12", "PREVIOUS_MONTH")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("uses the complete current month including leap day", () => {
    expect(getCommissionPeriodRange("2024-02-12", "CURRENT_MONTH")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });

  it("uses the full current year", () => {
    expect(getCommissionPeriodRange("2026-11-12", "CURRENT_YEAR")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});
