import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { ENVIRONMENT_LOCAL_DATABASE_TABLES } from "../src/lib/deployment-db-identity-constants.ts";
import { RUNTIME_DATABASE_TABLES } from "../src/lib/database-runtime-access.ts";

const root = path.join(process.cwd(), "src");
const issues: string[] = [];
const BASE_CLIENT_ALLOWLIST = new Set(["src/lib/db-base.ts", "src/lib/db.ts", "src/lib/deployment-db-safety.ts"]);
const DIRECT_POOL_ALLOWLIST = new Set(["src/lib/backup.ts", "src/lib/backup-restore.ts", "src/lib/backup-restore-smoke.ts", "src/lib/db-base.ts"]);
const RAW_SQL_ALLOWLIST = new Set(["src/lib/deployment-safe-raw-sql.ts"]);
const RAW_SQL_METHODS = new Set(["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"]);

function rawSqlAccesses(source: string, filename: string) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let count = 0;
  function visit(node: ts.Node) {
    if (ts.isPropertyAccessExpression(node) && RAW_SQL_METHODS.has(node.name.text)) count += 1;
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && RAW_SQL_METHODS.has(node.argumentExpression.text)) count += 1;
    ts.forEachChild(node, visit);
  }
  visit(file);
  return count;
}

function visit(directory: string) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "generated") visit(target);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.(test|spec)\./.test(entry.name)) continue;
    const relative = path.relative(process.cwd(), target);
    const source = fs.readFileSync(target, "utf8");
    if (source.includes("new PrismaClient") && relative !== "src/lib/db-base.ts") issues.push(`${relative}: independently instantiates PrismaClient`);
    if ((source.includes("getBaseDb") || source.includes("@/lib/db-base")) && !BASE_CLIENT_ALLOWLIST.has(relative)) issues.push(`${relative}: imports the unguarded base database client`);
    if (/new\s+Pool\s*\(/.test(source) && !DIRECT_POOL_ALLOWLIST.has(relative)) issues.push(`${relative}: directly opens a PostgreSQL pool without deployment-safety classification`);
    if (rawSqlAccesses(source, target) > 0 && !RAW_SQL_ALLOWLIST.has(relative)) issues.push(`${relative}: raw SQL must use the deployment-safe helper`);
  }
}

visit(root);
const schema = fs.readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
const models = [...schema.matchAll(/^model\s+(\w+)\s+\{/gm)].map((match) => match[1]!);
const classifiedModels = new Set([...RUNTIME_DATABASE_TABLES, ...ENVIRONMENT_LOCAL_DATABASE_TABLES]);
for (const model of models) if (!classifiedModels.has(model)) issues.push(`prisma/schema.prisma: unclassified database model ${model}`);
for (const table of classifiedModels) if (!models.includes(table)) issues.push(`database runtime inventory: missing Prisma model ${table}`);
if (issues.length) {
  issues.forEach((issue) => console.error(issue));
  process.exitCode = 1;
} else {
  console.log("Deployment database safety scope PASS");
}
