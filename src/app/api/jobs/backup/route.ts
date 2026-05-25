import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { backupDatabase } from "@/lib/backup";
import { backupsDir } from "@/lib/files";
import { getSettings } from "@/lib/settings";
import { areLocalBackupsEnabled } from "@/lib/deployment";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

const FREQUENCY_DAYS: Record<string, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
};

function isAuthorized(req: Request) {
  const secret = process.env.BACKUP_JOB_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

async function getMostRecentBackupAge(): Promise<number | null> {
  try {
    const entries = await fs.readdir(backupsDir);
    let newest = 0;
    for (const entry of entries) {
      const stat = await fs.stat(path.join(backupsDir, entry));
      if (stat.mtimeMs > newest) newest = stat.mtimeMs;
    }
    if (newest === 0) return null;
    return (Date.now() - newest) / (1000 * 60 * 60 * 24);
  } catch {
    return null;
  }
}

async function pruneOldBackups(retentionDays: number) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  try {
    const entries = await fs.readdir(backupsDir);
    for (const entry of entries) {
      const filePath = path.join(backupsDir, entry);
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs < cutoff) {
        await fs.unlink(filePath);
        removed += 1;
      }
    }
  } catch (error) {
    logError("backup.prune", error);
  }
  return removed;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!areLocalBackupsEnabled()) {
    return NextResponse.json(
      { ok: false, skipped: "backups_disabled_in_deployment" },
      { status: 501 },
    );
  }

  const settings = await getSettings();
  if (!settings.autoBackup) {
    return NextResponse.json({
      ok: true,
      skipped: "auto_backup_disabled",
    });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const intervalDays = FREQUENCY_DAYS[settings.backupFrequency] ?? 7;
  const ageDays = await getMostRecentBackupAge();

  if (!force && ageDays !== null && ageDays < intervalDays) {
    return NextResponse.json({
      ok: true,
      skipped: "interval_not_reached",
      ageDays,
      intervalDays,
    });
  }

  try {
    const target = await backupDatabase();
    const removed = await pruneOldBackups(settings.retentionDays);
    return NextResponse.json({
      ok: true,
      backup: target,
      pruned: removed,
      intervalDays,
      retentionDays: settings.retentionDays,
    });
  } catch (error) {
    logError("backup.job", error);
    return NextResponse.json({ ok: false, error: "Backup failed" }, { status: 500 });
  }
}
