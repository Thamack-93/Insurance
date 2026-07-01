import { isValid } from "date-fns";
import {
  DEFAULT_TIMEZONE,
  businessToday,
  daysBetweenBusinessDates,
  formatBusinessDate,
  formatBusinessDateRelative,
  isBusinessDateOverdue,
  parseBusinessDateInput,
} from "@/lib/business-dates";

export type UrgencyLevel = "overdue" | "urgent" | "soon" | "upcoming" | "future";

export { DEFAULT_TIMEZONE };

export function today() {
  return businessToday();
}

export function parseSafeDate(date: Date | string) {
  if (typeof date === "string") {
    const trimmed = date.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return parseBusinessDateInput(trimmed);
    }
  }

  const parsed = new Date(date);
  return isValid(parsed) ? parsed : null;
}

export function daysUntil(date: Date | string) {
  const parsed = parseSafeDate(date);
  if (!parsed) return 0;
  return daysBetweenBusinessDates(parsed, today());
}

export function daysSince(date: Date | string) {
  const parsed = parseSafeDate(date);
  if (!parsed) return 0;
  return daysBetweenBusinessDates(today(), parsed);
}

export function isOverdue(date: Date | string) {
  const parsed = parseSafeDate(date);
  if (!parsed) return false;
  return isBusinessDateOverdue(parsed, today());
}

export function getUrgencyLevel(date: Date | string): UrgencyLevel {
  const diff = daysUntil(date);

  if (diff < 0) return "overdue";
  if (diff <= 7) return "urgent";
  if (diff <= 15) return "soon";
  if (diff <= 60) return "upcoming";
  return "future";
}

export function formatDate(date: Date | string, pattern?: string) {
  const parsed = parseSafeDate(date);
  if (!parsed) return "—";
  return formatBusinessDate(parsed, pattern);
}

export function formatRelativeDate(date: Date | string) {
  const parsed = parseSafeDate(date);
  if (!parsed) return "—";
  return formatBusinessDateRelative(parsed);
}
