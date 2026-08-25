import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const ROOTS = [path.join(process.cwd(), "src"), path.join(process.cwd(), "scripts")];

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

function callName(expression: ts.Expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

function hasObjectProperty(node: ts.Expression | undefined, name: string) {
  if (!node || !ts.isObjectLiteralExpression(node)) return false;
  return node.properties.some((property) => {
    if (ts.isShorthandPropertyAssignment(property)) return property.name.text === name;
    return ts.isPropertyAssignment(property)
      && ((ts.isIdentifier(property.name) && property.name.text === name)
        || (ts.isStringLiteral(property.name) && property.name.text === name));
  });
}

function propertyValue(node: ts.Expression | undefined, name: string) {
  if (!node || !ts.isObjectLiteralExpression(node)) return undefined;
  const property = node.properties.find((candidate): candidate is ts.PropertyAssignment => ts.isPropertyAssignment(candidate)
    && ((ts.isIdentifier(candidate.name) && candidate.name.text === name)
      || (ts.isStringLiteral(candidate.name) && candidate.name.text === name)));
  return property?.initializer;
}

async function main() {
  const files = (await Promise.all(ROOTS.map(filesUnder))).flat();
  const violations: Array<{ file: string; line: number; reason: string }> = [];

  for (const file of files) {
    const relative = path.relative(process.cwd(), file);
    if (relative.includes(".test.") || relative === "scripts/check-activity-log-scope.ts") continue;
    const source = ts.createSourceFile(
      file,
      await readFile(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && callName(node.expression) === "writeActivityLog") {
        const input = node.arguments[0];
        const hasOrganizationId = hasObjectProperty(input, "organizationId");
        if (!hasOrganizationId) {
          const position = source.getLineAndCharacterOfPosition(node.getStart(source));
          violations.push({ file: relative, line: position.line + 1, reason: "writeActivityLog requires an explicit organizationId property" });
        }
      }
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ["create", "createMany"].includes(node.expression.name.text)
        && ts.isPropertyAccessExpression(node.expression.expression)
        && node.expression.expression.name.text === "activityLog"
      ) {
        const data = propertyValue(node.arguments[0], "data");
        if (!hasObjectProperty(data, "organizationId")) {
          const position = source.getLineAndCharacterOfPosition(node.getStart(source));
          violations.push({ file: relative, line: position.line + 1, reason: "direct ActivityLog writes require organizationId in data" });
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(source);
  }

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`${violation.file}:${violation.line} ${violation.reason}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("ActivityLog organization scope check passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
