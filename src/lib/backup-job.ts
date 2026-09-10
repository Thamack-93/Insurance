import {
  buildScheduledOrganizationBackupTarget,
  buildScheduledPlatformBackupTarget,
} from "@/lib/backup";
import { getLatestVerifiedBackupArtifact } from "@/lib/backup-catalog";
import { createAndCatalogBackup } from "@/lib/backup-orchestrator";
import {
  PLATFORM_BACKUP_INTERVAL_DAYS,
  TENANT_BACKUP_INTERVAL_DAYS,
  isPlatformBackupDue,
  isTenantBackupDue,
} from "@/lib/backup-schedule";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";

export { calendarDaysSince } from "@/lib/backup-schedule";
export const GLOBAL_BACKUP_INTERVAL_DAYS = PLATFORM_BACKUP_INTERVAL_DAYS;
export const isGlobalBackupDue = isPlatformBackupDue;

type BackupJobItem = {
  status: "created" | "skipped" | "failed";
  backup?: string;
  pathname?: string;
  reason?: "interval_not_reached" | "backup_failed" | "demo_excluded";
};

export type BackupJobResult = {
  ok: boolean;
  intervalDays: typeof TENANT_BACKUP_INTERVAL_DAYS;
  globalIntervalDays: typeof PLATFORM_BACKUP_INTERVAL_DAYS;
  global: BackupJobItem;
  organizations: Array<BackupJobItem & { organizationId: string }>;
  failures: number;
};

export async function runBackupJob(options: { force?: boolean; now?: Date } = {}): Promise<BackupJobResult> {
  const now = options.now ?? new Date();
  let failures = 0;
  let global: BackupJobItem;

  try {
    const latest = await getLatestVerifiedBackupArtifact({ scope: "PLATFORM" });
    if (!options.force && !isPlatformBackupDue(latest ? new Date(latest.createdAt) : null, now)) {
      global = { status: "skipped", reason: "interval_not_reached" };
    } else {
      const backup = await createAndCatalogBackup({
        scope: "PLATFORM",
        now,
        target: buildScheduledPlatformBackupTarget(now),
      });
      global = { status: "created", backup: backup.filename, pathname: backup.pathname };
    }
  } catch (error) {
    failures += 1;
    global = { status: "failed", reason: "backup_failed" };
    logError("backup-job.platform", error);
  }

  const organizations = await getDb().organization.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, kind: true },
    orderBy: { id: "asc" },
  });
  const organizationResults: Array<BackupJobItem & { organizationId: string }> = [];
  for (const organization of organizations) {
    if (organization.kind === "DEMO") {
      organizationResults.push({ organizationId: organization.id, status: "skipped", reason: "demo_excluded" });
      continue;
    }
    try {
      const latest = await getLatestVerifiedBackupArtifact({
        scope: "ORGANIZATION",
        organizationId: organization.id,
      });
      if (!options.force && !isTenantBackupDue(latest ? new Date(latest.createdAt) : null, now)) {
        organizationResults.push({ organizationId: organization.id, status: "skipped", reason: "interval_not_reached" });
        continue;
      }
      const backup = await createAndCatalogBackup({
        scope: "ORGANIZATION",
        organizationId: organization.id,
        now,
        target: buildScheduledOrganizationBackupTarget(organization.id, now),
      });
      organizationResults.push({ organizationId: organization.id, status: "created", backup: backup.filename, pathname: backup.pathname });
    } catch (error) {
      failures += 1;
      organizationResults.push({ organizationId: organization.id, status: "failed", reason: "backup_failed" });
      logError("backup-job.organization", error, { organizationId: organization.id });
    }
  }

  return {
    ok: failures === 0,
    intervalDays: TENANT_BACKUP_INTERVAL_DAYS,
    globalIntervalDays: PLATFORM_BACKUP_INTERVAL_DAYS,
    global,
    organizations: organizationResults,
    failures,
  };
}
