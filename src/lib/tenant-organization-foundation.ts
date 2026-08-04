import type { PoolClient } from "pg";

export const SYSTEM_USER_ID = "system-user-0000";
export const BOOTSTRAP_ORGANIZATION_ID = "org_legacy_singleton_0001";
export const BOOTSTRAP_ORGANIZATION_NAME = "PolicyDesk Legacy Organization";
export const BOOTSTRAP_ORGANIZATION_SLUG = "legacy-singleton";
export const BOOTSTRAP_TIME_ZONE = "Etc/GMT+6";
export const BOOTSTRAP_CURRENCY = "MXN";
export const BACKFILL_LOCK_KEY = "policydesk-organization-backfill";

/** Explicit Cycle 1 inventory. A new tenant model must be added here and to the SQL migration. */
export const PROTECTED_TENANT_TABLES = [
  "Client", "Insurer", "Policy", "Receipt", "PolicyEndorsement", "Payment", "Commission", "Task", "WorkItem", "Claim", "Quote", "Document", "ActivityLog", "AssistantActionDraft", "NotificationChannel", "NotificationPreference", "NotificationEvent", "PolicyInsuredParty", "PolicyInsuredAsset", "TelegramLinkToken", "LedgerImportBatch", "LedgerImportRow", "LedgerImportAction", "LedgerImportIssue", "TelegramDraft", "MaintenanceRun", "ReceiptReconciliationIssue", "PolicyRenewalSuggestion", "DataQualitySuppressionRule", "AssistantReport", "AssistantReportSignal", "AssistantAiRun", "AssistantAiAttempt", "Alert", "SecurityEventAggregate", "TelegramWebhookUpdate",
] as const;

export const EXPECTED_TENANT_TRIGGERS = Object.fromEntries(
  PROTECTED_TENANT_TABLES.map((table) => [table, `${table}_transition_singleton_organization`]),
) as Record<(typeof PROTECTED_TENANT_TABLES)[number], string>;

const relationChecks: Array<[string, string, string]> = [
  ["Client", "referidorId", "Client"],
  ["Policy", "familyRootId", "Policy"], ["Policy", "renewedFromPolicyId", "Policy"],
  ["Policy", "clientId", "Client"], ["Policy", "insurerId", "Insurer"],
  ["Receipt", "policyId", "Policy"], ["Receipt", "clientId", "Client"], ["Receipt", "insurerId", "Insurer"],
  ["PolicyEndorsement", "policyId", "Policy"], ["Payment", "receiptId", "Receipt"], ["Payment", "policyId", "Policy"], ["Payment", "clientId", "Client"],
  ["Commission", "policyId", "Policy"], ["Commission", "receiptId", "Receipt"], ["Commission", "clientId", "Client"], ["Commission", "insurerId", "Insurer"],
  ["Task", "clientId", "Client"], ["Task", "policyId", "Policy"], ["Task", "insurerId", "Insurer"], ["Task", "receiptId", "Receipt"],
  ["WorkItem", "clientId", "Client"], ["WorkItem", "policyId", "Policy"], ["WorkItem", "insurerId", "Insurer"], ["WorkItem", "receiptId", "Receipt"],
  ["Claim", "clientId", "Client"], ["Claim", "policyId", "Policy"], ["Claim", "insurerId", "Insurer"],
  ["Quote", "clientId", "Client"], ["Quote", "insurerId", "Insurer"],
  ["Document", "clientId", "Client"], ["Document", "policyId", "Policy"], ["Document", "endorsementId", "PolicyEndorsement"], ["Document", "receiptId", "Receipt"], ["Document", "taskId", "Task"], ["Document", "claimId", "Claim"], ["Document", "quoteId", "Quote"],
  ["PolicyInsuredParty", "policyId", "Policy"], ["PolicyInsuredAsset", "policyId", "Policy"],
  ["NotificationEvent", "workItemId", "WorkItem"], ["NotificationEvent", "clientId", "Client"], ["NotificationEvent", "policyId", "Policy"], ["NotificationEvent", "receiptId", "Receipt"],
  ["LedgerImportRow", "batchId", "LedgerImportBatch"], ["LedgerImportRow", "policyId", "Policy"], ["LedgerImportRow", "receiptId", "Receipt"], ["LedgerImportRow", "paymentId", "Payment"],
  ["LedgerImportAction", "batchId", "LedgerImportBatch"], ["LedgerImportAction", "rowId", "LedgerImportRow"], ["LedgerImportIssue", "batchId", "LedgerImportBatch"], ["LedgerImportIssue", "rowId", "LedgerImportRow"], ["LedgerImportIssue", "suppressedByRuleId", "DataQualitySuppressionRule"],
  ["TelegramDraft", "channelId", "NotificationChannel"],
  ["ReceiptReconciliationIssue", "maintenanceRunId", "MaintenanceRun"], ["ReceiptReconciliationIssue", "receiptId", "Receipt"], ["ReceiptReconciliationIssue", "policyId", "Policy"], ["ReceiptReconciliationIssue", "suppressedByRuleId", "DataQualitySuppressionRule"],
  ["PolicyRenewalSuggestion", "maintenanceRunId", "MaintenanceRun"], ["PolicyRenewalSuggestion", "sourcePolicyId", "Policy"], ["PolicyRenewalSuggestion", "targetPolicyId", "Policy"], ["PolicyRenewalSuggestion", "suppressedByRuleId", "DataQualitySuppressionRule"],
  ["AssistantReport", "parentReportId", "AssistantReport"], ["AssistantReportSignal", "reportId", "AssistantReport"], ["AssistantAiRun", "reportId", "AssistantReport"], ["AssistantAiAttempt", "runId", "AssistantAiRun"],
];

