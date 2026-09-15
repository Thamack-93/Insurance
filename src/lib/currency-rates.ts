import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { TenantDb } from "@/lib/organization-context";

export const MXN_CURRENCY = "MXN";

export type CurrencyRateRecord = {
  fromCurrency: string;
  toCurrency: string;
  effectiveDate: Date;
  rateToMxn: unknown;
};

export type MoneyValue = {
  originalAmount: string;
  originalCurrency: string;
  amountMxn: string | null;
  conversionRate: string | null;
  conversionDate: string | null;
  conversionStatus: "CONVERTED" | "NO_RATE" | "MXN";
};

export type MoneySummary = {
  totalMxn: string | null;
  byCurrency: Record<string, string>;
  missingCurrencies: string[];
};

export function normalizeCurrencyCode(value: string) {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("POLICYDESK_CURRENCY_INVALID");
  return currency;
}

function decimal(value: unknown) {
  if (value instanceof Prisma.Decimal) return value;
  if (value === null || value === undefined || value === "") return new Prisma.Decimal(0);
  return new Prisma.Decimal(String(value));
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function resolveRate(currency: string, asOf: Date, rates: readonly CurrencyRateRecord[]) {
  const normalized = normalizeCurrencyCode(currency);
  if (normalized === MXN_CURRENCY) return null;

  return rates
    .filter((rate) => rate.fromCurrency === normalized && rate.toCurrency === MXN_CURRENCY && rate.effectiveDate <= asOf)
    .sort((left, right) => right.effectiveDate.getTime() - left.effectiveDate.getTime())[0] ?? null;
}

export function convertMoneyValue(amount: unknown, currency: string, asOf: Date, rates: readonly CurrencyRateRecord[]): MoneyValue {
  const originalCurrency = normalizeCurrencyCode(currency);
  const original = decimal(amount);
  if (originalCurrency === MXN_CURRENCY) {
    return {
      originalAmount: original.toString(),
      originalCurrency,
      amountMxn: original.toFixed(2),
      conversionRate: "1",
      conversionDate: dateKey(asOf),
      conversionStatus: "MXN",
    };
  }

  const rate = resolveRate(originalCurrency, asOf, rates);
  if (!rate) {
    return {
      originalAmount: original.toString(),
      originalCurrency,
      amountMxn: null,
      conversionRate: null,
      conversionDate: null,
      conversionStatus: "NO_RATE",
    };
  }

  const rateDecimal = decimal(rate.rateToMxn);
  return {
    originalAmount: original.toString(),
    originalCurrency,
    amountMxn: original.mul(rateDecimal).toFixed(2),
    conversionRate: rateDecimal.toString(),
    conversionDate: dateKey(rate.effectiveDate),
    conversionStatus: "CONVERTED",
  };
}

export function summarizeMoney(values: readonly MoneyValue[]): MoneySummary {
  const byCurrency: Record<string, Prisma.Decimal> = {};
  let totalMxn = new Prisma.Decimal(0);
  let convertedRows = 0;
  const missing = new Set<string>();

  for (const value of values) {
    const currency = value.originalCurrency;
    byCurrency[currency] = (byCurrency[currency] ?? new Prisma.Decimal(0)).add(new Prisma.Decimal(value.originalAmount));
    if (value.amountMxn === null) {
      missing.add(currency);
      continue;
    }
    totalMxn = totalMxn.add(new Prisma.Decimal(value.amountMxn));
    convertedRows += 1;
  }

  return {
    totalMxn: convertedRows > 0 || values.length === 0 ? totalMxn.toFixed(2) : null,
    byCurrency: Object.fromEntries(Object.entries(byCurrency).map(([currency, amount]) => [currency, amount.toFixed(2)])),
    missingCurrencies: [...missing].sort(),
  };
}

export async function loadCurrencyRates(db: TenantDb, organizationId: string, through: Date) {
  return db.currencyRate.findMany({
    where: { organizationId, toCurrency: MXN_CURRENCY, effectiveDate: { lte: through } },
    select: { fromCurrency: true, toCurrency: true, effectiveDate: true, rateToMxn: true },
    orderBy: [{ fromCurrency: "asc" }, { effectiveDate: "asc" }],
  });
}
