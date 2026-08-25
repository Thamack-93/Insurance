export const TENANT_BACKUP_INTERVAL_DAYS = 1;
export const PLATFORM_BACKUP_INTERVAL_DAYS = 7;
export const BACKUP_CRON_UTC_HOUR = 5;

const MILLISECONDS_PER_DAY = 86_400_000;

function utcDayNumber(value: Date) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()) / MILLISECONDS_PER_DAY;
}

export function calendarDaysSince(createdAt: Date, now: Date) {
  return utcDayNumber(now) - utcDayNumber(createdAt);
}

export function getBackupScheduleStatus(
  latestVerifiedAt: Date | null | undefined,
  now: Date,
  intervalDays: number,
) {
  if (!latestVerifiedAt) {
    return { due: true, nextDueAt: now, status: "MISSING" as const, ageDays: null };
  }
  const nextDueAt = new Date(Date.UTC(
    latestVerifiedAt.getUTCFullYear(),
    latestVerifiedAt.getUTCMonth(),
    latestVerifiedAt.getUTCDate() + intervalDays,
    BACKUP_CRON_UTC_HOUR,
  ));
  const ageDays = calendarDaysSince(latestVerifiedAt, now);
  const due = ageDays >= intervalDays && now.getTime() >= nextDueAt.getTime();
  return {
    due,
    nextDueAt,
    status: due ? "DUE" as const : "HEALTHY" as const,
    ageDays,
  };
}

export function isTenantBackupDue(latestVerifiedAt: Date | null | undefined, now: Date) {
  return getBackupScheduleStatus(latestVerifiedAt, now, TENANT_BACKUP_INTERVAL_DAYS).due;
}

export function isPlatformBackupDue(latestVerifiedAt: Date | null | undefined, now: Date) {
  return getBackupScheduleStatus(latestVerifiedAt, now, PLATFORM_BACKUP_INTERVAL_DAYS).due;
}
