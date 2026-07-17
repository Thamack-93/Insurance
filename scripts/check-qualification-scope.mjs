import { execFileSync } from "node:child_process";
import path from "node:path";

const FORBIDDEN_PATTERNS = [
  { label: "assistant-api", regex: /^src\/app\/api\/assistant\// },
  { label: "nora-api", regex: /^src\/app\/api\/nora\// },
  { label: "assistant-dashboard-ui", regex: /^src\/app\/\(dashboard\)\/assistant\// },
  { label: "assistant-settings-ui", regex: /^src\/app\/\(dashboard\)\/settings\/assistant\// },
  { label: "assistant-ui", regex: /^src\/components\/assistant\// },
  { label: "policy-capture-ui", regex: /^src\/components\/policies\/policy-pdf-capture-panel\.tsx$/ },
  { label: "assistant-core", regex: /^src\/lib\/assistant(?:\.ts|-(?:ai|actions|guardrails|local|reports|types)\.ts)$/ },
  { label: "nora-core", regex: /^src\/lib\/nora(?:$|-)/ },
  { label: "pdf-capture-ai", regex: /^src\/lib\/policy-pdf-capture(?:$|-)/ },
  { label: "policy-capture-api", regex: /^src\/app\/api\/policies\/capture\// },
  { label: "policy-capture-ui-route", regex: /^src\/app\/\(dashboard\)\/policies\/capture\// },
  { label: "ai-env-example", regex: /^\.env\.example$/ },
];

const ALLOWED_TEST_PATTERNS = [
  /^tests\//,
  /^src\/lib\/.*\.test\.[cm]?[jt]sx?$/,
  /^src\/components\/.*\.test\.[cm]?[jt]sx?$/,
  /^src\/app\/.*\.test\.[cm]?[jt]sx?$/,
];

function normalizeRelativePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function getBaseRef() {
  const explicit =
    process.env.NORA_SCOPE_BASE_SHA?.trim() ||
    process.env.GITHUB_BASE_SHA?.trim() ||
    process.env.GITHUB_EVENT_PULL_REQUEST_BASE_SHA?.trim() ||
    process.env.GITHUB_EVENT_BEFORE?.trim();

  if (explicit && !/^0+$/.test(explicit)) {
    return explicit;
  }

  for (const ref of ["origin/main", "origin/master"]) {
    try {
      execFileSync("git", ["rev-parse", "--verify", ref], { stdio: "ignore" });
      return ref;
    } catch {
      // try the next fallback
    }
  }

  throw new Error("No se pudo determinar la base para validar el alcance de Nora.");
}

function getChangedFiles(baseRef) {
  const output = execFileSync("git", ["diff", "--name-only", `${baseRef}...HEAD`], {
    encoding: "utf8",
  });

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(normalizeRelativePath);
}

function isAllowedTestFile(filePath) {
  return ALLOWED_TEST_PATTERNS.some((pattern) => pattern.test(filePath));
}

function isForbiddenPath(filePath) {
  if (isAllowedTestFile(filePath)) return false;
  return FORBIDDEN_PATTERNS.some(({ regex }) => regex.test(filePath));
}

function main() {
  const baseRef = getBaseRef();
  const changedFiles = getChangedFiles(baseRef);
  const violations = changedFiles
    .filter(isForbiddenPath)
    .map((filePath) => {
      const match = FORBIDDEN_PATTERNS.find(({ regex }) => regex.test(filePath));
      return { filePath, label: match?.label ?? "forbidden" };
    });

  if (violations.length === 0) {
    console.log(`Alcance validado contra ${baseRef}. No hay cambios de producción en Nora.`);
    return;
  }

  console.error(`Se detectaron cambios de producción en Nora fuera del alcance de esta PR (base ${baseRef}):`);
  for (const violation of violations) {
    console.error(`- ${violation.filePath} [${violation.label}]`);
  }
  console.error("Mueve esos cambios a la PR separada de Nora y deja aquí solo tests, fixtures y CI.");
  process.exitCode = 1;
}

main();
