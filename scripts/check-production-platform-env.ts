import fs from "node:fs";
import path from "node:path";
import { categoryFor, evaluateProductionEnv, type ProductionEnvProfile } from "../src/lib/production-env.ts";

const isProductionRelease = process.env.VERCEL_ENV === "production" || process.env.RELEASE_ENVIRONMENT === "production";
const json = process.argv.includes("--json");
const profile: ProductionEnvProfile = process.argv.includes("--profile=verification") ? "verification" : "runtime";

function collectStaticNames(directory: string): Set<string> {
  const names = new Set<string>();
  if (!fs.existsSync(directory)) return names;
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, item.name);
    if (item.isDirectory()) {
      for (const name of collectStaticNames(fullPath)) names.add(name);
      continue;
    }
    if (!/\.(?:ts|tsx|mjs|js)$/.test(item.name)) continue;
    const source = fs.readFileSync(fullPath, "utf8");
    for (const match of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(match[1]);
  }
  return names;
}

function knownNames(): Set<string> {
  const names = new Set<string>();
  const example = path.join(process.cwd(), ".env.example");
  if (fs.existsSync(example)) {
    for (const line of fs.readFileSync(example, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/);
      if (match) names.add(match[1]);
    }
  }
  for (const directory of [path.join(process.cwd(), "src"), path.join(process.cwd(), "scripts")]) {
    for (const name of collectStaticNames(directory)) names.add(name);
  }
  return names;
}

if (!isProductionRelease) {
  const report = { profile, production: false, entries: [], failures: [], message: "Production environment check skipped outside Production." };
  console.log(json ? JSON.stringify(report, null, 2) : report.message);
} else {
  const evaluated = evaluateProductionEnv(process.env, profile);
  const entries = [...evaluated.entries];
  for (const name of knownNames()) {
    if (entries.some((item) => item.name === name)) continue;
    entries.push({
      name,
      category: categoryFor(name),
      required: false,
      state: process.env[name]?.trim() ? "configured" : "not-configured",
      reason: "Referenced by the repository or documented as optional; no production assertion is made.",
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const report = { profile, production: true, generatedAt: new Date().toISOString(), entries, failures: evaluated.failures };
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Production environment contract: ${report.failures.length ? "BLOCKED" : "PASS"}`);
    for (const item of entries.filter((item) => item.required || item.state === "invalid")) console.log(`${item.state.toUpperCase()}: ${item.name} (${item.reason})`);
  }
  if (report.failures.length) process.exitCode = 1;
}
