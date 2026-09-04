import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
const foundationModule = await import("../src/lib/tenant-organization-foundation.ts");
const inventoryModule = await import("../src/lib/tenant-dal-inventory.ts");
const PROTECTED_TENANT_TABLES = foundationModule.PROTECTED_TENANT_TABLES ?? foundationModule.default?.PROTECTED_TENANT_TABLES;
const tenantDalDomainForFile = inventoryModule.tenantDalDomainForFile ?? inventoryModule.default?.tenantDalDomainForFile;
const TENANT_DAL_GLOBAL_MODULES = inventoryModule.TENANT_DAL_GLOBAL_MODULES ?? inventoryModule.default?.TENANT_DAL_GLOBAL_MODULES ?? [];

const root = process.cwd();
const protectedDelegates = new Map(PROTECTED_TENANT_TABLES.map((model) => [model[0].toLowerCase() + model.slice(1), model]));

async function filesUnder(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(absolute));
    else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

const files = (await filesUnder(path.join(root, "src"))).filter((file) => !file.includes("/generated/") && !file.includes(".test."));
const directProtectedFiles = new Set();
const directGetDbFiles = new Set();
const protectedDirectGetDbFiles = new Set();
const unclassified = [];
for (const file of files) {
  const relative = path.relative(root, file);
  const source = ts.createSourceFile(file, await fs.readFile(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let hasProtectedAccess = false;
  let hasDirectGetDb = false;
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "getDb") {
      hasDirectGetDb = true;
    }
    if (ts.isPropertyAccessExpression(node) && protectedDelegates.has(node.name.text) && node.parent && ts.isPropertyAccessExpression(node.parent)) {
      const method = node.parent.name.text;
      if (["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy", "create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"].includes(method)) {
        hasProtectedAccess = true;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (hasDirectGetDb) directGetDbFiles.add(relative);
  if (!hasProtectedAccess) continue;
  directProtectedFiles.add(relative);
  if (hasDirectGetDb && !TENANT_DAL_GLOBAL_MODULES.includes(relative)) protectedDirectGetDbFiles.add(relative);
  if (!tenantDalDomainForFile(relative)) unclassified.push(relative);
}

const report = {
  status: unclassified.length ? "FAIL" : "PASS",
  protectedFiles: [...directProtectedFiles].sort(),
  protectedFileCount: directProtectedFiles.size,
  directGetDbFiles: [...directGetDbFiles].sort(),
  protectedDirectGetDbFiles: [...protectedDirectGetDbFiles].sort(),
  protectedDirectGetDbFileCount: protectedDirectGetDbFiles.size,
  unclassified,
};
console.log(`Tenant DAL inventory: ${report.status} (${report.protectedFileCount} protected modules classified; ${report.protectedDirectGetDbFileCount} protected modules still call root getDb).`);
if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
for (const file of unclassified) console.error(`- ${file}: protected Prisma access has no DAL domain owner`);
if (process.argv.includes("--strict")) {
  for (const file of protectedDirectGetDbFiles) console.error(`- ${file}: protected access uses root getDb outside an approved global DAL module`);
  if (protectedDirectGetDbFiles.size) process.exitCode = 1;
}
if (unclassified.length) process.exitCode = 1;
