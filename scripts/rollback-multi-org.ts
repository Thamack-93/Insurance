import "dotenv/config";

import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Pool } from "pg";
import { assertTemporaryNeonRestoreTarget } from "../src/lib/backup-restore-guards.ts";

const execFileAsync = promisify(execFile);
const ROLLBACK_COMPENSATION_VERSION = "restore-drill-v1";

/**
 * Multi-org recovery is deliberately restore-only. The old implementation
 * attempted to rebuild singleton indexes, triggers and RLS policies with
 * ad-hoc DDL, which could leave a partially downgraded database.
 */
async function main() {
  if (process.env.ENABLE_TENANT_RLS_ROLLBACK !== "1") {
    throw new Error("ENABLE_TENANT_RLS_ROLLBACK=1 es obligatorio.");
  }
  if (process.env.TENANT_RLS_ROLLBACK_VERSION?.trim() !== ROLLBACK_COMPENSATION_VERSION) {
    throw new Error(`TENANT_RLS_ROLLBACK_VERSION=${ROLLBACK_COMPENSATION_VERSION} es obligatorio.`);
  }
  const adminUrl = process.env.DATABASE_ADMIN_URL?.trim();
  if (!adminUrl) throw new Error("DATABASE_ADMIN_URL es obligatorio.");
  const admin = new Pool({ connectionString: adminUrl, max: 1, application_name: "policydesk-versioned-recovery" });
  try {
    const state = await admin.query<{ writeMode: string }>('SELECT "writeMode" FROM "PlatformRuntimeState" WHERE "id" = 1');
    if (state.rows[0]?.writeMode !== "MAINTENANCE") throw new Error("POLICYDESK_ROLLBACK_REQUIRES_MAINTENANCE");
  } finally {
    await admin.end();
  }

  const backupFile = process.env.ROLLBACK_BACKUP_FILE?.trim() || process.env.RESTORE_BACKUP_FILE?.trim();
  if (!backupFile) throw new Error("ROLLBACK_BACKUP_FILE es obligatorio.");
  await access(backupFile);

  const target = assertTemporaryNeonRestoreTarget({
    sourceDatabaseUrl: process.env.DATABASE_URL,
    targetDatabaseUrl: process.env.RESTORE_DATABASE_URL,
    branchName: process.env.RESTORE_NEON_BRANCH,
    allowRestore: process.env.ALLOW_TEMPORARY_NEON_RESTORE,
    forbiddenDatabaseUrls: [
      process.env.DIRECT_URL,
      process.env.DATABASE_URL_DIRECT,
      process.env.DATABASE_URL_POOLER,
      process.env.POOLER_URL,
      process.env.PRISMA_DIRECT_URL,
    ],
  });

  const result = await execFileAsync("npm", ["run", "restore:backup:temp-neon", "--", backupFile], {
    env: {
      ...process.env,
      RESTORE_DATABASE_URL: target.target.toString(),
      RESTORE_NEON_BRANCH: target.branchName,
      ALLOW_TEMPORARY_NEON_RESTORE: "true",
    },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.stdout.trim()) console.log(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());
  console.log(`Versioned recovery PASS (${ROLLBACK_COMPENSATION_VERSION}) en ${target.branchName}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "POLICYDESK_MULTI_ORG_RECOVERY_FAILED");
  process.exitCode = 1;
});
