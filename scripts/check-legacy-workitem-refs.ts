import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.join(process.cwd(), "scripts");
const ALLOWED_FILES = new Set([
  "backfill-work-items.ts",
  // Historical compatibility backfill: it normalizes dates in both legacy Task
  // records and their WorkItem successors during an explicitly guarded migration.
  "backfill-business-dates.ts",
  "check-legacy-workitem-refs.ts",
]);
const BLOCKED_PATTERNS = [
  { label: "legacy-db-task", regex: /\bdb\.task\b/ },
  { label: "legacy-public-task", regex: /public\."Task"/ },
];

type Violation = {
  file: string;
  line: number;
  snippet: string;
  label: string;
};

async function main() {
  const violations: Violation[] = [];
  const files = await collectFiles(ROOT);

  for (const file of files) {
    const relative = path.relative(ROOT, file);
    if (ALLOWED_FILES.has(relative)) continue;

    const contents = await readFile(file, "utf8");
    const lines = contents.split(/\r?\n/);

    for (const { label, regex } of BLOCKED_PATTERNS) {
      for (let index = 0; index < lines.length; index += 1) {
        if (!regex.test(lines[index])) continue;
        violations.push({
          file: path.relative(process.cwd(), file),
          line: index + 1,
          snippet: lines[index].trim(),
          label,
        });
      }
    }
  }

  if (!violations.length) {
    console.log("No se encontraron referencias legacy fuera del backfill autorizado.");
    return;
  }

  console.error("Se encontraron referencias legacy fuera del backfill autorizado:");
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} [${violation.label}] ${violation.snippet}`);
  }

  process.exitCode = 1;
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && /\.(ts|tsx|js|jsx|sh)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

main().catch((error) => {
  console.error("Error al verificar referencias legacy.");
  console.error(error);
  process.exit(1);
});
