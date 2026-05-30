import {
  differenceInCalendarDays,
  endOfDay,
  format,
  isBefore,
  isValid,
  formatDistanceToNow,
  startOfDay,
} from "date-fns";
import { es } from "date-fns/locale";
import { resolveDateFnsPattern } from "@/lib/settings-runtime";

export type UrgencyLevel = "overdue" | "urgent" | "soon" | "upcoming" | "future";

export const DEFAULT_TIMEZONE = "America/Mexico_City";

export function today() {
  return startOfDay(new Date());
}

export function parseSafeDate(date: Date | string) {
  const parsed = new Date(date);
  return isValid(parsed) ? parsed : null;
}

export function daysUntil(date: Date | string) {
  const parsed = parseSafeDate(date);
  if (!parsed) return 0;
  return differenceInCalendarDays(startOfDay(parsed), today());
}

export function daysSince(date: Date | string) {
  const parsed = parseSafeDate(date);
  if (!parsed) return 0;
  return differenceInCalendarDays(today(), startOfDay(parsed));
}

export function isOverdue(date: Date | string) {
  const parsed = parseSafeDate(date);
  if (!parsed) return false;
  return isBefore(endOfDay(parsed), today());
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
  const resolved = pattern ?? resolveDateFnsPattern();
  return format(parsed, resolved, { locale: es });
}

export function formatRelativeDate(date: Date | string) {
  const parsed = parseSafeDate(date);
  if (!parsed) return "—";
  return formatDistanceToNow(parsed, { locale: es, addSuffix: true });
}
