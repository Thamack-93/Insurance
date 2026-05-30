import { getDefaultCurrency } from "@/lib/settings-runtime";

export const DEFAULT_CURRENCY = "MXN";

export function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return 0;
}

export function formatCurrency(amount: unknown, currency?: string) {
  const resolvedCurrency = (currency ?? getDefaultCurrency() ?? DEFAULT_CURRENCY)
    .toString()
    .trim()
    .toUpperCase();

  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: resolvedCurrency,
      maximumFractionDigits: 0,
    }).format(toNumber(amount));
  } catch {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: DEFAULT_CURRENCY,
      maximumFractionDigits: 0,
    }).format(toNumber(amount));
  }
}
