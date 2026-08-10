import fs from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), "src");
const issues: string[] = [];
const BASE_CLIENT_ALLOWLIST = new Set([
  "src/lib/db-base.ts",
  "src/lib/db.ts",
  "src/lib/deployment-db-safety.ts",
]);
const DIRECT_POOL_ALLOWLIST = new Set([
  // The backup path asserts deployment safety before opening this read-only
  // administrative connection. Restore and smoke are CLI-only temporary-target
  // operations with their own target authorization.
  "src/lib/backup.ts",
  "src/lib/backup-restore.ts",
  "src/lib/backup-restore-smoke.ts",
  "src/lib/db-base.ts",
]);

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
    if (source.includes("new PrismaClient") && relative !== "src/lib/db-base.ts") {
      issues.push(`${relative}: independently instantiates PrismaClient`);
    }
    if ((source.includes("getBaseDb") || source.includes("@/lib/db-base")) && !BASE_CLIENT_ALLOWLIST.has(relative)) {
      issues.push(`${relative}: imports the unguarded base database client`);
    }
    if (/new\s+Pool\s*\(/.test(source) && !DIRECT_POOL_ALLOWLIST.has(relative)) {
      issues.push(`${relative}: directly opens a PostgreSQL pool without deployment-safety classification`);
    }
    const executeRawCalls = source.match(/\$executeRaw(?:Unsafe)?\s*\(/g) ?? [];
    if (executeRawCalls.length > 0) {
      const isKnownAdvisoryLock = relative === "src/lib/assistant-reports.ts"
        && executeRawCalls.length === 1
        && source.includes("SELECT pg_advisory_xact_lock(hashtext(");
      if (!isKnownAdvisoryLock) issues.push(`${relative}: raw SQL mutation requires deployment-safety classification`);
    }
  }
}

visit(root);
if (issues.length) {
  issues.forEach((issue) => console.error(issue));
  process.exitCode = 1;
} else {
  console.log("Deployment database safety scope PASS");
}
