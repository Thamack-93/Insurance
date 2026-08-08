/**
 * Search helpers shared by the two table systems.
 *
 * The in-memory table used to match `String(cellValue)`, so a premium rendered
 * as `$12,500` or a date rendered as `05/03/2026` was unreachable: the raw
 * value was `12500` / an ISO timestamp. These helpers build the *displayed*
 * variants of a value and normalise both sides of the comparison so that what
 * the user types matches what the user sees.
 *
 * The same parsing powers the server-side lists: a query that reads as an
 * amount or as a date is turned into a numeric / date predicate instead of a
 * hopeless `contains` against a text column.
 */

import { getBusinessDateKey, parseBusinessDateInput } from "@/lib/business-dates";

const MONTHS_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Lowercase, accent-free, single-spaced text used for every text comparison. */
export function normalizeSearchText(value: string) {
  return stripDiacritics(value).toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Digits of a numeric-looking string, so `$12,500.00`, `12500` and `12 500`
 * all collapse to the same comparable token.
 */
export function digitsOnly(value: string) {
  return value.replace(/\D+/g, "");
}

/**
 * Reads an amount the way the user sees it: `$12,500.50`, `12,500`, `12500.5`.
 * Returns `null` when the text is not an amount, so callers can skip the
 * numeric branch entirely.
 */
export function parseSearchAmount(query: string): number | null {
  const cleaned = query.replace(/[$\s\u00a0]/g, "");
  if (!cleaned || !/^\d[\d,]*(\.\d+)?$/.test(cleaned)) return null;

  const numeric = Number(cleaned.replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

export type SearchDateRange = { from: Date; to: Date };

function dayRange(year: number, month: number, day: number): SearchDateRange | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const key = `${year.toString().padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const from = parseBusinessDateInput(key);
  if (Number.isNaN(from.getTime())) return null;
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
}

function monthRange(year: number, month: number): SearchDateRange | null {
  const start = dayRange(year, month, 1);
  if (!start) return null;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = dayRange(nextYear, nextMonth, 1);
  if (!end) return null;
  return { from: start.from, to: end.from };
}

/**
 * Reads a date the way the app renders it (`dd/MM/yyyy`), plus the ISO form and
 * the coarser `MM/yyyy` and `marzo 2026` shapes people type when they are
 * scanning a month.
 */
export function parseSearchDate(query: string): SearchDateRange | null {
  const value = normalizeSearchText(query);

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (iso) return dayRange(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  if (dmy) return dayRange(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));

  const my = /^(\d{1,2})[/.-](\d{4})$/.exec(value);
  if (my) return monthRange(Number(my[2]), Number(my[1]));

  const isoMonth = /^(\d{4})-(\d{1,2})$/.exec(value);
  if (isoMonth) return monthRange(Number(isoMonth[1]), Number(isoMonth[2]));

  const named = /^([a-z]+)\s+(\d{4})$/.exec(value);
  if (named) {
    const monthIndex = MONTHS_ES.indexOf(named[1]);
    if (monthIndex >= 0) return monthRange(Number(named[2]), monthIndex + 1);
  }

  return null;
}

export type ParsedSearchQuery = {
  /** Raw text as typed, trimmed. */
  raw: string;
  /** Normalised text used for `includes` comparisons. */
  text: string;
  /** Digits of the query when it looks numeric, for loose number matching. */
  digits: string;
  amount: number | null;
  date: SearchDateRange | null;
};

export function parseSearchQuery(query: string): ParsedSearchQuery {
  const raw = query.trim();
  const text = normalizeSearchText(raw);

  return {
    raw,
    text,
    digits: /^[\d\s$,.]+$/.test(raw) ? digitsOnly(raw) : "",
    amount: parseSearchAmount(raw),
    date: parseSearchDate(raw),
  };
}

/** Bounds that match any stored amount that *renders* as the searched amount. */
export function amountMatchWindow(amount: number) {
  return { gte: amount - 0.5, lt: amount + 0.5 };
}

function formatNumberVariants(value: number) {
  const variants = [String(value)];

  try {
    variants.push(new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(value));
    variants.push(new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value));
  } catch {
    // Locale data is always present in our runtimes; the raw form is enough otherwise.
  }

  return variants;
}

function formatDateVariants(value: Date) {
  const key = getBusinessDateKey(value);
  const [year, month, day] = key.split("-");
  const monthName = MONTHS_ES[Number(month) - 1] ?? "";

  return [key, `${day}/${month}/${year}`, `${day}/${month}`, `${monthName} ${year}`];
}

/**
 * Every textual shape a raw cell value can take on screen. Column definitions
 * can bypass this with their own `searchText`, which is always preferred.
 */
export function valueSearchVariants(value: unknown): string[] {
  if (value === null || value === undefined || value === "") return [];

  if (value instanceof Date) return formatDateVariants(value);

  if (typeof value === "number") return formatNumberVariants(value);

  if (typeof value === "boolean") return [value ? "si" : "no", String(value)];

  if (typeof value === "object") {
    // Prisma Decimal and friends expose a numeric conversion.
    if ("toNumber" in value && typeof (value as { toNumber: unknown }).toNumber === "function") {
      return formatNumberVariants((value as { toNumber: () => number }).toNumber());
    }
    return [];
  }

  const text = String(value);
  const isoLike = /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(text);
  if (isoLike) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return [text, ...formatDateVariants(parsed)];
  }

  return [text];
}

/** True when any of the displayed variants contains what the user typed. */
export function variantsMatchQuery(variants: readonly string[], parsed: ParsedSearchQuery) {
  if (!parsed.text) return true;

  for (const variant of variants) {
    if (!variant) continue;
    const normalized = normalizeSearchText(variant);
    if (normalized.includes(parsed.text)) return true;

    if (parsed.digits) {
      const variantDigits = digitsOnly(normalized);
      if (variantDigits && variantDigits.includes(parsed.digits)) return true;
    }
  }

  return false;
}
