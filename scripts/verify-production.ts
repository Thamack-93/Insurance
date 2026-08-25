import "dotenv/config";

import { verifyProductionState } from "../src/lib/production-verifier.ts";

const connectionString = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
const json = process.argv.includes("--json");

function printHuman(report: Awaited<ReturnType<typeof verifyProductionState>>) {
  console.log(`Production verification: ${report.status}`);
  console.log(`Tenant mode: ${report.tenantMode}`);
  for (const [name, section] of Object.entries(report.sections)) {
    const status = typeof section.status === "string" ? section.status : "UNKNOWN";
    console.log(`${name}: ${status}`);
  }
  for (const item of report.issues) console.log(`${item.severity}: ${item.code} - ${item.message}`);
}

async function main() {
  if (!connectionString) {
    const report = {
      status: "BLOCKED",
      generatedAt: new Date().toISOString(),
      tenantMode: process.env.PRODUCTION_EXPECTED_TENANT_MODE ?? "single-org",
      sections: {},
      issues: [{ code: "DATABASE_URL_REQUIRED", severity: "BLOCKED", message: "DATABASE_URL_UNPOOLED o DATABASE_URL es obligatorio." }],
    };
    if (json) console.log(JSON.stringify(report, null, 2));
    else printHuman(report as Awaited<ReturnType<typeof verifyProductionState>>);
    process.exitCode = 1;
    return;
  }

  const report = await verifyProductionState(connectionString);
  if (json) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  if (report.status === "BLOCKED") process.exitCode = 1;
}

void main().catch(() => {
  const report = {
    status: "BLOCKED",
    generatedAt: new Date().toISOString(),
    tenantMode: process.env.PRODUCTION_EXPECTED_TENANT_MODE ?? "single-org",
    sections: {},
    issues: [{ code: "PRODUCTION_VERIFIER_FAILED", severity: "BLOCKED", message: "La verificación Production no pudo completarse." }],
  };
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.error("Production verification: BLOCKED");
    console.error("BLOCKED: PRODUCTION_VERIFIER_FAILED - La verificación Production no pudo completarse.");
  }
  process.exitCode = 1;
});
