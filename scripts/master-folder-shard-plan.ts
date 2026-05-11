#!/usr/bin/env tsx

import fs from "node:fs/promises";
import path from "node:path";

type FileKind = "pdf" | "xml" | "spreadsheet" | "image" | "archive" | "other" | "symlink";
type BucketKind = "folder";
type ShardId = 1 | 2 | 3;

type KindCounts = Record<FileKind, number>;

type FileEntry = {
  absolutePath: string;
  relativePath: string;
  fileName: string;
  kind: FileKind;
  sizeBytes: number;
  weight: number;
};

type Bucket = {
  id: string;
  kind: BucketKind;
  displayName: string;
  absolutePath: string;
  relativePath: string;
  fileCount: number;
  totalBytes: number;
  weight: number;
  subfolderCount: number;
  kindCounts: KindCounts;
  files?: FileEntry[];
  shardId?: ShardId;
};

type RootOrphansBucket = {
  fileCount: number;
  totalBytes: number;
  weight: number;
  kindCounts: KindCounts;
  files: FileEntry[];
};

type ScannedRoot = {
  buckets: Bucket[];
  rootOrphans: RootOrphansBucket;
  topLevelFolderCount: number;
  totalBytes: number;
  fileCount: number;
  fileTypeTotals: KindCounts;
  fileTypeTotalsInFolders: KindCounts;
  fileTypeTotalsOrphans: KindCounts;
};

type Shard = {
  shardId: ShardId;
  totalWeight: number;
  totalFiles: number;
  totalBytes: number;
  bucketCount: number;
  buckets: Bucket[];
};

type ScanSummary = {
  rootFolder: string;
  generatedAt: string;
  topLevelFolderCount: number;
  expectedTopLevelFolderCount: number;
  bucketCount: number;
  fileCount: number;
  totalBytes: number;
  rootOrphans: RootOrphansBucket;
  fileTypeTotals: KindCounts;
  fileTypeTotalsInFolders: KindCounts;
  fileTypeTotalsOrphans: KindCounts;
  reviewerSummary: {
    explicitFocusTargets: Array<{
      folderName: string;
      found: boolean;
      shardId: ShardId | null;
      fileCount: number;
      weight: number;
    }>;
    heavyFolders: Array<{
      folderName: string;
      shardId: ShardId | null;
      fileCount: number;
      weight: number;
    }>;
    recommendedOrder: Array<{
      folderName: string;
      shardId: ShardId | null;
      fileCount: number;
      weight: number;
    }>;
  };
  shards: Shard[];
  coverage: {
    allTopLevelFoldersAssignedOnce: boolean;
    allFilesAssignedOnce: boolean;
    topLevelFoldersAccountedFor: number;
    shardFilesAccountedFor: number;
    rootOrphanFilesAccountedFor: number;
    totalFilesAccountedFor: number;
    duplicateAssignments: number;
    missingAssignments: number;
    warnings: string[];
  };
};

const DEFAULT_ROOT = "/Users/pedrogomez/Desktop/Polizas Pedro/Clientes";
const SHARD_COUNT = 3;
const EXPECTED_TOP_LEVEL_FOLDERS = 47;
const LARGE_FILE_SIZE_1 = 1 * 1024 * 1024;
const LARGE_FILE_SIZE_2 = 5 * 1024 * 1024;
const LARGE_FILE_SIZE_3 = 25 * 1024 * 1024;
const REVIEW_FOCUS_TARGETS = [
  "Mario Bracamonte",
  "Elias Tanus Rame",
  "Mariano Martinez Grayeb",
  "Alejando Haddad Aportela",
  "Alejandro Haddad Aportela",
  "Charbel Murad Koppel",
];

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedKey(value: string) {
  return normalizeName(value).replace(/\s+/g, "");
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }

    if (token.includes("=")) {
      const [rawKey, ...rest] = token.replace(/^--?/, "").split("=");
      flags.set(rawKey, rest.join("="));
      continue;
    }

    const key = token.replace(/^--?/, "");
    const next = argv[index + 1];
    if (next && !next.startsWith("-")) {
      flags.set(key, next);
      index += 1;
      continue;
    }

    flags.set(key, true);
  }

  const rootFolder =
    positionals[0] ??
    (typeof flags.get("folder") === "string" ? (flags.get("folder") as string) : undefined) ??
    DEFAULT_ROOT;
  const outBase =
    (typeof flags.get("out") === "string" ? (flags.get("out") as string) : undefined) ??
    (typeof flags.get("output") === "string" ? (flags.get("output") as string) : undefined) ??
    null;
  const printJson = flags.get("json") === true;

  return { rootFolder, outBase, printJson };
}

