import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { assertDisposableCertificationTarget } from "./tenant-certification-target.mjs";

// CI exercises the pre-cutover singleton application in one job.  Keep the
// production RLS migration in the committed migration history, but apply only
// the additive migrations here; the disposable two-org job applies the final
// migration explicitly after entering maintenance mode.
if (process.env.CI !== "true" && process.env.GITHUB_ACTIONS !== "true" && process.env.TENANT_ISOLATION_REMOTE_BRANCH !== "1") {
  throw new Error("SINGLETON_CI_MIGRATION_REQUIRES_GITHUB_ACTIONS");
}
const certificationDatabaseUrl = process.env.DATABASE_ADMIN_URL?.trim() || process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
if (!certificationDatabaseUrl) throw new Error("SINGLETON_CI_MIGRATION_REQUIRES_DATABASE_URL");
assertDisposableCertificationTarget(certificationDatabaseUrl);
const repositoryRoot = process.cwd();
const skippedMigrations = new Set([
  "20260831010000_multi_tenant_rls_cutover",
  "20260914000000_extend_rls_operational_models",
  "20260915010000_currency_rates_rls_cutover",
]);
const sourceMigrations = path.join(repositoryRoot, "prisma", "migrations");
// Keep the temporary config under the repository so its @prisma/config import
// resolves through the repository's node_modules in GitHub Actions.
const tempRoot = await mkdtemp(path.join(repositoryRoot, ".prisma-singleton-migrations-"));

try {
  const tempSchema = path.join(tempRoot, "schema.prisma");
  const tempMigrations = path.join(tempRoot, "migrations");
  const tempConfig = path.join(tempRoot, "prisma.config.ts");
  await cp(path.join(repositoryRoot, "prisma", "schema.prisma"), tempSchema);
  await cp(sourceMigrations, tempMigrations, { recursive: true });
  for (const migration of skippedMigrations) {
    await rm(path.join(tempMigrations, migration), { recursive: true, force: true });
  }

  await writeFile(
    tempConfig,
    `import { defineConfig } from "@prisma/config";
const url = process.env.DATABASE_ADMIN_URL?.trim() || process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
if (!url) throw new Error("DATABASE_URL is required for singleton CI migrations.");
export default defineConfig({
  schema: ${JSON.stringify(tempSchema)},
  migrations: { path: ${JSON.stringify(tempMigrations)} },
  datasource: { url },
});
`,
    "utf8",
  );

  const result = spawnSync("npx", ["prisma", "migrate", "deploy", "--config", tempConfig], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
