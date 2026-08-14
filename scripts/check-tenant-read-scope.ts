import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { PROTECTED_TENANT_TABLES } from "../src/lib/tenant-organization-foundation.ts";

const ROOTS = [path.join(process.cwd(), "src"), path.join(process.cwd(), "scripts")];
const READ_METHODS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);
const PROTECTED_DELEGATES = new Map(
  PROTECTED_TENANT_TABLES.map((model) => [model[0].toLowerCase() + model.slice(1), model]),
);
const EXEMPT_FILES = new Set([
  "scripts/backfill-organizations.ts",
  "scripts/check-multi-org-audit.ts",
  "scripts/check-tenant-backfill.ts",
  "scripts/check-tenant-inventory.ts",
  // Global compatibility audit: it intentionally inventories every tenant and
  // never returns operational rows to an authenticated caller.
  "scripts/check-legacy-workitem-refs.ts",
  "scripts/run-backup-restore-drill.ts",
  "scripts/setup-tenant-isolation-fixture.ts",
  "src/lib/backup-restore.ts",
  "src/lib/backup.ts",
  "src/lib/platform-dashboard.ts",
  "src/lib/tenant-organization-foundation.ts",
]);

type Violation = { file: string; line: number; model: string; method: string; reason: string };

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(absolute));
    else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

function propertyName(node: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return null;
}

function hasTenantEvidence(call: ts.CallExpression, source: ts.SourceFile) {
  if (/\borganizationId\b/.test(call.getText(source))) return true;
  let current: ts.Node | undefined = call.parent;
  while (current) {
    if (ts.isFunctionLike(current)) {
      const functionText = current.getText(source);
      const parameterText = current.parameters.map((parameter) => parameter.getText(source)).join(" ");
      if (/\borganizationId\b/.test(parameterText)) return true;
      if (
        /\b(?:organizationId|organizationContext|context|scope)\b/.test(functionText) &&
        /(?:requireOrganization(?:Context|Role|PortfolioReadScope|Id)|assertOrganizationContextInTransaction|requireActiveTelegramOrganization|TENANT_ISOLATION_TEST_DB|TENANT_READ_SCOPE_GLOBAL_TOKEN)/.test(functionText)
      ) return true;
    }
    current = current.parent;
  }
  return false;
}

async function inspect(file: string): Promise<Violation[]> {
  const relative = path.relative(process.cwd(), file);
  if (
    relative.startsWith("src/generated/") ||
    relative.includes(".test.") ||
    EXEMPT_FILES.has(relative) ||
    relative === "scripts/check-tenant-read-scope.ts"
  ) return [];

  const text = await readFile(file, "utf8");
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: Violation[] = [];

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const method = propertyName(node.expression);
      const delegateExpression = ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)
        ? node.expression.expression
        : null;
      const delegate = delegateExpression ? propertyName(delegateExpression) : null;
      const model = delegate ? PROTECTED_DELEGATES.get(delegate) : undefined;
      if (method && READ_METHODS.has(method) && model && !hasTenantEvidence(node, source)) {
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        violations.push({
          file: relative,
          line: position.line + 1,
          model,
          method,
          reason: "protected read has no organizationId or live organization authorization evidence",
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return violations;
}

async function main() {
  const files = (await Promise.all(ROOTS.map(filesUnder))).flat();
  const violations = (await Promise.all(files.map(inspect))).flat();
  const report = {
    status: violations.length ? "FAIL" : "PASS",
    protectedModels: PROTECTED_DELEGATES.size,
    violations,
  };
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Tenant read scope: ${report.status} (${report.protectedModels} protected models).`);
    for (const issue of violations) {
      console.error(`- ${issue.file}:${issue.line} ${issue.model}.${issue.method}: ${issue.reason}`);
    }
  }
  if (violations.length) process.exitCode = 1;
}

main().catch(() => {
  console.error("Tenant read scope: FAIL (audit could not complete).");
  process.exit(1);
});
