import fs from "node:fs";
import path from "node:path";

const root = path.resolve("src/app/api");
const manifestSource = fs.readFileSync(path.resolve("src/lib/api-security.ts"), "utf8");
const manifest = new Set([...manifestSource.matchAll(/^\s*"(\/api\/[^\"]+)"\s*:/gm)].map((m) => m[1]));

function walk(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else if (entry.isFile() && entry.name === "route.ts") result.push(full);
  }
  return result;
}

function routePath(file) {
  const relative = path.relative(root, path.dirname(file));
  const segments = relative.split(path.sep).filter(Boolean);
  return "/api/" + segments.map((segment) => segment.startsWith("[") ? segment : segment).join("/");
}

const issues = [];
for (const file of walk(root)) {
  const source = fs.readFileSync(file, "utf8");
  const route = routePath(file);
  const methods = [...source.matchAll(/^export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS)\b/gm)].map((m) => m[1]);
  if (!methods.length) issues.push(`${route}: no exported HTTP method`);
  if (!manifest.has(route)) issues.push(`${route}: missing from API_SECURITY_MANIFEST (methods: ${methods.join(",")})`);
}

for (const route of manifest) {
  const expected = path.join(root, route.replace(/^\/api\//, "").split("/").join(path.sep), "route.ts");
  if (!fs.existsSync(expected)) issues.push(`${route}: manifest entry has no route.ts`);
}

if (issues.length) {
  console.error(`API security manifest: FAIL (${issues.length} issue(s))`);
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}
console.log(`API security manifest: PASS (${manifest.size} routes covered).`);
