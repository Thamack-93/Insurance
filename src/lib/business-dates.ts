import { resolveDateFnsPattern } from "@/lib/settings-runtime";

export const BUSINESS_TIME_ZONE = "Etc/GMT+6";
export const DEFAULT_TIMEZONE = BUSINESS_TIME_ZONE;

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const MONTH_NAMES_ES = [
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
] as const;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function parseParts(date: Date, timeZone = BUSINESS_TIME_ZONE): DateParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const year = Number(parts.find((part) => part.type === "year")?.value ?? 1970);
  const month = Number(parts.find((part) => part.type === "month")?.value ?? 1);
  const day = Number(parts.find((part) => part.type === "day")?.value ?? 1);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const second = Number(parts.find((part) => part.type === "second")?.value ?? 0);

  return { year, month, day, hour, minute, second };
}

function dateKeyFromParts(parts: Pick<DateParts, "year" | "month" | "day">) {
  return [String(parts.year).padStart(4, "0"), pad(parts.month), pad(parts.day)].join("-");
}

function businessStartOfDayFromParts(parts: Pick<DateParts, "year" | "month" | "day">) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 6, 0, 0, 0));
}

function parseBusinessDateKey(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return new Date(NaN);
  }

  const [, year, month, day] = match;
  return businessStartOfDayFromParts({
    year: Number(year),
    month: Number(month),
    day: Number(day),
  });
}

function normalizeDateInput(value: Date | string) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return parseBusinessDateKey(trimmed);
    }
  }

  return new Date(value);
}

function formatBusinessDateTimeParts(parts: DateParts) {
  return `${parts.day} de ${MONTH_NAMES_ES[parts.month - 1] ?? MONTH_NAMES_ES[0]} ${parts.year}, ${pad(parts.hour)}:${pad(parts.minute)}`;
}

function formatKnownPattern(parts: DateParts, pattern: string) {
  switch (pattern) {
    case "dd/MM/yyyy":
      return `${pad(parts.day)}/${pad(parts.month)}/${parts.year}`;
    case "MM/dd/yyyy":
      return `${pad(parts.month)}/${pad(parts.day)}/${parts.year}`;
    case "yyyy-MM-dd":
      return dateKeyFromParts(parts);
    case "d 'de' MMMM yyyy, HH:mm":
      return formatBusinessDateTimeParts(parts);
    default:
      return `${pad(parts.day)}/${pad(parts.month)}/${parts.year}`;
  }
}

export function getBusinessDateParts(date: Date | string, timeZone = BUSINESS_TIME_ZONE) {
  return parseParts(normalizeDateInput(date), timeZone);
}

export function getBusinessDateKey(date: Date | string, timeZone = BUSINESS_TIME_ZONE) {
  return dateKeyFromParts(getBusinessDateParts(date, timeZone));
}

export function parseBusinessDateInput(value: string) {
  return parseBusinessDateKey(value);
}

export function formatBusinessDateInput(value: Date | string | null | undefined) {
  if (!value) return "";
  return getBusinessDateKey(value);
}

export function businessToday(now = new Date()) {
  return parseBusinessDateKey(getBusinessDateKey(now));
}

export function businessStartOfDay(date: Date | string) {
  return parseBusinessDateKey(getBusinessDateKey(date));
}

export function businessStartOfMonth(date: Date | string) {
  const parts = getBusinessDateParts(date);
  return businessStartOfDayFromParts({
    year: parts.year,
    month: parts.month,
    day: 1,
  });
}

export function businessEndOfMonth(date: Date | string) {
  const parts = getBusinessDateParts(date);
  const nextMonth =
    parts.month === 12
      ? { year: parts.year + 1, month: 1 }
      : { year: parts.year, month: parts.month + 1 };
  return new Date(
    businessStartOfDayFromParts({
      year: nextMonth.year,
      month: nextMonth.month,
      day: 1,
    }).getTime() - 1,
  );
}

export function businessEndOfDay(date: Date | string) {
  return new Date(businessStartOfDay(date).getTime() + 24 * 60 * 60 * 1000 - 1);
}

export function businessAddDays(date: Date | string, days: number) {
  return new Date(businessStartOfDay(date).getTime() + days * 24 * 60 * 60 * 1000);
}

export function daysBetweenBusinessDates(left: Date | string, right: Date | string) {
  const leftKey = getBusinessDateKey(left);
  const rightKey = getBusinessDateKey(right);
  return Math.round((parseBusinessDateKey(leftKey).getTime() - parseBusinessDateKey(rightKey).getTime()) / (24 * 60 * 60 * 1000));
}

export function isBusinessDateOverdue(date: Date | string, now = new Date()) {
  return daysBetweenBusinessDates(date, now) < 0;
}

export function formatBusinessDate(date: Date | string, pattern?: string) {
  const parts = getBusinessDateParts(date);
  return formatKnownPattern(parts, pattern ?? resolveDateFnsPattern());
}

export function formatBusinessDateRelative(date: Date | string, now = new Date()) {
  const target = businessStartOfDay(date);
  const base = businessStartOfDay(now);
  const diff = Math.round((target.getTime() - base.getTime()) / (24 * 60 * 60 * 1000));

  if (diff === 0) return "hoy";
  if (diff === 1) return "mañana";
  if (diff === -1) return "ayer";
  return diff > 0 ? `en ${diff} días` : `hace ${Math.abs(diff)} días`;
}
