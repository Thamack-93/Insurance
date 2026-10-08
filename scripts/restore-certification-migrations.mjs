import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const SINGLETON_CI_SKIPPED_MIGRATIONS = new Set([
  "20260831010000_multi_tenant_rls_cutover",
  "20260914000000_extend_rls_operational_models",
  "20260915010000_currency_rates_rls_cutover",
]);

export async function readSafeSingletonMigrationChecksums(migrationsDirectory) {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const checksums = new Map();
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || SINGLETON_CI_SKIPPED_MIGRATIONS.has(entry.name)) continue;
    const sql = await readFile(path.join(migrationsDirectory, entry.name, "migration.sql"));
    checksums.set(entry.name, createHash("sha256").update(sql).digest("hex"));
  }
  return checksums;
}
