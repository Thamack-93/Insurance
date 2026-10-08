import "dotenv/config";

import { resetDemoOrganizationForCli } from "../src/lib/demo-organizations.ts";
import { parseDemoResetArguments } from "./demo-reset-arguments.ts";

function usage(): never {
  console.error("Uso: npm run demo:reset -- --organization-id <DEMO_ID> --request-id <ID> --reason <texto de al menos 8 caracteres> [--dry-run]");
  process.exit(2);
}

async function main() {
  const { organizationId, requestId, reason, dryRun, help } = parseDemoResetArguments(process.argv.slice(2));
  if (help) {
    console.log("Uso: npm run demo:reset -- --organization-id <DEMO_ID> --request-id <ID> --reason <texto de al menos 8 caracteres> [--dry-run]");
    return;
  }
  if (!organizationId || !requestId || !reason) usage();
  const result = await resetDemoOrganizationForCli(organizationId, requestId, dryRun, reason);
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

void main().catch((error) => {
  console.error(JSON.stringify({ ok: false, code: error instanceof Error ? error.message : "DEMO_RESET_FAILED" }));
  process.exitCode = 1;
});
