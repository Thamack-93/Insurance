import type { Settings } from "@/lib/settings";

export const THEME_COOKIE = "pg-theme";

type RuntimeSettings = {
  defaultCurrency: string;
  dateFormat: string;
  theme: string;
  autoBackup: boolean;
  backupFrequency: string;
  retentionDays: number;
};

const fallback: RuntimeSettings = {
  defaultCurrency: "MXN",
  dateFormat: "DD/MM/YYYY",
  theme: "light",
  autoBackup: false,
  backupFrequency: "weekly",
  retentionDays: 30,
};

let cache: RuntimeSettings = { ...fallback };

export function setRuntimeSettings(settings: Partial<Settings>) {
  cache = {
    defaultCurrency: settings.defaultCurrency ?? cache.defaultCurrency,
    dateFormat: settings.dateFormat ?? cache.dateFormat,
    theme: settings.theme ?? cache.theme,
    autoBackup: settings.autoBackup ?? cache.autoBackup,
    backupFrequency: settings.backupFrequency ?? cache.backupFrequency,
    retentionDays: settings.retentionDays ?? cache.retentionDays,
  };
}

export function getDefaultCurrency() {
  return cache.defaultCurrency;
}

export function getDateFormatPreference() {
  return cache.dateFormat;
}

export function getThemePreference() {
  return cache.theme;
}

export function getBackupConfig() {
  return {
    autoBackup: cache.autoBackup,
    backupFrequency: cache.backupFrequency,
    retentionDays: cache.retentionDays,
  };
}

const dateFnsPatternMap: Record<string, string> = {
  "DD/MM/YYYY": "dd/MM/yyyy",
  "MM/DD/YYYY": "MM/dd/yyyy",
  "YYYY-MM-DD": "yyyy-MM-dd",
};

export function resolveDateFnsPattern(preference: string = cache.dateFormat) {
  return dateFnsPatternMap[preference] ?? "dd/MM/yyyy";
}
