import { createDatabaseBackup, listBackups } from "@/lib/backup";
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
  if (!options.force && latest) {
    const ageDays = (now.getTime() - latest.createdAt.getTime()) / 86_400_000;
    if (ageDays < intervalDays) {
      return { ok: true, skipped: "interval_not_reached", ageDays, intervalDays };
    }
  }

  const backup = await createDatabaseBackup(now);
  return {
    ok: true,
    backup: backup.filename,
    size: backup.size,
    tables: backup.manifest.totals.tables,
    rows: backup.manifest.totals.rows,
    pruned: backup.pruned,
    intervalDays,
  };
}
