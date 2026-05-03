import {
  differenceInCalendarDays,
  endOfDay,
  format,
  isBefore,
  startOfDay,
} from "date-fns";
import { es } from "date-fns/locale";
import { resolveDateFnsPattern } from "@/lib/settings-runtime";

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

export function getUrgencyLevel(date: Date | string): UrgencyLevel {
  const diff = daysUntil(date);

  if (diff < 0) return "overdue";
  if (diff <= 7) return "urgent";
  if (diff <= 15) return "soon";
  if (diff <= 60) return "upcoming";
  return "future";
}

export function formatDate(date: Date | string, pattern?: string) {
  const resolved = pattern ?? resolveDateFnsPattern();
  return format(new Date(date), resolved, { locale: es });
}

