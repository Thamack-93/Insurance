import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(path.join(root, "vercel.json"), "utf8"));
const cronRoutes = config.crons ?? [];
if (!Array.isArray(cronRoutes) || cronRoutes.length === 0) {
  throw new Error("CRON_MAINTENANCE_GATE_REQUIRES_SCHEDULED_ROUTES");
}

for (const cron of cronRoutes) {
  if (typeof cron.path !== "string" || !cron.path.startsWith("/api/")) {
    throw new Error("CRON_MAINTENANCE_GATE_ROUTE_PATH_INVALID");
  }
  const routeFile = path.join(root, "src/app", cron.path.slice(1), "route.ts");
  const source = await readFile(routeFile, "utf8");
  const gateCall = /return\s+withPlatformCronAdmission\s*\(\s*async\s*\(\s*\)\s*=>/s.exec(source);
  const authCheck = /if\s*\(\s*!\s*(?:hasValidCronSecret|authorized)\(request\)\s*\)/s.exec(source);
  if (!gateCall || !authCheck || authCheck.index > gateCall.index) {
    throw new Error(`CRON_MAINTENANCE_GATE_MISSING:${cron.path}`);
  }
}

console.log(JSON.stringify({ ok: true, gatedCronRoutes: cronRoutes.length }));