function createKindCounts(): KindCounts {
  return {
    pdf: 0,
    xml: 0,
    spreadsheet: 0,
    image: 0,
    archive: 0,
    other: 0,
    symlink: 0,
  };
}

function addKindCount(target: KindCounts, kind: FileKind) {
  target[kind] += 1;
}

function addKindCounts(target: KindCounts, source: KindCounts) {
  for (const key of Object.keys(source) as FileKind[]) {
    target[key] += source[key];
  }
}

function classifyFileKind(fileName: string, isSymlink: boolean): FileKind {
  if (isSymlink) return "symlink";
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".xml") return "xml";
  if ([".xls", ".xlsx", ".csv", ".tsv"].includes(ext)) return "spreadsheet";
  if ([".jpg", ".jpeg", ".png", ".webp", ".heic", ".bmp", ".tif", ".tiff"].includes(ext)) return "image";
  if ([".zip", ".rar", ".7z", ".tar", ".gz", ".tgz"].includes(ext)) return "archive";
  return "other";
}

function fileWeight(kind: FileKind, sizeBytes: number) {
  let weight = 1;

  if (kind === "pdf") weight += 3;
  else if (kind === "xml") weight += 1;
  else if (kind === "spreadsheet") weight += 2;
  else if (kind === "image") weight += 1;
  else if (kind === "archive") weight += 4;
  else if (kind === "symlink") weight += 1;

  if (sizeBytes >= LARGE_FILE_SIZE_3) weight += 3;
  else if (sizeBytes >= LARGE_FILE_SIZE_2) weight += 2;
  else if (sizeBytes >= LARGE_FILE_SIZE_1) weight += 1;

  return weight;
}

function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const decimals = unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function humanKindCounts(kindCounts: KindCounts) {
  return {
    pdf: kindCounts.pdf,
    xml: kindCounts.xml,
    spreadsheet: kindCounts.spreadsheet,
    image: kindCounts.image,
    archive: kindCounts.archive,
    other: kindCounts.other,
    symlink: kindCounts.symlink,
  };
}

function compareBucketsDesc(a: Bucket, b: Bucket) {
  if (b.weight !== a.weight) return b.weight - a.weight;
  if (b.fileCount !== a.fileCount) return b.fileCount - a.fileCount;
  return a.displayName.localeCompare(b.displayName, "es");
}

function compareShardLoad(a: Shard, b: Shard) {
  if (a.totalWeight !== b.totalWeight) return a.totalWeight - b.totalWeight;
  if (a.totalFiles !== b.totalFiles) return a.totalFiles - b.totalFiles;
  if (a.bucketCount !== b.bucketCount) return a.bucketCount - b.bucketCount;
  return a.shardId - b.shardId;
}

async function ensureReadableDirectory(dirPath: string) {
  const stat = await fs.stat(dirPath);
  if (!stat.isDirectory()) {
    throw new Error(`Ruta no es un directorio: ${dirPath}`);
  }
}

