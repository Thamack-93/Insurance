import "dotenv/config";

import { resetDemoOrganizationForCli } from "../src/lib/demo-organizations.ts";

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

function usage(): never {
  console.error("Uso: npm run demo:reset -- --organization-id <DEMO_ID> --request-id <ID> [--dry-run] [--reason <texto>]");
  process.exit(2);
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log("Uso: npm run demo:reset -- --organization-id <DEMO_ID> --request-id <ID> [--dry-run] [--reason <texto>]");
    return;
  }
  const organizationId = option("--organization-id");
  const requestId = option("--request-id");
  if (!organizationId || !requestId) usage();
  const result = await resetDemoOrganizationForCli(organizationId, requestId, process.argv.includes("--dry-run"), option("--reason") ?? "operator CLI demo reset");
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

void main().catch((error) => {
  console.error(JSON.stringify({ ok: false, code: error instanceof Error ? error.message : "DEMO_RESET_FAILED" }));
  process.exitCode = 1;
});
