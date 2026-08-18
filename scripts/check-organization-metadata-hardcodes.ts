import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const sourceRoots = [join(root, "src"), join(root, "scripts")];
const ignoredSegments = new Set(["generated", "node_modules"]);
const allowedFiles = new Set([
  "scripts/check-organization-metadata-hardcodes.ts",
  "scripts/setup-tenant-isolation-fixture.ts",
]);

const visibleName = ["Pedro", "Alfredo", "Gómez", "Lorenzo"].join(" ");
const visibleSlug = ["pedro", "alfredo", "gomez", "lorenzo"].join("-");
const forbidden = [visibleName, visibleSlug, "PolicyDesk Legacy Organization"];

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (ignoredSegments.has(entry)) return [];
    const stats = statSync(path);
    return stats.isDirectory() ? filesUnder(path) : [path];
  });
}

const violations: string[] = [];
for (const file of sourceRoots.flatMap(filesUnder)) {
  const relativePath = relative(root, file);
  if (allowedFiles.has(relativePath) || relativePath.includes(".test.") || !/\.(ts|tsx|mjs|cjs)$/.test(file)) continue;
  const source = readFileSync(file, "utf8");
  for (const literal of forbidden) {
    if (!source.includes(literal)) continue;
    const line = source.slice(0, source.indexOf(literal)).split("\n").length;
    violations.push(`${relativePath}:${line}`);
  }
}

const requiredRuntimeReads: Array<[string, string]> = [
  ["src/app/(dashboard)/platform/page.tsx", "getPlatformOverview"],
  ["src/app/(dashboard)/settings/page.tsx", "requireOrganizationContext"],
  ["src/app/(dashboard)/today/page.tsx", "getTodayData"],
  ["src/lib/dashboard-queries.ts", "requireOrganizationPortfolioReadScope"],
];
for (const [relativePath, marker] of requiredRuntimeReads) {
  const source = readFileSync(join(root, relativePath), "utf8");
  if (!source.includes(marker)) violations.push(`${relativePath}:missing-${marker}`);
}

if (violations.length > 0) {
  console.error(JSON.stringify({ ok: false, code: "ORGANIZATION_METADATA_HARDCODE", violations }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, checked: "organization-metadata-hardcodes", runtimeReads: "PASS" }));
}
