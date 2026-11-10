import fs from "node:fs";
import path from "node:path";

const sourceRoot = path.join(process.cwd(), "src");
const advancedBlobExports = new Set([
  "put", "list", "copy", "upload", "createMultipartUpload", "createMultipartUploader",
  "uploadPart", "completeMultipartUpload", "rename",
]);
const allowedImports = new Map([
  ["src/lib/blob-operations.ts", new Set(["put", "list", "copy"])],
  ["src/lib/pdf-capture-client.ts", new Set(["upload"])],
  ["src/app/api/nora/policy-pdf/upload/route.ts", new Set(["handleUpload"])],
]);
const violations = [];
const noScanHotPaths = new Set([
  "src/app/api/nora/policy-pdf/analyze/route.ts",
  "src/app/api/nora/policy-pdf/handoff/route.ts",
  "src/app/api/nora/policy-pdf/cleanup/route.ts",
]);

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(?:ts|tsx|js|jsx)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) inspect(file);
  }
}

function inspect(file) {
  const relative = path.relative(process.cwd(), file).split(path.sep).join("/");
  const contents = fs.readFileSync(file, "utf8");
  if (noScanHotPaths.has(relative) && /\b(?:trackedBlobList|cleanupExpiredNoraPolicyPdfUploads)\s*\(/.test(contents)) {
    violations.push(`${relative}: Nora request hot path must not scan Blob storage`);
  }
  for (const match of contents.matchAll(/import\s+(?!type\s+)([\s\S]*?)\s+from\s+["'](@vercel\/blob(?:\/client)?)["']/g)) {
    const clause = match[1];
    if (clause.includes("* as ")) {
      violations.push(`${relative}: namespace import bypasses Blob operation governance`);
      continue;
    }
    const names = [...clause.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)]
      .map((item) => item[1])
      .filter((name) => !["type", "as"].includes(name));
    const advanced = names.filter((name) => advancedBlobExports.has(name));
    if (advanced.length === 0) continue;
    const permitted = allowedImports.get(relative) ?? new Set();
    for (const name of advanced) {
      if (!permitted.has(name)) violations.push(`${relative}: direct ${name} import bypasses Blob operation governance`);
    }
  }
  const dynamicImports = [...contents.matchAll(/(?:import|require)\s*\(\s*["']@vercel\/blob(?:\/client)?["']\s*\)/g)];
  if (dynamicImports.length) violations.push(`${relative}: dynamic Blob SDK import bypasses Blob operation governance`);
}

walk(sourceRoot);
if (violations.length) {
  for (const violation of violations) console.error(violation);
  process.exitCode = 1;
} else {
  console.log("Blob operation governance PASS.");
}
