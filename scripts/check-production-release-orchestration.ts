import fs from "node:fs";

const issues: string[] = [];
const build = fs.readFileSync("scripts/vercel-build.mjs", "utf8");
const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8")) as { git?: { deploymentEnabled?: Record<string, boolean> } };
const release = fs.readFileSync(".github/workflows/production-release.yml", "utf8");
const cutover = fs.readFileSync(".github/workflows/production-runtime-role-cutover.yml", "utf8");
const cleanup = fs.readFileSync(".github/workflows/production-recovery-cleanup.yml", "utf8");

function requireText(source: string, needle: string, label: string) {
  if (!source.includes(needle)) issues.push(`${label}: falta ${needle}`);
}

function requireOrder(source: string, needles: string[], label: string) {
  let previous = -1;
  for (const needle of needles) {
    const current = source.indexOf(needle);
    if (current < 0 || current <= previous) {
      issues.push(`${label}: orden inválido cerca de ${needle}`);
      return;
    }
    previous = current;
  }
}

if (/prisma\s*,\s*["']migrate|prisma migrate deploy/.test(build)) issues.push("vercel-build: Preview/Production build no debe migrar");
requireOrder(build, ["--runtime-only", 'npmCommand, ["run", "build"]'], "vercel-build");
if (vercel.git?.deploymentEnabled?.main !== false) issues.push("vercel.json: main debe tener auto-deploy Git desactivado");
if (Object.keys(vercel.git?.deploymentEnabled ?? {}).some((branch) => branch !== "main")) issues.push("vercel.json: Preview no debe desactivarse globalmente");

for (const [label, workflow] of [["release", release], ["cutover", cutover], ["cleanup", cleanup]] as const) {
  requireText(workflow, "environment: production", label);
  requireText(workflow, "cancel-in-progress: false", label);
  requireText(workflow, "github.ref == 'refs/heads/main'", label);
}
requireText(release, "deployment-branch-policies", "release");
requireText(cutover, "deployment-branch-policies", "cutover");
requireOrder(release, [
  "Fail closed on SHA",
  "Verify restricted runtime baseline before any mutation",
  "Verify Production Neon topology before recovery mutation",
  "create protected recovery branch",
  "npx prisma migrate deploy",
  "--apply --json",
  "provision:database-runtime-role -- --apply",
  'DATABASE_URL="${{ secrets.DATABASE_RUNTIME_URL }}" npm run check:deployment-db-safety',
  '"$VERCEL_CLI" build',
  '"$VERCEL_CLI" deploy --prebuilt --prod --skip-domain',
  "smoke:production-release",
  "Inspect candidate runtime logs",
  "promote \"$NEW_DEPLOYMENT_URL\"",
], "release");
requireText(release, "Verify restricted alias remained unchanged on failed smoke", "release");
requireText(cutover, 'deploy --prebuilt --prod --skip-domain', "cutover");
requireOrder(cutover, ["smoke:production-release", 'promote "$CUTOVER_DEPLOYMENT_URL"'], "cutover");
requireText(cleanup, 'gh run download "$RELEASE_RUN_ID"', "cleanup");
requireOrder(cleanup, ["recoveryBranchId", ".branch.parent_id", "-X DELETE"], "cleanup");

if (issues.length > 0) {
  issues.forEach((issue) => console.error(issue));
  process.exitCode = 1;
} else {
  console.log("Production release orchestration PASS");
}
