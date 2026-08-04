import fs from "node:fs";
import path from "node:path";
import { EXPECTED_TENANT_TRIGGERS, PROTECTED_TENANT_TABLES } from "../src/lib/tenant-organization-foundation.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = fs.readFileSync(path.join(process.cwd(), "prisma/migrations/20260803000000_organization_transition/migration.sql"), "utf8");
const modelNames = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => match[1]);
const exempt = new Set(["User", "Organization", "OrganizationMembership", "SystemSetting"]);
const expected = new Set(PROTECTED_TENANT_TABLES);
const issues: string[] = [];
for (const model of modelNames.filter((name) => !exempt.has(name))) {
  if (!expected.has(model as (typeof PROTECTED_TENANT_TABLES)[number])) issues.push(`${model} is not classified in PROTECTED_TENANT_TABLES`);
}
for (const table of PROTECTED_TENANT_TABLES) {
  const block = schema.slice(schema.indexOf(`model ${table} {`), schema.indexOf("\nmodel ", schema.indexOf(`model ${table} {`) + 1) < 0 ? undefined : schema.indexOf("\nmodel ", schema.indexOf(`model ${table} {`) + 1));
  if (!block.includes("organizationId")) issues.push(`${table} lacks organizationId in Prisma schema`);
  if (!migration.includes(`CREATE TRIGGER \"${EXPECTED_TENANT_TRIGGERS[table]}\"`)) issues.push(`${table} lacks its transition trigger in migration SQL`);
}
if (issues.length) {
  for (const issue of issues) console.error(issue);
  process.exitCode = 1;
} else {
  console.log(`Tenant inventory PASS (${PROTECTED_TENANT_TABLES.length} protected tables).`);
}
