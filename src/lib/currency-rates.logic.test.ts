import { describe, expect, it } from "vitest";
import { convertMoneyValue, summarizeMoney, type CurrencyRateRecord } from "@/lib/currency-rates";

const rates: CurrencyRateRecord[] = [
  { fromCurrency: "USD", toCurrency: "MXN", effectiveDate: new Date("2026-01-01T00:00:00.000Z"), rateToMxn: "20.00" },
  { fromCurrency: "USD", toCurrency: "MXN", effectiveDate: new Date("2026-06-01T00:00:00.000Z"), rateToMxn: "19.50" },
];

describe("currency rates", () => {
  it("uses the latest rate effective on the transaction date", () => {
    expect(convertMoneyValue("100.25", "USD", new Date("2026-07-01T00:00:00.000Z"), rates)).toMatchObject({
      originalAmount: "100.25",
      originalCurrency: "USD",
      amountMxn: "1954.88",
      conversionRate: "19.5",
      conversionDate: "2026-06-01",
      conversionStatus: "CONVERTED",
    });
  });

  it("keeps the original amount when no historical rate exists", () => {
    expect(convertMoneyValue(100, "EUR", new Date("2026-07-01T00:00:00.000Z"), rates)).toMatchObject({
      originalAmount: "100",
      originalCurrency: "EUR",
      amountMxn: null,
      conversionStatus: "NO_RATE",
    });
  });

  it("summarizes original currencies and only converted rows in MXN", () => {
    const values = [
      convertMoneyValue(100, "MXN", new Date("2026-07-01T00:00:00.000Z"), rates),
      convertMoneyValue(10, "USD", new Date("2026-07-01T00:00:00.000Z"), rates),
      convertMoneyValue(5, "EUR", new Date("2026-07-01T00:00:00.000Z"), rates),
    ];
    expect(summarizeMoney(values)).toEqual({
      totalMxn: "295.00",
      byCurrency: { EUR: "5.00", MXN: "100.00", USD: "10.00" },
      missingCurrencies: ["EUR"],
    });
  });
});