async function summarizeFolder(folderPath: string, rootFolder: string): Promise<Bucket> {
  const bucket: Bucket = {
    id: path.relative(rootFolder, folderPath) || path.basename(folderPath),
    kind: "folder",
    displayName: path.basename(folderPath),
    absolutePath: folderPath,
    relativePath: path.relative(rootFolder, folderPath) || ".",
    fileCount: 0,
    totalBytes: 0,
    weight: 0,
    subfolderCount: 0,
    kindCounts: createKindCounts(),
  };

  async function walk(currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        bucket.subfolderCount += 1;
        await walk(absolutePath);
        continue;
      }

      const isSymlink = entry.isSymbolicLink();
      const kind = classifyFileKind(entry.name, isSymlink);
      let sizeBytes = 0;

      try {
        const stat = await fs.lstat(absolutePath);
        sizeBytes = stat.size;
      } catch {
        sizeBytes = 0;
      }

      const relativePath = path.relative(rootFolder, absolutePath);
      const weight = fileWeight(kind, sizeBytes);

      bucket.fileCount += 1;
      bucket.totalBytes += sizeBytes;
      bucket.weight += weight;
      addKindCount(bucket.kindCounts, kind);
      bucket.files ??= [];
      bucket.files.push({
        absolutePath,
        relativePath,
        fileName: entry.name,
        kind,
        sizeBytes,
        weight,
      });
    }
  }

  await walk(folderPath);

  bucket.files?.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    if (b.sizeBytes !== a.sizeBytes) return b.sizeBytes - a.sizeBytes;
    return a.relativePath.localeCompare(b.relativePath, "es");
  });

  return bucket;
}

async function scanRoot(rootFolder: string): Promise<ScannedRoot> {
  await ensureReadableDirectory(rootFolder);

  const entries = await fs.readdir(rootFolder, { withFileTypes: true });
  const folderBuckets: Bucket[] = [];
  const rootOrphans: RootOrphansBucket = {
    fileCount: 0,
    totalBytes: 0,
    weight: 0,
    kindCounts: createKindCounts(),
    files: [],
  };
  const fileTypeTotals = createKindCounts();
  const fileTypeTotalsInFolders = createKindCounts();
  const fileTypeTotalsOrphans = createKindCounts();

  for (const entry of entries) {
    const absolutePath = path.join(rootFolder, entry.name);
    if (entry.isDirectory()) {
      const bucket = await summarizeFolder(absolutePath, rootFolder);
      folderBuckets.push(bucket);
      addKindCounts(fileTypeTotalsInFolders, bucket.kindCounts);
      continue;
    }

    const isSymlink = entry.isSymbolicLink();
    const kind = classifyFileKind(entry.name, isSymlink);
    let sizeBytes = 0;

    try {
      const stat = await fs.lstat(absolutePath);
      sizeBytes = stat.size;
    } catch {
      sizeBytes = 0;
    }

    const relativePath = path.relative(rootFolder, absolutePath);
    const weight = fileWeight(kind, sizeBytes);

    rootOrphans.fileCount += 1;
    rootOrphans.totalBytes += sizeBytes;
    rootOrphans.weight += weight;
    addKindCount(rootOrphans.kindCounts, kind);
    addKindCount(fileTypeTotals, kind);
    addKindCount(fileTypeTotalsOrphans, kind);
    rootOrphans.files.push({
      absolutePath,
      relativePath,
      fileName: entry.name,
      kind,
      sizeBytes,
      weight,
    });
  }

  for (const bucket of folderBuckets) {
    addKindCounts(fileTypeTotals, bucket.kindCounts);
  }

  rootOrphans.files.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    if (b.sizeBytes !== a.sizeBytes) return b.sizeBytes - a.sizeBytes;
    return a.relativePath.localeCompare(b.relativePath, "es");
  });

  const totalBytes = folderBuckets.reduce((sum, bucket) => sum + bucket.totalBytes, 0) + rootOrphans.totalBytes;
  const fileCount = folderBuckets.reduce((sum, bucket) => sum + bucket.fileCount, 0) + rootOrphans.fileCount;

  return {
    buckets: folderBuckets,
    rootOrphans,
    topLevelFolderCount: folderBuckets.length,
    totalBytes,
    fileCount,
    fileTypeTotals,
    fileTypeTotalsInFolders,
    fileTypeTotalsOrphans,
  };
}

