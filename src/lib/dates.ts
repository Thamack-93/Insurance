import {
  addDays,
  differenceInCalendarDays,
  endOfDay,
  format,
  isBefore,
  startOfDay,
} from "date-fns";
import { es } from "date-fns/locale";

export type UrgencyLevel = "overdue" | "urgent" | "soon" | "upcoming" | "future";

export const DEFAULT_TIMEZONE = "America/Mexico_City";

export function today() {
  return startOfDay(new Date());
}

export function daysUntil(date: Date | string) {
  return differenceInCalendarDays(startOfDay(new Date(date)), today());
}

export function daysSince(date: Date | string) {
  return differenceInCalendarDays(today(), startOfDay(new Date(date)));
}

export function isOverdue(date: Date | string) {
  return isBefore(endOfDay(new Date(date)), today());
}

export function isWithinNextDays(date: Date | string, days: number) {
  const diff = daysUntil(date);
  return diff >= 0 && diff <= days;
}

export function getUrgencyLevel(date: Date | string): UrgencyLevel {
  const diff = daysUntil(date);

  if (diff < 0) return "overdue";
  if (diff <= 7) return "urgent";
  if (diff <= 15) return "soon";
  if (diff <= 60) return "upcoming";
  return "future";
}

export function nextDays(days: number) {
  return addDays(today(), days);
}

export function formatDate(date: Date | string, pattern = "d MMM yyyy") {
  return format(new Date(date), pattern, { locale: es });
}

