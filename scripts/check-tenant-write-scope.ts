import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { PROTECTED_TENANT_TABLES } from "../src/lib/tenant-organization-foundation.ts";

const ROOTS = [path.join(process.cwd(), "src"), path.join(process.cwd(), "scripts")];
const WRITE_METHODS = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
const PROTECTED_DELEGATES = new Map(PROTECTED_TENANT_TABLES.map((model) => [model[0].toLowerCase() + model.slice(1), model]));
const EXEMPT_FILES = new Set([
  "scripts/backfill-organizations.ts",
  "scripts/setup-tenant-isolation-fixture.ts",
  "scripts/run-backup-restore-drill.ts",
  // Explicitly authorized CLI maintenance; guarded by ALLOW_KNOWLEDGE_INTEGRITY_BACKFILL.
  "scripts/backfill-knowledge-integrity.ts",
  "src/lib/backup-restore.ts",
  "src/lib/backup.ts",
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
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) return node.argumentExpression.text;
  return null;
}

function enclosingFunction(node: ts.Node): ts.SignatureDeclaration | null {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isFunctionLike(current)) return current;
    current = current.parent;
  }
  return null;
}

function hasTenantEvidence(call: ts.CallExpression, source: ts.SourceFile) {
  const callText = call.getText(source);
  if (/\borganizationId\b/.test(callText)) return true;

  // createMany and generic delegate helpers commonly pass a prepared object.
  // They are accepted only when the enclosing function both carries tenant
  // identity and performs a live authorization/revalidation step.
  const fn = enclosingFunction(call);
  const functionText = fn?.getText(source) ?? "";
  const parameterText = fn?.parameters.map((parameter) => parameter.getText(source)).join(" ") ?? "";
  return /\borganizationId\b/.test(parameterText) || (
    /\b(?:organizationId|context|scope)\b/.test(functionText) &&
    /(requireOrganization(?:Context|Role)|assertOrganizationContextInTransaction|TENANT_ISOLATION_TEST_DB|auditTenantFoundation)/.test(functionText)
  );
}

async function inspect(file: string): Promise<Violation[]> {
  const relative = path.relative(process.cwd(), file);
  if (
    relative.startsWith("src/generated/") ||
    relative.includes(".test.") ||
    relative.startsWith("prisma/") ||
    EXEMPT_FILES.has(relative) ||
    relative === "scripts/check-tenant-write-scope.ts"
  ) return [];

  const text = await readFile(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const violations: Violation[] = [];

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const method = propertyName(node.expression);
      const delegateExpression = ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)
        ? node.expression.expression
        : null;
      const delegate = delegateExpression ? propertyName(delegateExpression) : null;
      const model = delegate ? PROTECTED_DELEGATES.get(delegate) : undefined;
      if (method && WRITE_METHODS.has(method) && model && !hasTenantEvidence(node, source)) {
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        violations.push({
          file: relative,
          line: position.line + 1,
          model,
          method,
          reason: "protected writer has no direct organizationId predicate/data or authorized tenant helper",
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return violations;
}

async function main() {
  const violations = (await Promise.all((await Promise.all(ROOTS.map(filesUnder))).flat().map(inspect))).flat();
  const report = { status: violations.length ? "FAIL" : "PASS", protectedModels: PROTECTED_DELEGATES.size, violations };
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Tenant write scope: ${report.status} (${report.protectedModels} protected models).`);
    for (const issue of violations) console.error(`- ${issue.file}:${issue.line} ${issue.model}.${issue.method}: ${issue.reason}`);
  }
  if (violations.length) process.exitCode = 1;
}

main().catch(() => {
  console.error("Tenant write scope: FAIL (audit could not complete). ");
  process.exit(1);
});