function buildReviewerSummary(buckets: Bucket[], shards: Shard[]) {
  const shardByFolder = new Map<string, ShardId>();
  for (const shard of shards) {
    for (const bucket of shard.buckets) {
      shardByFolder.set(bucket.displayName, shard.shardId);
    }
  }

  const folderStats = buckets
    .map((bucket) => ({
      folderName: bucket.displayName,
      shardId: shardByFolder.get(bucket.displayName) ?? null,
      fileCount: bucket.fileCount,
      weight: bucket.weight,
      key: normalizedKey(bucket.displayName),
    }))
    .sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      if (b.fileCount !== a.fileCount) return b.fileCount - a.fileCount;
      return a.folderName.localeCompare(b.folderName, "es");
    });

  const heavyFolders = folderStats.slice(0, 12).map(({ key: _key, ...rest }) => {
    void _key;
    return rest;
  });

  const explicitFocusTargets = REVIEW_FOCUS_TARGETS.map((target) => {
    const normalizedTarget = normalizedKey(target);
    const found = folderStats.find((item) => item.key === normalizedTarget);
    return {
      folderName: target,
      found: Boolean(found),
      shardId: found?.shardId ?? null,
      fileCount: found?.fileCount ?? 0,
      weight: found?.weight ?? 0,
    };
  });

  const recommendedOrder = [
    ...folderStats.filter((item) => explicitFocusTargets.some((target) => normalizedKey(target.folderName) === item.key)),
    ...folderStats.slice(0, 20),
  ]
    .filter((item, index, array) => array.findIndex((other) => other.key === item.key) === index)
    .slice(0, 20)
    .map(({ key: _key, ...rest }) => {
      void _key;
      return rest;
    });

  return {
    explicitFocusTargets,
    heavyFolders,
    recommendedOrder,
  };
}

function buildShards(buckets: Bucket[]): Shard[] {
  const shards: Shard[] = Array.from({ length: SHARD_COUNT }, (_, index) => ({
    shardId: (index + 1) as ShardId,
    totalWeight: 0,
    totalFiles: 0,
    totalBytes: 0,
    bucketCount: 0,
    buckets: [],
  }));

  const sortedBuckets = [...buckets].sort(compareBucketsDesc);

  for (const bucket of sortedBuckets) {
    const shard = [...shards].sort(compareShardLoad)[0];
    bucket.shardId = shard.shardId;
    shard.totalWeight += bucket.weight;
    shard.totalFiles += bucket.fileCount;
    shard.totalBytes += bucket.totalBytes;
    shard.bucketCount += 1;
    shard.buckets.push(bucket);
  }

  for (const shard of shards) {
    shard.buckets.sort(compareBucketsDesc);
  }

  return shards;
}

