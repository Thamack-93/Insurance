import "dotenv/config";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Pool } from "pg";

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

async function provisionRuntimeCredential(adminUrl: string, env: NodeJS.ProcessEnv) {
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
  runtime.hostname = target.hostname;
  env.TENANT_RLS_RUNTIME_DATABASE_URL = runtime.toString();
  env.DATABASE_URL = runtime.toString();
  env.DATABASE_URL_UNPOOLED = runtime.toString();
  return env;
}

async function main() {
  const env = { ...process.env };
  if (env.NODE_ENV !== "test" || env.TENANT_ISOLATION_TEST_DB !== "1" || env.PLAYWRIGHT_ENFORCE_DISPOSABLE_DB !== "1") {
    throw new Error("TENANT_RLS_CERTIFICATION_REQUIRES_DISPOSABLE_TEST_DB");
  }
  const adminUrl = required("DATABASE_ADMIN_URL");
  required("TENANT_RLS_APP_ROLE");
  required("TENANT_RLS_ORG_A");
  required("TENANT_RLS_ORG_B");

  await runNpm("test:tenant-fixture", env);
  await runNpm("maintenance:enter", env);
  await runNpm("cutover:multi-org", { ...env, ENABLE_TENANT_RLS_CUTOVER: "1" });
  const runtimeEnv = await provisionRuntimeCredential(adminUrl, { ...env });
  await runNpm("test:tenant-rls", runtimeEnv);
  await runNpm("db:check-drift", runtimeEnv);
  console.log(JSON.stringify({ ok: true, appRole: runtimeEnv.TENANT_RLS_APP_ROLE, organizations: [runtimeEnv.TENANT_RLS_ORG_A, runtimeEnv.TENANT_RLS_ORG_B], migrationExecutor: "prisma" }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "TENANT_RLS_CERTIFICATION_FAILED");
  process.exitCode = 1;
});
