import "dotenv/config";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Pool } from "pg";
import { assertDisposableCertificationTarget, certificationPurpose } from "./tenant-certification-target.mjs";

const execFileAsync = promisify(execFile);

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function runNpm(script: string, env: NodeJS.ProcessEnv) {
  return execFileAsync("npm", ["run", script], {
    cwd: process.cwd(),
    env,
    maxBuffer: 8 * 1024 * 1024,
  }).then(({ stdout, stderr }) => {
    if (stdout.trim()) process.stdout.write(stdout);
    if (stderr.trim()) process.stderr.write(stderr);
  });
}

type CertificationTarget = ReturnType<typeof assertDisposableCertificationTarget>;

function pooledNeonHost(hostname: string) {
  const labels = hostname.split(".");
  if (!labels[0]?.endsWith("-pooler")) labels[0] = `${labels[0]}-pooler`;
  return labels.join(".");
}

async function ensureCertificationMarker(adminUrl: string, target: CertificationTarget) {
  const pool = new Pool({ connectionString: adminUrl, max: 1, application_name: "policydesk-tenant-certification-marker" });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "__policydesk_tenant_isolation_run" (
        run_id text PRIMARY KEY,
        database_name text NOT NULL,
        host text NOT NULL,
        fingerprint text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    if (process.env.TENANT_CERTIFICATION_PURPOSE === "restore") {
      const existing = await pool.query<{ run_id: string; database_name: string; host: string; fingerprint: string }>('SELECT run_id, database_name, host, fingerprint FROM "__policydesk_tenant_isolation_run"');
      if (existing.rows.length > 1 || existing.rows.some((row) => row.run_id !== target.runId || row.database_name !== target.database || row.host !== target.host || row.fingerprint !== target.fingerprint)) {
        throw new Error("RESTORE_CERTIFICATION_MARKER_CONFLICT");
      }
      if (!existing.rows.length) await pool.query(
        'INSERT INTO "__policydesk_tenant_isolation_run" (run_id, database_name, host, fingerprint) VALUES ($1, $2, $3, $4)',
        [target.runId, target.database, target.host, target.fingerprint],
      );
    } else {
      await pool.query('DELETE FROM "__policydesk_tenant_isolation_run"');
      await pool.query(
        'INSERT INTO "__policydesk_tenant_isolation_run" (run_id, database_name, host, fingerprint) VALUES ($1, $2, $3, $4)',
        [target.runId, target.database, target.host, target.fingerprint],
      );
    }
  } finally {
    await pool.end();
  }
}

async function provisionRuntimeCredential(adminUrl: string, env: NodeJS.ProcessEnv, targetInfo: CertificationTarget) {
  if (env.TENANT_RLS_RUNTIME_DATABASE_URL?.trim()) return env;
  const password = required("TENANT_RLS_APP_PASSWORD");
  const appRole = required("TENANT_RLS_APP_ROLE");
  const target = new URL(adminUrl);
  const pool = new Pool({ connectionString: adminUrl, max: 1, application_name: "policydesk-tenant-rls-certification-role" });
  try {
    // This is credential provisioning only. Schema changes remain exclusively
    // in the committed Prisma migration executed by cutover:multi-org.
    const roleIdentifier = appRole.replaceAll('"', '""');
    const passwordLiteral = password.replaceAll("'", "''");
    await pool.query(`ALTER ROLE "${roleIdentifier}" PASSWORD '${passwordLiteral}'`);
  } finally {
    await pool.end();
  }
  const runtime = new URL(adminUrl);
  runtime.username = appRole;
  runtime.password = password;
  runtime.hostname = targetInfo.mode === "neon" ? pooledNeonHost(target.hostname) : target.hostname;
  env.TENANT_RLS_RUNTIME_DATABASE_URL = runtime.toString();
  env.DATABASE_URL = runtime.toString();
  env.DATABASE_URL_UNPOOLED = runtime.toString();
  return env;
}

async function provisionReadOnlyCredential(adminUrl: string, env: NodeJS.ProcessEnv) {
  const password = required("TENANT_RLS_READONLY_PASSWORD");
  const readOnlyRole = env.PRODUCTION_READONLY_ROLE?.trim() || "policydesk_readonly";
  if (readOnlyRole !== "policydesk_readonly") throw new Error("TENANT_READONLY_ROLE_MUST_BE_CANONICAL");
  const pool = new Pool({ connectionString: adminUrl, max: 1, application_name: "policydesk-tenant-certification-readonly-role" });
  try {
    const roleIdentifier = readOnlyRole.replaceAll('"', '""');
    const passwordLiteral = password.replaceAll("'", "''");
    await pool.query(`ALTER ROLE "${roleIdentifier}" PASSWORD '${passwordLiteral}'`);
  } finally {
    await pool.end();
  }
  const readOnly = new URL(adminUrl);
  readOnly.username = readOnlyRole;
  readOnly.password = password;
  env.PRODUCTION_READONLY_DATABASE_URL = readOnly.toString();
  env.PRODUCTION_READONLY_ROLE = readOnlyRole;
  return env;
}

async function main() {
  const env = { ...process.env };
  if (env.NODE_ENV !== "test" || env.TENANT_ISOLATION_TEST_DB !== "1" || env.PLAYWRIGHT_ENFORCE_DISPOSABLE_DB !== "1") {
    throw new Error("TENANT_RLS_CERTIFICATION_REQUIRES_DISPOSABLE_TEST_DB");
  }
  const adminUrl = required("DATABASE_ADMIN_URL");
  const target = assertDisposableCertificationTarget(adminUrl, env, certificationPurpose(env));
  required("TENANT_RLS_APP_ROLE");
  required("TENANT_RLS_ORG_A");
  required("TENANT_RLS_ORG_B");

  await ensureCertificationMarker(adminUrl, target);
  await runNpm("test:tenant-fixture", env);
  await runNpm("maintenance:enter", env);
  await runNpm("cutover:multi-org", { ...env, ENABLE_TENANT_RLS_CUTOVER: "1" });
  const runtimeEnv = await provisionRuntimeCredential(adminUrl, { ...env }, target);
  const certificationEnv = await provisionReadOnlyCredential(adminUrl, runtimeEnv);
  await runNpm("test:tenant-rls", certificationEnv);
  await runNpm("db:check-drift", certificationEnv);
  await runNpm("check:multi-org-audit", certificationEnv);
  console.log(JSON.stringify({ ok: true, appRole: certificationEnv.TENANT_RLS_APP_ROLE, readOnlyRole: certificationEnv.PRODUCTION_READONLY_ROLE, organizations: [certificationEnv.TENANT_RLS_ORG_A, certificationEnv.TENANT_RLS_ORG_B], migrationExecutor: "prisma" }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "TENANT_RLS_CERTIFICATION_FAILED");
  process.exitCode = 1;
});
