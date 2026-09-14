import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Production remains behind the maintenance-gated multi-tenant cutover. This
// runner applies additive migrations without silently enabling that cutover.
// It is deliberately opt-in and requires a direct administrative connection.
if (process.env.PRODUCTION_SINGLETON_MIGRATION !== "1") {
  throw new Error("PRODUCTION_SINGLETON_MIGRATION_REQUIRES_EXPLICIT_FLAG");
}

const databaseUrl = process.env.DATABASE_ADMIN_URL?.trim() || process.env.DATABASE_URL_UNPOOLED?.trim();
if (!databaseUrl) throw new Error("PRODUCTION_SINGLETON_MIGRATION_REQUIRES_DIRECT_DATABASE_URL");
const parsed = new URL(databaseUrl);
if (/pooler/i.test(parsed.hostname) || parsed.searchParams.has("pgbouncer")) {
  throw new Error("PRODUCTION_SINGLETON_MIGRATION_REQUIRES_DIRECT_DATABASE_URL");
}

const repositoryRoot = process.cwd();
const sourceMigrations = path.join(repositoryRoot, "prisma", "migrations");
const cutoverMigration = "20260831010000_multi_tenant_rls_cutover";
const tempRoot = await mkdtemp(path.join(repositoryRoot, ".prisma-singleton-production-migrations-"));

try {
  const tempSchema = path.join(tempRoot, "schema.prisma");
  const tempMigrations = path.join(tempRoot, "migrations");
  const tempConfig = path.join(tempRoot, "prisma.config.ts");
  await cp(path.join(repositoryRoot, "prisma", "schema.prisma"), tempSchema);
  await cp(sourceMigrations, tempMigrations, { recursive: true });
  await rm(path.join(tempMigrations, cutoverMigration), { recursive: true, force: true });
  await writeFile(
    tempConfig,
    `import { defineConfig } from "@prisma/config";
export default defineConfig({
  schema: ${JSON.stringify(tempSchema)},
  migrations: { path: ${JSON.stringify(tempMigrations)} },
  datasource: { url: ${JSON.stringify(databaseUrl)} },
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
