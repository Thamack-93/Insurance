import { differenceInCalendarDays } from "date-fns";
import { DEFAULT_TIMEZONE } from "@/lib/dates";
import { getLocalDateKey } from "@/lib/notification-foundation-shared";

function toDate(value: Date | string) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const normalized = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const [year, month, day] = normalized.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day, 12));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function keyToCalendarDate(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function getCalendarDateKey(value: Date | string, timeZone = DEFAULT_TIMEZONE) {
  const parsed = toDate(value);
  if (!parsed) return null;
  return getLocalDateKey(parsed, timeZone);
}

export function formatCalendarDate(value: Date | string, timeZone = DEFAULT_TIMEZONE) {
  const key = getCalendarDateKey(value, timeZone);
  if (!key) return "—";

  const [year, month, day] = key.split("-");
  return `${day}/${month}/${year}`;
}

export function calendarDateInputValue(value: Date | string, timeZone = DEFAULT_TIMEZONE) {
  return getCalendarDateKey(value, timeZone) ?? "";
}

export function daysUntilCalendarDate(value: Date | string, reference: Date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const key = getCalendarDateKey(value, timeZone);
  const referenceKey = getCalendarDateKey(reference, timeZone);
  if (!key || !referenceKey) return 0;
  return differenceInCalendarDays(keyToCalendarDate(key), keyToCalendarDate(referenceKey));
}

export function isCalendarDateBeforeToday(value: Date | string, reference: Date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  return daysUntilCalendarDate(value, reference, timeZone) < 0;
}

export function isCalendarDateOnOrBeforeToday(value: Date | string, reference: Date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  return daysUntilCalendarDate(value, reference, timeZone) <= 0;
}
