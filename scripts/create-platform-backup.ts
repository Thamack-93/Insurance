import "dotenv/config";

import { buildManualPlatformBackupTarget } from "../src/lib/backup.ts";
import { createAndCatalogBackup } from "../src/lib/backup-orchestrator.ts";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function assertDirectDatabaseUrl() {
  const value = required("DATABASE_ADMIN_URL");
  const url = new URL(value);
  if (/pooler/i.test(url.hostname) || url.searchParams.has("pgbouncer")) throw new Error("BACKUP_REQUIRES_DIRECT_DATABASE_URL");
}

async function main() {
  if (process.env.ALLOW_OPERATOR_BACKUP !== "1") throw new Error("ALLOW_OPERATOR_BACKUP=1 es obligatorio.");
  assertDirectDatabaseUrl();
  const now = new Date();
  const backup = await createAndCatalogBackup({ scope: "PLATFORM", target: buildManualPlatformBackupTarget(now) });
  console.log(JSON.stringify({ status: "PASS", scope: backup.scope, filename: backup.filename, pathname: backup.pathname, createdAt: backup.createdAt }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "PLATFORM_BACKUP_FAILED");
  process.exitCode = 1;
});
