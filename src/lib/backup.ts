import fs from "node:fs/promises";
import path from "node:path";
import { backupsDir, databasePath } from "@/lib/files";

function timestamp(date = new Date()) {
  return date
    .toISOString()
    .replace("T", "-")
    .slice(0, 16)
    .replace(/:/g, "-");
}

export async function backupDatabase() {
  await fs.mkdir(backupsDir, { recursive: true });

  try {
    await fs.access(databasePath);
  } catch {
    return null;
  }

  const target = path.join(backupsDir, `policydesk-${timestamp()}.sqlite`);
  await fs.copyFile(databasePath, target);
  return target;
}

