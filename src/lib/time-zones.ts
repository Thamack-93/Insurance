export const DEFAULT_USER_TIME_ZONE = "America/Mexico_City";

export const TIME_ZONE_OPTIONS = [
  { value: "America/Mexico_City", label: "Ciudad de México" },
  { value: "America/Monterrey", label: "Monterrey" },
  { value: "America/Guatemala", label: "Guatemala" },
  { value: "America/Chicago", label: "Chicago" },
  { value: "America/New_York", label: "Nueva York" },
  { value: "America/Los_Angeles", label: "Los Ángeles" },
  { value: "UTC", label: "UTC" },
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
