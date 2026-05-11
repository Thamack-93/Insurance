import fs from "node:fs/promises";
import path from "node:path";
import { backupsDir, databasePath } from "@/lib/files";

const MAX_BACKUPS = 10;

function timestampForFile(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("-");
}

export type BackupEntry = {
  filename: string;
  fullPath: string;
  size: number;
  createdAt: Date;
};

export async function backupDatabase(prefix = "pg") {
  await fs.mkdir(backupsDir, { recursive: true });

  try {
    await fs.access(databasePath);
  } catch {
    return null;
  }

  const target = path.join(backupsDir, `${prefix}-${timestampForFile()}.sqlite`);
  await fs.copyFile(databasePath, target);
  return target;
}

export async function listBackups(): Promise<BackupEntry[]> {
  try {
    await fs.mkdir(backupsDir, { recursive: true });
    const entries = await fs.readdir(backupsDir);
    const backups = await Promise.all(
      entries
        .filter((name) => name.endsWith(".sqlite"))
        .map(async (name) => {
          const fullPath = path.join(backupsDir, name);
          const stat = await fs.stat(fullPath);
          return {
            filename: name,
            fullPath,
            size: stat.size,
            createdAt: stat.mtime,
          } satisfies BackupEntry;
        }),
    );

    return backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  } catch {
    return [];
  }
}

export async function rotateBackups(max = MAX_BACKUPS) {
  const all = await listBackups();
  const excess = all.slice(max);
  await Promise.all(
    excess.map((entry) => fs.unlink(entry.fullPath).catch(() => undefined)),
  );
  return excess.map((entry) => entry.filename);
}

export async function restoreDatabaseFromFile(sourcePath: string) {
  await fs.access(sourcePath);
  await fs.mkdir(path.dirname(databasePath), { recursive: true });
  await fs.copyFile(sourcePath, databasePath);
}