function buildMarkdownReport(summary: ScanSummary) {
  const shardTable = summary.shards
    .map((shard) => {
      const folderNames = shard.buckets.map((bucket) => `\`${bucket.displayName}\``).join(", ");
      return `| ${shard.shardId} | ${shard.bucketCount} | ${shard.totalFiles} | ${shard.totalWeight} | ${formatBytes(shard.totalBytes)} | ${folderNames} |`;
    })
    .join("\n");

  const shardSections = summary.shards
    .map((shard) => {
      const folderLines = shard.buckets
        .map((bucket) => {
          const kindCounts = humanKindCounts(bucket.kindCounts);
          const kindSummary = Object.entries(kindCounts)
            .filter(([, count]) => count > 0)
            .map(([kind, count]) => `${kind}:${count}`)
            .join(", ");

          return [
            `- \`${bucket.displayName}\``,
            `  - files: ${bucket.fileCount}`,
            `  - weight: ${bucket.weight}`,
            `  - size: ${formatBytes(bucket.totalBytes)}`,
            `  - subfolders: ${bucket.subfolderCount}`,
            `  - kinds: ${kindSummary || "none"}`,
            `  - path: \`${bucket.relativePath}\``,
          ].join("\n");
        })
        .join("\n");

      return `## Shard ${shard.shardId}\n\n- total folders: ${shard.bucketCount}\n- total files: ${shard.totalFiles}\n- total weight: ${shard.totalWeight}\n- total size: ${formatBytes(shard.totalBytes)}\n\n${folderLines}`;
    })
    .join("\n\n");

  const reviewerTargets = summary.reviewerSummary.explicitFocusTargets
    .map(
      (item) =>
        `- \`${item.folderName}\` -> ${item.found ? `shard ${item.shardId}` : "not found"} · files: ${item.fileCount} · weight: ${item.weight}`,
    )
    .join("\n");

  const heavyFolders = summary.reviewerSummary.heavyFolders
    .map((item) => `- \`${item.folderName}\` -> shard ${item.shardId ?? "n/a"} · files: ${item.fileCount} · weight: ${item.weight}`)
    .join("\n");

  const recommendedOrder = summary.reviewerSummary.recommendedOrder
    .map((item, index) => `${index + 1}. \`${item.folderName}\` -> shard ${item.shardId ?? "n/a"} · files: ${item.fileCount} · weight: ${item.weight}`)
    .join("\n");

  const rootOrphanFilesPreview = summary.rootOrphans.files
    .slice(0, 20)
    .map((file) => `- \`${file.relativePath}\` (${file.kind}, ${formatBytes(file.sizeBytes)})`)
    .join("\n");

  const warnings = summary.coverage.warnings.length
    ? summary.coverage.warnings.map((warning) => `- ${warning}`).join("\n")
    : "- none";

  return [
    "# Master Folder Shard Plan",
    "",
    `- root folder: \`${summary.rootFolder}\``,
    `- generated at: ${summary.generatedAt}`,
    `- expected top-level folders: ${summary.expectedTopLevelFolderCount}`,
    `- top-level folders discovered: ${summary.topLevelFolderCount}`,
    `- root-orphans: ${summary.rootOrphans.fileCount}`,
    `- total files: ${summary.fileCount}`,
    `- total size: ${formatBytes(summary.totalBytes)}`,
    `- shards: ${summary.shards.length}`,
    `- matches expected folder count: ${summary.topLevelFolderCount === summary.expectedTopLevelFolderCount ? "yes" : "no"}`,
    "",
    "## Coverage",
    "",
    `- top-level folders assigned once: ${summary.coverage.allTopLevelFoldersAssignedOnce ? "yes" : "no"}`,
    `- files assigned once: ${summary.coverage.allFilesAssignedOnce ? "yes" : "no"}`,
    `- folders accounted for in shards: ${summary.coverage.topLevelFoldersAccountedFor}`,
    `- shard files accounted for: ${summary.coverage.shardFilesAccountedFor}`,
    `- root-orphan files accounted for: ${summary.coverage.rootOrphanFilesAccountedFor}`,
    `- files accounted for total: ${summary.coverage.totalFilesAccountedFor}`,
    `- duplicate assignments: ${summary.coverage.duplicateAssignments}`,
    `- missing assignments: ${summary.coverage.missingAssignments}`,
    "",
    "## File Type Totals",
    "",
    "| type | all evidence | in folders | root-orphans |",
    "|---|---:|---:|---:|",
    ...(Object.keys(summary.fileTypeTotals) as FileKind[]).map(
      (kind) =>
        `| ${kind} | ${summary.fileTypeTotals[kind]} | ${summary.fileTypeTotalsInFolders[kind]} | ${summary.fileTypeTotalsOrphans[kind]} |`,
    ),
    "",
    "## root-orphans",
    "",
    `- files: ${summary.rootOrphans.fileCount}`,
    `- size: ${formatBytes(summary.rootOrphans.totalBytes)}`,
    `- weight: ${summary.rootOrphans.weight}`,
    `- kinds: ${Object.entries(summary.rootOrphans.kindCounts)
      .filter(([, count]) => count > 0)
      .map(([kind, count]) => `${kind}:${count}`)
      .join(", ") || "none"}`,
    "",
    "### Sample root-orphan files",
    "",
    rootOrphanFilesPreview || "- none",
    "",
    "## Reviewer Summary",
    "",
    "### Explicit focus targets",
    "",
    reviewerTargets || "- none",
    "",
    "### Heavy folders",
    "",
    heavyFolders || "- none",
    "",
    "### Recommended audit order",
    "",
    recommendedOrder || "- none",
    "",
    "## Shard Balance",
    "",
    "| Shard | Folders | Files | Weight | Size | Assigned folders |",
    "|---|---:|---:|---:|---:|---|",
    shardTable,
    "",
    shardSections,
    "",
    "## Coverage Warnings",
    "",
    warnings,
    "",
    "## Notes",
    "",
    "- Buckets are assigned with a greedy longest-processing-time strategy using a composite weight per file.",
    "- Root-level stray files are reported separately in the `root-orphans` bucket and do not become an extra shard folder.",
    "- The report is read-only and does not modify the master folder or the database.",
  ].join("\n");
}

