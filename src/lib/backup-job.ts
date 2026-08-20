import { createDatabaseBackup, createOrganizationDatabaseBackup, listBackups, listOrganizationBackups } from "@/lib/backup";
import { getDb } from "@/lib/db";
import { upsertBackupArtifact } from "@/lib/backup-catalog";
import { getSettings } from "@/lib/settings";

const FREQUENCY_DAYS: Record<string, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
};

export type BackupJobResult =
  | { ok: true; skipped: "auto_backup_disabled" }
  | {
      ok: true;
      skipped: "interval_not_reached";
      ageDays: number;
      intervalDays: number;
    }
  | {
      ok: true;
      backup: string;
      size: number;
      tables: number;
      rows: number;
      pruned: string[];
      intervalDays: number;
      globalBackup?: string;
      organizations: Array<{ organizationId: string; backup?: string; skipped?: string; error?: string }>;
    };

export async function runBackupJob(
  options: { force?: boolean; now?: Date } = {},
): Promise<BackupJobResult> {
  const now = options.now ?? new Date();
  const settings = await getSettings();
  if (!settings.autoBackup && !options.force) {
    return { ok: true, skipped: "auto_backup_disabled" };
  }

  const intervalDays = FREQUENCY_DAYS[settings.backupFrequency] ?? 7;
  const [latest] = await listBackups();
  const globalAgeDays = latest ? (now.getTime() - latest.createdAt.getTime()) / 86_400_000 : Number.POSITIVE_INFINITY;
  let globalBackup: Awaited<ReturnType<typeof createDatabaseBackup>> | undefined;
  if (options.force || globalAgeDays >= 30) globalBackup = await createDatabaseBackup(now);

  const organizations = await getDb().organization.findMany({
    where: { status: "ACTIVE" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const organizationResults: Array<{ organizationId: string; backup?: string; skipped?: string; error?: string }> = [];
  for (const organization of organizations) {
    try {
      const [latestOrganizationBackup] = await listOrganizationBackups(organization.id);
      const ageDays = latestOrganizationBackup
        ? (now.getTime() - latestOrganizationBackup.createdAt.getTime()) / 86_400_000
        : Number.POSITIVE_INFINITY;
      if (!options.force && ageDays < intervalDays) {
        organizationResults.push({ organizationId: organization.id, skipped: "interval_not_reached" });
        continue;
      }
      const backup = await createOrganizationDatabaseBackup(organization.id, now);
      await upsertBackupArtifact({
        entry: backup,
        scope: "ORGANIZATION",
        organizationId: organization.id,
        status: "VERIFIED",
        capability: backup.manifest.capability,
        manifest: backup.manifest,
      });
      organizationResults.push({ organizationId: organization.id, backup: backup.filename });
    } catch (error) {
      organizationResults.push({ organizationId: organization.id, error: error instanceof Error ? error.message : "backup_failed" });
    }
  }
  if (!globalBackup && organizationResults.every((result) => result.skipped === "interval_not_reached")) {
    return { ok: true, skipped: "interval_not_reached", ageDays: globalAgeDays, intervalDays };
  }
  const backup = globalBackup;
  return {
    ok: true,
    backup: backup?.filename ?? organizationResults.find((result) => result.backup)?.backup ?? "",
    size: backup?.size ?? 0,
    tables: backup?.manifest.totals.tables ?? 0,
    rows: backup?.manifest.totals.rows ?? 0,
    pruned: backup?.pruned ?? [],
    intervalDays,
    globalBackup: backup?.filename,
    organizations: organizationResults,
  };
}
