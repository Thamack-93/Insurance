import fs from "node:fs";
import path from "node:path";
import {
  EXPECTED_TENANT_TRIGGERS,
  OPTIONAL_ORGANIZATION_TABLES,
  PLATFORM_GLOBAL_TABLES,
  PROTECTED_TENANT_TABLES,
} from "../src/lib/tenant-organization-foundation.ts";

const schema = fs.readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = fs.readFileSync(path.join(process.cwd(), "prisma/migrations/20260803000000_organization_transition/migration.sql"), "utf8");
const modelNames = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => match[1]);
const expected = new Set<string>([...PROTECTED_TENANT_TABLES, ...OPTIONAL_ORGANIZATION_TABLES, ...PLATFORM_GLOBAL_TABLES]);
const issues: string[] = [];

function modelBlock(model: string) {
  const start = schema.indexOf(`model ${model} {`);
  const next = schema.indexOf("\nmodel ", start + 1);
  return schema.slice(start, next < 0 ? undefined : next);
}

for (const model of modelNames) if (!expected.has(model)) issues.push(`${model} is not classified in the Cycle 1 organization inventory`);

for (const table of PROTECTED_TENANT_TABLES) {
  const block = modelBlock(table);
  if (!block.includes("organizationId")) issues.push(`${table} lacks organizationId in Prisma schema`);
  if (!migration.includes(`ALTER TABLE "${table}" ADD COLUMN "organizationId" TEXT`) || !migration.includes(`CREATE INDEX "${table}_organizationId_idx"`)) issues.push(`${table} lacks its organization column/index in migration SQL`);
  if (!migration.includes(`CREATE TRIGGER "${EXPECTED_TENANT_TRIGGERS[table]}"`)) issues.push(`${table} lacks its transition trigger in migration SQL`);
}

for (const table of OPTIONAL_ORGANIZATION_TABLES) {
  const block = modelBlock(table);
  if (!block.includes("organizationId")) issues.push(`${table} lacks optional organization attribution in Prisma schema`);
  if (!migration.includes(`ALTER TABLE "${table}" ADD COLUMN "organizationId" TEXT`) || !migration.includes(`CREATE INDEX "${table}_organizationId_idx"`)) issues.push(`${table} lacks optional attribution column/index in migration SQL`);
  if (migration.includes(`CREATE TRIGGER "${table}_transition_singleton_organization"`)) issues.push(`${table} must not receive a singleton assignment trigger`);
}

for (const table of PLATFORM_GLOBAL_TABLES) {
  if (["User", "Organization", "OrganizationMembership"].includes(table)) continue;
  const block = modelBlock(table);
  if (block.includes("organizationId")) issues.push(`${table} is platform-global and must not have organizationId`);
  if (migration.includes(`ALTER TABLE "${table}" ADD COLUMN "organizationId" TEXT`) || migration.includes(`CREATE TRIGGER "${table}_transition_singleton_organization"`)) issues.push(`${table} is platform-global but migration scopes it to the singleton organization`);
}

if (issues.length) {
  for (const issue of issues) console.error(issue);
  process.exitCode = 1;
} else {
  console.log(`Tenant inventory PASS (${PROTECTED_TENANT_TABLES.length} protected, ${OPTIONAL_ORGANIZATION_TABLES.length} optional-attribution, ${PLATFORM_GLOBAL_TABLES.length} platform-global models).`);
}
