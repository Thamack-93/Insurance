import { describe, expect, it } from "vitest";
import {
  buildMonthlyBillingMetrics,
  formatMinorAmount,
  lastMonths,
  latestMetricTotals,
  normalizeBillingCurrency,
  parseMinorAmount,
} from "@/lib/platform-billing.logic";

describe("platform billing logic", () => {
  it("keeps MRR and paid cash separate by currency", () => {
    const month = new Date("2026-08-01T00:00:00.000Z");
    const result = buildMonthlyBillingMetrics(
      [month],
      [
        { status: "ACTIVE", monthlyAmountMinor: 250000, currency: "MXN", startedAt: new Date("2026-07-01"), endsAt: null },
        { status: "PAST_DUE", monthlyAmountMinor: 10000, currency: "USD", startedAt: new Date("2026-07-01"), endsAt: null },
        { status: "TRIAL", monthlyAmountMinor: 90000, currency: "MXN", startedAt: new Date("2026-07-01"), endsAt: null },
      ],
      [
        { status: "PAID", amountMinor: 250000, currency: "MXN", paidAt: new Date("2026-08-05") },
        { status: "PAID", amountMinor: 50000, currency: "USD", paidAt: null },
        { status: "PENDING", amountMinor: 90000, currency: "MXN", paidAt: null },
      ],
    )[0];

    expect(result.mrrByCurrency).toEqual({ MXN: 250000, USD: 10000 });
    expect(result.cashByCurrency).toEqual({ MXN: 250000 });
  });

  it("does not count a subscription outside its effective month", () => {
    const metrics = buildMonthlyBillingMetrics(
      [new Date("2026-07-01T00:00:00.000Z"), new Date("2026-08-01T00:00:00.000Z")],
      [{ status: "ACTIVE", monthlyAmountMinor: 10000, currency: "mxn", startedAt: new Date("2026-08-15"), endsAt: null }],
      [],
    );

    expect(metrics[0].mrrByCurrency).toEqual({});
    expect(metrics[1].mrrByCurrency).toEqual({ MXN: 10000 });
  });

  it("uses the month-end subscription state for historical MRR", () => {
    const metrics = buildMonthlyBillingMetrics(
      [new Date("2026-07-01T00:00:00.000Z"), new Date("2026-08-01T00:00:00.000Z")],
      [{ status: "CANCELED", monthlyAmountMinor: 10000, currency: "MXN", startedAt: new Date("2026-07-01"), endsAt: new Date("2026-08-10") }],
      [],
    );

    expect(metrics[0].mrrByCurrency).toEqual({ MXN: 10000 });
    expect(metrics[1].mrrByCurrency).toEqual({});
  });

  it("normalizes and validates minor amounts", () => {
    expect(normalizeBillingCurrency(" mxn ")).toBe("MXN");
    expect(parseMinorAmount("2500")).toBe(2500);
    expect(formatMinorAmount(12345, "MXN")).toContain("123.45");
    expect(() => normalizeBillingCurrency("MX")).toThrow("POLICYDESK_BILLING_CURRENCY_INVALID");
    expect(() => parseMinorAmount("10.5")).toThrow("POLICYDESK_BILLING_AMOUNT_INVALID");
  });

  it("builds a bounded month window and exposes current totals", () => {
    const metrics = buildMonthlyBillingMetrics(lastMonths(6, new Date("2026-08-15T00:00:00.000Z")), [], []);
    expect(metrics).toHaveLength(6);
    expect(metrics[0].month).toBe("2026-03");
    expect(latestMetricTotals(metrics)).toMatchObject({ month: "2026-08", mrrByCurrency: {}, cashByCurrency: {} });
  });
});