function buildJsonReport(summary: ScanSummary) {
  return JSON.stringify(summary, null, 2);
}

async function main() {
  const { rootFolder, outBase, printJson } = parseArgs();
  const scanned = await scanRoot(rootFolder);
  const shards = buildShards(scanned.buckets);
  const reviewerSummary = buildReviewerSummary(scanned.buckets, shards);

  const assignedFolderCount = shards.reduce((sum, shard) => sum + shard.bucketCount, 0);
  const assignedFileCount = shards.reduce((sum, shard) => sum + shard.totalFiles, 0);
  const totalAccountedFiles = assignedFileCount + scanned.rootOrphans.fileCount;
  const duplicateAssignments = Math.max(0, totalAccountedFiles - scanned.fileCount);
  const missingAssignments = Math.max(0, scanned.fileCount - totalAccountedFiles);
  const coverageWarnings: string[] = [];

  if (scanned.rootOrphans.fileCount > 0) {
    coverageWarnings.push(`Se detectaron ${scanned.rootOrphans.fileCount} archivos root-orphans y se reportan aparte de los 47 top-level folders.`);
  }

  if (scanned.topLevelFolderCount !== EXPECTED_TOP_LEVEL_FOLDERS) {
    coverageWarnings.push(
      `Se esperaban ${EXPECTED_TOP_LEVEL_FOLDERS} top-level folders, pero se descubrieron ${scanned.topLevelFolderCount}.`,
    );
  }

  const summary: ScanSummary = {
    rootFolder,
    generatedAt: new Date().toISOString(),
    topLevelFolderCount: scanned.topLevelFolderCount,
    expectedTopLevelFolderCount: EXPECTED_TOP_LEVEL_FOLDERS,
    bucketCount: scanned.buckets.length,
    fileCount: scanned.fileCount,
    totalBytes: scanned.totalBytes,
    rootOrphans: scanned.rootOrphans,
    fileTypeTotals: scanned.fileTypeTotals,
    fileTypeTotalsInFolders: scanned.fileTypeTotalsInFolders,
    fileTypeTotalsOrphans: scanned.fileTypeTotalsOrphans,
    reviewerSummary,
    shards,
    coverage: {
      allTopLevelFoldersAssignedOnce: assignedFolderCount === scanned.buckets.length,
      allFilesAssignedOnce: totalAccountedFiles === scanned.fileCount,
      topLevelFoldersAccountedFor: assignedFolderCount,
      shardFilesAccountedFor: assignedFileCount,
      rootOrphanFilesAccountedFor: scanned.rootOrphans.fileCount,
      totalFilesAccountedFor: totalAccountedFiles,
      duplicateAssignments,
      missingAssignments,
      warnings: coverageWarnings,
    },
  };

  const markdown = buildMarkdownReport(summary);
  const json = buildJsonReport(summary);

  if (outBase) {
    const resolvedBase = path.resolve(outBase);
    const jsonPath = resolvedBase.endsWith(".json") ? resolvedBase : `${resolvedBase}.json`;
    const mdPath = resolvedBase.endsWith(".md") ? resolvedBase : `${resolvedBase}.md`;
    await fs.mkdir(path.dirname(resolvedBase), { recursive: true });
    await fs.writeFile(jsonPath, json, "utf8");
    await fs.writeFile(mdPath, markdown, "utf8");
    console.log(`Informe JSON: ${jsonPath}`);
    console.log(`Informe MD: ${mdPath}`);
  } else {
    console.log(markdown);
    if (printJson) {
      console.log("");
      console.log(json);
    }
  }

  console.log("");
  console.log(`Top-level folders: ${summary.topLevelFolderCount}`);
  console.log(`Expected top-level folders: ${summary.expectedTopLevelFolderCount}`);
  console.log(`Root-orphans: ${summary.rootOrphans.fileCount}`);
  console.log(`Files scanned: ${summary.fileCount}`);
  console.log(`Shards: ${summary.shards.length}`);
  console.log(`Coverage OK: ${summary.coverage.allTopLevelFoldersAssignedOnce && summary.coverage.allFilesAssignedOnce ? "yes" : "no"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
