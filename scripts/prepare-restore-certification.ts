import "dotenv/config";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { Pool } from "pg";
import { execFileSync } from "node:child_process";
import { assertDisposableCertificationTarget, assertPersistedRestoreMarker, assertResumableRestoreMigrationHistory, certificationFingerprint } from "./tenant-certification-target.mjs";
import { readSafeSingletonMigrationChecksums } from "./restore-certification-migrations.mjs";

const execFileAsync = promisify(execFile);

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

async function assertEmptyOrResumableTarget(targetUrl: string, target: ReturnType<typeof assertDisposableCertificationTarget>) {
  const pool = new Pool({ connectionString: targetUrl, max: 1, application_name: "policydesk-restore-certification-preflight" });
  try {
    const tables = await pool.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`);
    const marker = tables.rows.some(({ table_name }) => table_name === "__policydesk_tenant_isolation_run");
    if (!marker) {
      if (tables.rows.length) throw new Error("RESTORE_CERTIFICATION_TARGET_NOT_EMPTY");
      return;
    }
    const rows = await pool.query<{ run_id: string; database_name: string; host: string; fingerprint: string }>('SELECT run_id, database_name, host, fingerprint FROM "__policydesk_tenant_isolation_run"');
    try { assertPersistedRestoreMarker(rows.rows, target); } catch { throw new Error("RESTORE_CERTIFICATION_MARKER_CONFLICT"); }
    const tableNames = new Set(tables.rows.map(({ table_name }) => table_name));
    const migrationHistory = tableNames.has("_prisma_migrations")
      ? await pool.query<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>(
        'SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name')
      : { rows: [] as Array<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }> };
    const allowedMigrations = await readSafeSingletonMigrationChecksums(path.join(process.cwd(), "prisma", "migrations"));
    assertResumableRestoreMigrationHistory(migrationHistory.rows, allowedMigrations);
    for (const { table_name } of tables.rows) {
      if (["__policydesk_tenant_isolation_run", "_prisma_migrations"].includes(table_name)) continue;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table_name)) throw new Error("RESTORE_CERTIFICATION_TARGET_CONTENT_UNRECOGNIZED");
      const count = await pool.query(`SELECT count(*)::text AS count FROM public."${table_name}"`);
      if (Number(count.rows[0]?.count) !== 0) throw new Error("RESTORE_CERTIFICATION_TARGET_CONTENT_NOT_RESUMABLE");
    }
  } finally { await pool.end(); }
}

async function main() {
  if (!process.argv.includes("--prepare-restore-target")) throw new Error("RESTORE_TARGET_PREPARATION_REQUIRES_EXPLICIT_FLAG");
  if (process.env.ALLOW_TEMPORARY_NEON_RESTORE !== "true") throw new Error("ALLOW_TEMPORARY_NEON_RESTORE_REQUIRED");
  if (process.env.NODE_ENV !== "test" || process.env.TENANT_ISOLATION_TEST_DB !== "1" || process.env.PLAYWRIGHT_ENFORCE_DISPOSABLE_DB !== "1" || process.env.VERCEL === "1" || process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview") {
    throw new Error("RESTORE_TARGET_PREPARATION_REQUIRES_DISPOSABLE_LOCAL_OPERATOR_CONTEXT");
  }
  const sha = required("CERTIFICATION_CANDIDATE_SHA");
  if (!/^[0-9a-f]{40}$/.test(sha) || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== sha) throw new Error("RESTORE_CANDIDATE_SHA_MISMATCH");

  const sourceUrl = required("RESTORE_SOURCE_DATABASE_URL");
  const sourceHost = required("RESTORE_SOURCE_NEON_HOST");
  const sourceName = required("RESTORE_SOURCE_NEON_BRANCH");
  const sourceId = required("RESTORE_SOURCE_NEON_BRANCH_ID");
  const sourceFingerprint = required("RESTORE_SOURCE_FINGERPRINT");
  const sourceEnv = {
    ...process.env,
    TENANT_CERTIFICATION_PURPOSE: "source",
    TENANT_ISOLATION_BRANCH_NAME: sourceName,
    TENANT_ISOLATION_BRANCH_ID: sourceId,
    TENANT_ISOLATION_NEON_HOST: sourceHost,
    TENANT_ISOLATION_FINGERPRINT: sourceFingerprint,
  };
  const source = assertDisposableCertificationTarget(sourceUrl, sourceEnv, "source");
  if (source.branchName !== `cert-stage3-${sha}`) throw new Error("RESTORE_SOURCE_BRANCH_SHA_MISMATCH");
  const sourcePool = new Pool({ connectionString: sourceUrl, max: 1, application_name: "policydesk-restore-source-marker-check" });
  try {
    const markers = await sourcePool.query<{ run_id: string; database_name: string; host: string; fingerprint: string }>(
      'SELECT run_id, database_name, host, fingerprint FROM "__policydesk_tenant_isolation_run"');
    if (markers.rowCount !== 1 || markers.rows[0].run_id !== source.runId || markers.rows[0].database_name !== source.database || markers.rows[0].host !== source.host || markers.rows[0].fingerprint !== source.fingerprint) throw new Error("RESTORE_SOURCE_MARKER_MISMATCH");
  } finally { await sourcePool.end(); }

  const targetUrl = required("RESTORE_DATABASE_ADMIN_URL");
  const targetConnection = new URL(targetUrl);
  if (/-pooler\./i.test(targetConnection.hostname) || targetConnection.searchParams.has("pgbouncer")) throw new Error("RESTORE_PREPARATION_REQUIRES_DIRECT_ADMIN_URL");
  const targetName = required("RESTORE_NEON_BRANCH");
  const targetId = required("RESTORE_NEON_BRANCH_ID");
  const targetHost = required("RESTORE_NEON_HOST");
  const runId = required("TENANT_ISOLATION_RUN_ID");
  const database = required("TENANT_ISOLATION_DB_NAME");
  const targetFingerprint = certificationFingerprint({ mode: "neon", runId, database, host: targetHost, branchId: targetId, branchName: targetName });
  if (process.env.RESTORE_TARGET_FINGERPRINT !== targetFingerprint) throw new Error("RESTORE_TARGET_FINGERPRINT_MISMATCH");
  const targetEnv = {
    ...process.env,
    TENANT_CERTIFICATION_PURPOSE: "restore",
    TENANT_ISOLATION_REMOTE_BRANCH: "1",
    TENANT_ISOLATION_BRANCH_NAME: targetName,
    TENANT_ISOLATION_BRANCH_ID: targetId,
    TENANT_ISOLATION_NEON_HOST: targetHost,
    TENANT_ISOLATION_FINGERPRINT: targetFingerprint,
  };
  const target = assertDisposableCertificationTarget(targetUrl, targetEnv, "restore");
  if (target.branchId === source.branchId || target.host === source.host) throw new Error("RESTORE_TARGET_EQUALS_SOURCE");
  await assertEmptyOrResumableTarget(targetUrl, target);

  const env = {
    ...targetEnv,
    DATABASE_ADMIN_URL: targetUrl,
    DATABASE_URL: targetUrl,
    TENANT_CERTIFICATION_PURPOSE: "restore",
  };
  const { stdout, stderr } = await execFileAsync("npm", ["run", "certify:tenant-rls"], { cwd: process.cwd(), env, maxBuffer: 8 * 1024 * 1024 });
  if (stdout.trim()) process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
  console.log(JSON.stringify({ ok: true, purpose: "restore", branchName: target.branchName, branchId: target.branchId, fingerprint: target.fingerprint, organizationId: "org_pedro_gomez_0001", preparedAt: new Date().toISOString() }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "RESTORE_TARGET_PREPARATION_FAILED");
  process.exitCode = 1;
});
