import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type Mode = "cache" | "artifacts";

type Target = {
  label: string;
  absolutePath: string;
};

const repoRoot = process.cwd();
const forbiddenRoots = [
  path.resolve(repoRoot, "data", "documents"),
  path.resolve(repoRoot, "data", "backups"),
];

function parseArgs(argv = process.argv.slice(2)) {
  const positionals: string[] = [];
  const flags = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }

    const [flag] = token.replace(/^--?/, "").split("=");
    flags.add(flag);
  }

  return {
    mode: (positionals[0] ?? "cache") as Mode,
    dryRun: flags.has("dry-run") || flags.has("dryrun"),
    includePlaywrightCache: flags.has("playwright"),
  };
}

function isWithinRoot(root: string, absolutePath: string) {
  const relative = path.relative(root, absolutePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function assertSafeTarget(target: Target) {
  const normalized = path.resolve(target.absolutePath);

  for (const forbidden of forbiddenRoots) {
    if (normalized === forbidden || normalized.startsWith(`${forbidden}${path.sep}`)) {
      throw new Error(`Refusing to touch protected path: ${target.label}`);
    }
  }

  const repoTarget = isWithinRoot(repoRoot, normalized);
  const playwrightHome = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  const playwrightFallback = path.join(os.homedir(), ".cache", "ms-playwright");
  const externalTarget = normalized === playwrightHome || normalized === playwrightFallback;

  if (!repoTarget && !externalTarget) {
    throw new Error(`Refusing to touch unapproved path: ${target.label}`);
  }
}

async function pathExists(absolutePath: string) {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function removeTarget(target: Target, dryRun: boolean) {
  assertSafeTarget(target);

  if (!(await pathExists(target.absolutePath))) {
    return { removed: false, reason: "missing" as const };
  }

  if (dryRun) {
    return { removed: true, reason: "dry-run" as const };
  }

  await fs.rm(target.absolutePath, { recursive: true, force: true });
  return { removed: true, reason: "deleted" as const };
}

async function collectTargets(mode: Mode, includePlaywrightCache: boolean): Promise<Target[]> {
  const targets: Target[] = [];

  if (mode === "cache") {
    targets.push(
      { label: ".next/dev/cache", absolutePath: path.resolve(repoRoot, ".next/dev/cache") },
      { label: ".next/cache", absolutePath: path.resolve(repoRoot, ".next/cache") },
    );
  }

  if (mode === "artifacts") {
    targets.push(
      { label: "test-results", absolutePath: path.resolve(repoRoot, "test-results") },
      { label: "playwright-report", absolutePath: path.resolve(repoRoot, "playwright-report") },
      { label: ".next/trace", absolutePath: path.resolve(repoRoot, ".next", "trace") },
      { label: ".next/trace-build", absolutePath: path.resolve(repoRoot, ".next", "trace-build") },
    );

    const nextRoot = path.resolve(repoRoot, ".next");
    if (await pathExists(nextRoot)) {
      const entries = await fs.readdir(nextRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith("_events_") && entry.name.endsWith(".json")) {
          targets.push({
            label: `.next/${entry.name}`,
            absolutePath: path.join(nextRoot, entry.name),
          });
        }
      }
    }

    const nextDevDir = path.resolve(repoRoot, ".next", "dev");
    if (await pathExists(nextDevDir)) {
      const entries = await fs.readdir(nextDevDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith("trace-")) {
          targets.push({
            label: `.next/dev/${entry.name}`,
            absolutePath: path.join(nextDevDir, entry.name),
          });
        }
      }
    }
  }

  if (includePlaywrightCache) {
    const playwrightCandidates = [
      path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
      path.join(os.homedir(), ".cache", "ms-playwright"),
    ];

    for (const candidate of playwrightCandidates) {
      if (await pathExists(candidate)) {
        targets.push({
          label: candidate,
          absolutePath: candidate,
        });
        break;
      }
    }
  }

  return targets;
}

async function main() {
  const { mode, dryRun, includePlaywrightCache } = parseArgs();

  if (mode !== "cache" && mode !== "artifacts") {
    console.error("Modo invalido. Usa `cache` o `artifacts`.");
    process.exit(1);
  }

  const targets = await collectTargets(mode, includePlaywrightCache);
  if (targets.length === 0) {
    console.log("No se encontraron caches o artefactos para limpiar.");
    return;
  }

  console.log(`PolicyDesk cache hygiene`);
  console.log(`Modo: ${mode}`);
  console.log(`Dry run: ${dryRun ? "si" : "no"}`);
  console.log(`Playwright externo: ${includePlaywrightCache ? "si" : "no"}`);

  const results = await Promise.all(
    targets.map(async (target) => {
      const result = await removeTarget(target, dryRun);
      return { target, ...result };
    }),
  );

  const removed = results.filter((entry) => entry.removed);
  const skipped = results.filter((entry) => !entry.removed);

  if (removed.length > 0) {
    console.log("");
    console.log("Elementos afectados:");
    for (const entry of removed) {
      console.log(`- ${entry.target.label} (${entry.reason})`);
    }
  }

  if (skipped.length > 0) {
    console.log("");
    console.log("Elementos omitidos:");
    for (const entry of skipped) {
      console.log(`- ${entry.target.label} (${entry.reason})`);
    }
  }
}

main().catch((error) => {
  console.error("Error al limpiar caches.");
  console.error(error);
  process.exit(1);
});
