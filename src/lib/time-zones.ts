import { BUSINESS_TIME_ZONE } from "@/lib/business-dates";

export const DEFAULT_USER_TIME_ZONE = BUSINESS_TIME_ZONE;

export const TIME_ZONE_OPTIONS = [
  { value: BUSINESS_TIME_ZONE, label: "GMT-6 fijo" },
] as const;

export type SupportedTimeZone = (typeof TIME_ZONE_OPTIONS)[number]["value"];

const TIME_ZONE_VALUES = new Set(TIME_ZONE_OPTIONS.map((option) => option.value));

export function isSupportedTimeZone(value: string) {
  if (TIME_ZONE_VALUES.has(value as SupportedTimeZone)) {
    return true;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}