export type TenantAuditOptions = { requireActive?: boolean; guardsOnly?: boolean };
export type TenantAuditResult = { ok: boolean; issues: string[]; summary: Record<string, number | string | boolean> };

function identifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function auditTenantFoundation(client: PoolClient, options: TenantAuditOptions = {}): Promise<TenantAuditResult> {
  const issues: string[] = [];
  const summary: Record<string, number | string | boolean> = {};
  if (!options.guardsOnly) {
  const organizations = await client.query<{ id: string; status: string }>(`SELECT "id", "status" FROM "Organization" ORDER BY "id"`);
  summary.organizationCount = organizations.rowCount ?? 0;
  if (organizations.rowCount !== 1) issues.push("expected exactly one Organization");
  const organization = organizations.rows[0];
  if (organization && organization.id !== BOOTSTRAP_ORGANIZATION_ID) issues.push("Organization id is not the deterministic bootstrap id");
  if (options.requireActive !== false && organization?.status !== "ACTIVE") issues.push("Organization status is not ACTIVE");
  summary.organizationStatus = organization?.status ?? "MISSING";

  const owners = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "OrganizationMembership" m JOIN "User" u ON u."id" = m."userId" WHERE m."organizationId" = $1 AND m."role" = 'OWNER' AND m."active" AND u."active"`, [BOOTSTRAP_ORGANIZATION_ID]);
  const ownerCount = Number(owners.rows[0]?.count ?? 0);
  summary.activeOwnerCount = ownerCount;
  if (ownerCount < 1) issues.push("no active Owner membership");
  if (ownerCount > 1) issues.push("more than one active Owner membership");
  const allOwners = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "OrganizationMembership" WHERE "organizationId" = $1 AND "role" = 'OWNER'`, [BOOTSTRAP_ORGANIZATION_ID]);
  if (Number(allOwners.rows[0]?.count ?? 0) > 1) issues.push("more than one Owner membership exists");
  const ownerLegacyRole = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "OrganizationMembership" m JOIN "User" u ON u."id" = m."userId" WHERE m."organizationId" = $1 AND m."role" = 'OWNER' AND (u."role" <> 'ADMIN' OR NOT u."active")`, [BOOTSTRAP_ORGANIZATION_ID]);
  if (Number(ownerLegacyRole.rows[0]?.count ?? 0) > 0) issues.push("active Owner is not backed by an active legacy ADMIN user");

  const missingMemberships = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "User" u LEFT JOIN "OrganizationMembership" m ON m."userId" = u."id" AND m."organizationId" = $1 WHERE u."id" <> $2 AND m."id" IS NULL`, [BOOTSTRAP_ORGANIZATION_ID, SYSTEM_USER_ID]);
  const missing = Number(missingMemberships.rows[0]?.count ?? 0);
  summary.usersMissingMembership = missing;
  if (missing > 0) issues.push(`${missing} non-technical users without membership`);

  for (const table of PROTECTED_TENANT_TABLES) {
    const nullResult = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${identifier(table)} WHERE "organizationId" IS NULL`);
    const nullCount = Number(nullResult.rows[0]?.count ?? 0);
    summary[`${table}.nullOrganizationId`] = nullCount;
    if (nullCount > 0) issues.push(`${table} has ${nullCount} rows without organizationId`);
    const dangling = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${identifier(table)} t LEFT JOIN "Organization" o ON o."id" = t."organizationId" WHERE t."organizationId" IS NOT NULL AND o."id" IS NULL`);
    const danglingCount = Number(dangling.rows[0]?.count ?? 0);
    if (danglingCount > 0) issues.push(`${table} has dangling organization references`);
  }

  for (const [child, column, parent] of relationChecks) {
    const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${identifier(child)} c JOIN ${identifier(parent)} p ON p."id" = c.${identifier(column)} WHERE c.${identifier(column)} IS NOT NULL AND c."organizationId" IS NOT NULL AND p."organizationId" IS NOT NULL AND c."organizationId" <> p."organizationId"`);
    if (Number(result.rows[0]?.count ?? 0) > 0) issues.push(`${child}.${column} crosses organizations`);
  }

  const portfolio = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "Client" c LEFT JOIN "User" u ON u."id" = c."portfolioOwnerId" LEFT JOIN "OrganizationMembership" m ON m."userId" = c."portfolioOwnerId" AND m."organizationId" = c."organizationId" AND m."active" WHERE c."portfolioOwnerId" IS NOT NULL AND (u."id" IS NULL OR m."id" IS NULL)`);
  if (Number(portfolio.rows[0]?.count ?? 0) > 0) issues.push("portfolio owners do not belong to the organization");
  const assigned = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "WorkItem" w LEFT JOIN "User" u ON u."id" = w."assignedToId" LEFT JOIN "OrganizationMembership" m ON m."userId" = w."assignedToId" AND m."organizationId" = w."organizationId" AND m."active" WHERE w."assignedToId" IS NOT NULL AND (u."id" IS NULL OR m."id" IS NULL)`);
  if (Number(assigned.rows[0]?.count ?? 0) > 0) issues.push("assigned users do not belong to the organization");
  }

  const functionResult = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'policydesk_assign_singleton_organization'`);
  if (Number(functionResult.rows[0]?.count ?? 0) !== 1) issues.push("singleton assignment function is missing");
  const triggerNames = [...Object.values(EXPECTED_TENANT_TRIGGERS), "User_transition_membership_sync", "User_transition_owner_delete_guard", "OrganizationMembership_transition_guard", "Organization_transition_delete_guard", "Organization_transition_truncate_guard"];
  const triggerResult = await client.query<{ tgname: string; tgenabled: string }>(`SELECT t.tgname, t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgname = ANY($1::text[])`, [triggerNames]);
  const installed = new Map(triggerResult.rows.map((row) => [row.tgname, row.tgenabled]));
  for (const trigger of triggerNames) {
    if (!installed.has(trigger)) issues.push(`expected trigger ${trigger} is missing`);
    else if (installed.get(trigger) !== "O") issues.push(`trigger ${trigger} is not a normal enabled trigger`);
  }
  const indexes = await client.query<{ indexname: string; indexdef: string }>(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1::text[])`, ["Organization_transition_singleton_idx", "OrganizationMembership_transition_owner_idx"]);
  const indexNames = new Set(indexes.rows.map((row) => row.indexname));
  if (!indexNames.has("Organization_transition_singleton_idx")) issues.push("singleton expression index is missing");
  if (!indexNames.has("OrganizationMembership_transition_owner_idx")) issues.push("Owner singleton index is missing");
  for (const index of indexes.rows) if (!index.indexdef.includes("((1))")) issues.push(`${index.indexname} is not the expected constant expression index`);

  return { ok: issues.length === 0, issues, summary };
}
