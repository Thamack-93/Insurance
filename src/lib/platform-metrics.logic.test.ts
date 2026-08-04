import { describe, expect, it } from "vitest";
import { buildMonthlyMetrics, formatMinorAmount, lastMonths } from "@/lib/platform-metrics";

describe("platform billing metrics", () => {
  it("keeps MRR and cash separate by currency", () => {
    const month = new Date("2026-08-01T00:00:00.000Z");
    const [result] = buildMonthlyMetrics(
      [month],
      [
        { status: "ACTIVE", monthlyAmountMinor: 250000, currency: "MXN", startedAt: new Date("2026-07-01"), endsAt: null },
        { status: "ACTIVE", monthlyAmountMinor: 10000, currency: "USD", startedAt: new Date("2026-07-01"), endsAt: null },
      ],
      [{ status: "PAID", amountMinor: 250000, currency: "MXN", paidAt: new Date("2026-08-05"), periodStart: month }],
    );
    expect(result.mrrByCurrency).toEqual({ MXN: 250000, USD: 10000 });
    expect(result.cashByCurrency).toEqual({ MXN: 250000 });
  });

  it("formats minor units and provides a six-month window", () => {
    expect(formatMinorAmount(12345, "MXN")).toContain("123.45");
    expect(lastMonths(6, new Date("2026-08-15T00:00:00Z"))).toHaveLength(6);
  });
});
