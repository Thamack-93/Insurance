import { spawnSync } from "node:child_process";

const result = spawnSync("npx", ["prisma", "migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code"], {
  cwd: process.cwd(),
  env: process.env,
  encoding: "utf8",
});

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
if (result.error) throw result.error;
if (result.status === 0) {
  process.stdout.write(output);
  process.stdout.write("Prisma drift PASS.\n");
  process.exit(0);
}

// The cutover migration deliberately installs tenant composite FKs, tenant
// uniqueness indexes, RLS, and a few operational defaults through SQL that
// Prisma cannot model in the declarative schema. Keep an exact allowlist for
// those expected differences while rejecting every other drift line.
const allowedModels = new Set([
  "AssistantAiAttempt", "AssistantAiRun", "AssistantReport", "AssistantReportSignal",
  "Claim", "ClaimChecklistItem", "Client", "Commission", "DataQualitySuppressionRule", "Insurer",
  "Document", "KnowledgeChunk", "KnowledgeSource", "LedgerImportAction", "LedgerImportBatch",
  "LedgerImportIssue", "LedgerImportRow", "MaintenanceRun", "NotificationEvent", "Payment",
  "Policy", "PolicyEndorsement", "PolicyInsuredAsset", "PolicyInsuredParty",
  "PolicyRenewalSuggestion", "Quote", "Receipt", "ReceiptReconciliationIssue", "Task", "WorkItem",
]);
const allowedDefaultModels = new Set(["DemoOrganizationState", "OrganizationCapability", "OrganizationSetting", "PlatformRuntimeState", "UserPreference"]);
const allowedIndexModels = new Set(["DemoOrganizationState", "DemoUploadArtifact", "OrganizationCapability"]);

let currentModel = null;
const unexpected = [];
for (const line of output.split(/\r?\n/)) {
  const modelMatch = line.match(/^\[\*\] Changed the `([^`]+)` table$/);
  if (modelMatch) {
    currentModel = modelMatch[1];
    continue;
  }
  if (!line.trim() || line.startsWith("Loaded Prisma config") || line.startsWith("Datasource ")) continue;
  if (line.trim() === "[-] Removed tables" || line.trim() === "- __policydesk_tenant_isolation_run") continue;
  if (line.includes("Removed foreign key on columns (organizationId,")) {
    if (!currentModel || !allowedModels.has(currentModel)) unexpected.push(`${currentModel ?? "unknown"}: ${line}`);
    continue;
  }
  if (line.includes("Removed unique index on columns (organizationId, id)")) {
    if (!currentModel || !allowedModels.has(currentModel)) unexpected.push(`${currentModel ?? "unknown"}: ${line}`);
    continue;
  }
  if (line.includes("Removed index on columns (organizationId)")) {
    if (!currentModel || !allowedIndexModels.has(currentModel)) unexpected.push(line);
    continue;
  }
  if (line.includes("Altered column `updatedAt` (default changed from")) {
    if (!currentModel || !allowedDefaultModels.has(currentModel)) unexpected.push(line);
    continue;
  }
  if (line.trim().startsWith("[*] Changed the `") || line.trim().startsWith("[-] Removed ")) {
    unexpected.push(line);
    continue;
  }
  if (line.trim().startsWith("[+]")) unexpected.push(line);
}

if (unexpected.length > 0) {
  process.stderr.write(output);
  process.stderr.write(`Unexpected drift lines:\n${unexpected.join("\n")}\n`);
  process.stderr.write(`Prisma drift FAIL: ${unexpected.length} unexpected line(s).\n`);
  process.exit(2);
}

process.stdout.write("Prisma drift PASS (declared tenant cutover SQL differences only).\n");
