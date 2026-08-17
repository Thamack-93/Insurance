import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/lib/db";

type Classification = "runtime-write" | "legacy-read-compat" | "migration-only";

type StaticReference = {
  file: string;
  line: number;
  snippet: string;
  classification: Classification;
};

type DataAudit = {
  taskCount: number;
  legacyWorkItemCount: number;
  tasksWithoutLegacyWorkItem: number;
  workItemsPointingToMissingTask: number;
  duplicateLegacyMappings: number;
  tasksUpdatedAfterWorkItem: number;
  legacyDocumentCount: number;
};

const ROOTS = [path.join(process.cwd(), "src"), path.join(process.cwd(), "scripts")];
const STATIC_PATTERNS = [
  /\b(?:db|tx)\.task\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)/,
  /sourceType:\s*["']Task["']/,
  /entityType:\s*["']Task["']/,
  /\btaskId\b/,
];

const LEGACY_READ_FILES = new Set([
  "src/lib/work-item-resolvers.ts",
  "src/lib/search.ts",
  "src/lib/notifications-shared.ts",
  "src/lib/portfolio-access.ts",
  "src/lib/risk-engine.ts",
  "src/app/(dashboard)/tasks/[id]/page.tsx",
  "src/app/(dashboard)/tasks/actions.ts",
  "src/app/(dashboard)/documents/page.tsx",
  "src/app/(dashboard)/risks/page.tsx",
  "src/app/api/documents/[id]/download/route.ts",
]);

// Read-only tenant relation inventory. Keep this exact allow-list narrow so
// the Task write detector remains strict everywhere else.
const AUDIT_COMPAT_FILES = new Set(["src/lib/tenant-organization-foundation.ts"]);

const MIGRATION_FILES = new Set([
  "scripts/backfill-work-items.ts",
  "scripts/backfill-business-dates.ts",
  "scripts/reconcile-insured-clients.ts",
  "scripts/assign-existing-portfolio.ts",
  "tests/e2e/data-quality-renewals.spec.ts",
]);

function classify(file: string, snippet: string): Classification {
  if (MIGRATION_FILES.has(file)) return "migration-only";
  if (file === "scripts/check-legacy-workitem-refs.ts") return "migration-only";
  // Restore compatibility inventory is declarative FK metadata, not a Task writer.
  if (file === "src/lib/backup-restore.ts" && snippet.includes("Document_taskId_fkey")) return "migration-only";
  if (AUDIT_COMPAT_FILES.has(file)) return "legacy-read-compat";
  if (file === "src/app/api/documents/upload/route.ts" && snippet.includes("formData.get(\"taskId\")")) {
    return "legacy-read-compat";
  }
  if (LEGACY_READ_FILES.has(file) && !/\b(?:db|tx)\.task\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)/.test(snippet)) {
    return "legacy-read-compat";
  }
  return "runtime-write";
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(fullPath)));
    else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

async function collectStaticReferences(): Promise<StaticReference[]> {
  const references: StaticReference[] = [];
  for (const root of ROOTS) {
    const files = await collectFiles(root);
    for (const file of files) {
      const relative = path.relative(process.cwd(), file);
      if (relative.startsWith("src/generated/") || relative.includes(".test.")) continue;
      const lines = (await readFile(file, "utf8")).split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const snippet = lines[index].trim();
        if (!STATIC_PATTERNS.some((pattern) => pattern.test(snippet))) continue;
        references.push({
          file: relative,
          line: index + 1,
          snippet,
          classification: classify(relative, snippet),
        });
      }
    }
  }
  return references;
}

async function auditData(): Promise<DataAudit> {
  const db = getDb();
  const [tasks, legacyWorkItems, legacyDocuments] = await Promise.all([
    db.task.findMany({ select: { id: true, updatedAt: true } }),
    db.workItem.findMany({
      where: { sourceType: "Task" },
      select: { sourceId: true, updatedAt: true },
    }),
    db.document.count({ where: { taskId: { not: null } } }),
  ]);

  const taskIds = new Set(tasks.map((task) => task.id));
  const mappingCounts = new Map<string, number>();
  for (const workItem of legacyWorkItems) {
    if (!workItem.sourceId) continue;
    mappingCounts.set(workItem.sourceId, (mappingCounts.get(workItem.sourceId) ?? 0) + 1);
  }

  const taskUpdatedAfterWorkItem = new Set<string>();
  const workItemByTask = new Map<string, Date>();
  for (const workItem of legacyWorkItems) {
    if (!workItem.sourceId) continue;
    const current = workItemByTask.get(workItem.sourceId);
    if (!current || workItem.updatedAt > current) workItemByTask.set(workItem.sourceId, workItem.updatedAt);
  }
  for (const task of tasks) {
    const workItemUpdatedAt = workItemByTask.get(task.id);
    if (workItemUpdatedAt && task.updatedAt > workItemUpdatedAt) taskUpdatedAfterWorkItem.add(task.id);
  }

  return {
    taskCount: tasks.length,
    legacyWorkItemCount: legacyWorkItems.length,
    tasksWithoutLegacyWorkItem: tasks.filter((task) => !mappingCounts.has(task.id)).length,
    workItemsPointingToMissingTask: legacyWorkItems.filter((workItem) => Boolean(workItem.sourceId) && !taskIds.has(workItem.sourceId!)).length,
    duplicateLegacyMappings: [...mappingCounts.values()].filter((count) => count > 1).length,
    tasksUpdatedAfterWorkItem: taskUpdatedAfterWorkItem.size,
    legacyDocumentCount: legacyDocuments,
  };
}

async function main() {
  const json = process.argv.includes("--json");
  const staticOnly = process.argv.includes("--static-only");
  const readOnly = process.argv.includes("--read-only");
  const references = await collectStaticReferences();
  const data = staticOnly ? null : await auditData();
  const runtimeWrites = references.filter((reference) => reference.classification === "runtime-write");
  const conflicts = data ? data.workItemsPointingToMissingTask + data.duplicateLegacyMappings : 0;
  const report = {
    status: runtimeWrites.length || conflicts ? "FAIL" : "PASS",
    runtimeWrites,
    staticReferences: references.filter((reference) => reference.classification !== "runtime-write"),
    data,
    notes: [
      "Task se conserva como histórico; este comando no modifica datos.",
      "tasksWithoutLegacyWorkItem y legacyDocumentCount son deuda histórica, no errores por sí mismos.",
      ...(staticOnly ? ["Se omitió la auditoría de datos porque se solicitó --static-only."] : []),
      ...(readOnly ? ["La auditoría de datos se ejecutó en modo explícito de solo lectura."] : []),
    ],
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Auditoría Task -> WorkItem: ${report.status}`);
    console.log(`- referencias legacy permitidas: ${report.staticReferences.length}`);
    console.log(`- escrituras runtime no permitidas: ${runtimeWrites.length}`);
    console.log(`- Task sin WorkItem histórico: ${data?.tasksWithoutLegacyWorkItem ?? "omitido"}`);
    console.log(`- documentos ligados al campo legacy taskId: ${data?.legacyDocumentCount ?? "omitido"}`);
    console.log(`- conflictos de mapeo: ${conflicts}`);
    for (const reference of runtimeWrites) {
      console.error(`- ${reference.file}:${reference.line} ${reference.snippet}`);
    }
  }

  if (report.status === "FAIL") process.exitCode = 1;
}

main().catch((error) => {
  console.error("No se pudo completar la auditoría Task -> WorkItem.");
  console.error(error);
  process.exit(1);
});
