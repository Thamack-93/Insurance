import type { PoolClient } from "pg";

export const SYSTEM_USER_ID = "system-user-0000";
export const BOOTSTRAP_ORGANIZATION_ID = "org_legacy_singleton_0001";
export const BACKFILL_LOCK_KEY = "policydesk-organization-backfill";
const MIGRATIONS_TABLE = "_prisma_migrations";

/**
 * Explicit Cycle 1 inventory. New models must be classified here before they
 * can be merged. Only protected tables receive the temporary assignment
 * trigger; global tables are deliberately outside the singleton boundary.
 */
export const PROTECTED_TENANT_TABLES = [
  "Client", "Insurer", "Policy", "Receipt", "PolicyEndorsement", "Payment", "Commission", "Task", "WorkItem", "Claim", "ClaimChecklistItem", "Quote", "Document", "ActivityLog", "AssistantActionDraft", "NotificationPreference", "NotificationEvent", "PolicyInsuredParty", "PolicyInsuredAsset", "TelegramLinkToken", "LedgerImportBatch", "LedgerImportRow", "LedgerImportAction", "LedgerImportIssue", "TelegramDraft", "MaintenanceRun", "ReceiptReconciliationIssue", "PolicyRenewalSuggestion", "DataQualitySuppressionRule", "AssistantReport", "AssistantReportSignal", "AssistantAiRun", "AssistantAiAttempt", "KnowledgeSource", "KnowledgeChunk", "Alert", "CommissionStatement", "CommissionStatementRow", "CommissionCorrection", "QuoteComparison", "QuoteComparisonItem", "CurrencyRate",
] as const;

/**
 * Operational metadata may be attributed to an organization, but is never
 * auto-tagged by the singleton transition trigger. Restore tooling must keep
 * these control rows outside tenant data replacement.
 */
export const OPTIONAL_ORGANIZATION_TABLES = [
  "SecurityEventAggregate",
  "BackupArtifact",
  "OrganizationRestoreRun",
  "OrganizationSubscription",
  "BillingCharge",
  "OrganizationCapability",
  "OrganizationSetting",
  "DemoOrganizationState",
  "DemoUploadArtifact",
] as const;

/** These rows are platform-scoped and must not acquire a Cycle 1 organization column. */
export const PLATFORM_GLOBAL_TABLES = ["User", "Organization", "OrganizationMembership", "Plan", "PlatformAuditLog", "SystemSetting", "NotificationChannel", "TelegramWebhookUpdate", "GeneralKnowledgeSource", "GeneralKnowledgeChunk", "Session", "UserPreference", "PlatformRuntimeState"] as const;

export const EXPECTED_TENANT_TRIGGERS = Object.fromEntries(
  PROTECTED_TENANT_TABLES.map((table) => [table, `${table}_transition_singleton_organization`]),
) as Record<(typeof PROTECTED_TENANT_TABLES)[number], string>;

export const CUTOVER_REMOVED_TENANT_TRIGGER_TABLES = [
  "ClaimChecklistItem",
  "KnowledgeSource",
  "KnowledgeChunk",
] as const;
export const CUTOVER_TRIGGER_REMOVAL_MIGRATION = "20261009010000_multi_org_drop_remaining_transition_triggers";

export function tenantTriggersForMigrationState(cutoverTriggerRemovalApplied: boolean) {
  return Object.entries(EXPECTED_TENANT_TRIGGERS).filter(([table]) =>
    !cutoverTriggerRemovalApplied || !CUTOVER_REMOVED_TENANT_TRIGGER_TABLES.includes(table as (typeof CUTOVER_REMOVED_TENANT_TRIGGER_TABLES)[number]),
  );
}

export const TENANT_RELATION_CHECKS: ReadonlyArray<readonly [string, string, string]> = [
  ["Client", "referidorId", "Client"],
  ["Policy", "familyRootId", "Policy"], ["Policy", "renewedFromPolicyId", "Policy"],
  ["Policy", "clientId", "Client"], ["Policy", "insurerId", "Insurer"],
  ["Receipt", "policyId", "Policy"], ["Receipt", "clientId", "Client"], ["Receipt", "insurerId", "Insurer"], ["Receipt", "endorsementId", "PolicyEndorsement"], ["Receipt", "documentId", "Document"],
  ["PolicyEndorsement", "policyId", "Policy"], ["PolicyEndorsement", "documentId", "Document"], ["Payment", "receiptId", "Receipt"], ["Payment", "policyId", "Policy"], ["Payment", "clientId", "Client"],
  ["Commission", "policyId", "Policy"], ["Commission", "receiptId", "Receipt"], ["Commission", "clientId", "Client"], ["Commission", "insurerId", "Insurer"],
  ["Task", "clientId", "Client"], ["Task", "policyId", "Policy"], ["Task", "insurerId", "Insurer"], ["Task", "receiptId", "Receipt"],
  ["WorkItem", "clientId", "Client"], ["WorkItem", "policyId", "Policy"], ["WorkItem", "insurerId", "Insurer"], ["WorkItem", "receiptId", "Receipt"],
  ["Claim", "clientId", "Client"], ["Claim", "policyId", "Policy"], ["Claim", "insurerId", "Insurer"],
  ["ClaimChecklistItem", "claimId", "Claim"], ["ClaimChecklistItem", "documentId", "Document"],
  ["KnowledgeChunk", "sourceId", "KnowledgeSource"],
  ["Quote", "clientId", "Client"], ["Quote", "insurerId", "Insurer"],
  ["Document", "clientId", "Client"], ["Document", "policyId", "Policy"], ["Document", "endorsementId", "PolicyEndorsement"], ["Document", "receiptId", "Receipt"], ["Document", "taskId", "Task"], ["Document", "claimId", "Claim"], ["Document", "quoteId", "Quote"],
  ["PolicyInsuredParty", "policyId", "Policy"], ["PolicyInsuredAsset", "policyId", "Policy"],
  ["NotificationEvent", "workItemId", "WorkItem"], ["NotificationEvent", "clientId", "Client"], ["NotificationEvent", "policyId", "Policy"], ["NotificationEvent", "receiptId", "Receipt"],
  ["CommissionStatementRow", "statementId", "CommissionStatement"], ["CommissionStatementRow", "commissionId", "Commission"],
  ["CommissionCorrection", "commissionId", "Commission"], ["CommissionCorrection", "statementRowId", "CommissionStatementRow"],
  ["QuoteComparison", "clientId", "Client"], ["QuoteComparisonItem", "comparisonId", "QuoteComparison"], ["QuoteComparisonItem", "quoteId", "Quote"],
  ["LedgerImportRow", "batchId", "LedgerImportBatch"], ["LedgerImportRow", "policyId", "Policy"], ["LedgerImportRow", "receiptId", "Receipt"], ["LedgerImportRow", "paymentId", "Payment"],
  ["LedgerImportAction", "batchId", "LedgerImportBatch"], ["LedgerImportAction", "rowId", "LedgerImportRow"], ["LedgerImportIssue", "batchId", "LedgerImportBatch"], ["LedgerImportIssue", "rowId", "LedgerImportRow"], ["LedgerImportIssue", "suppressedByRuleId", "DataQualitySuppressionRule"],
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

  const missingMemberships = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "User" u LEFT JOIN "OrganizationMembership" m ON m."userId" = u."id" AND m."organizationId" = $1 WHERE u."id" <> $2 AND u."platformRole" <> 'SUPERADMIN' AND m."id" IS NULL`, [BOOTSTRAP_ORGANIZATION_ID, SYSTEM_USER_ID]);
  const missing = Number(missingMemberships.rows[0]?.count ?? 0);
  summary.usersMissingMembership = missing;
  if (missing > 0) issues.push(`${missing} non-technical users without membership`);

  const systemMemberships = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "OrganizationMembership" WHERE "userId" = $1`, [SYSTEM_USER_ID]);
  if (Number(systemMemberships.rows[0]?.count ?? 0) > 0) issues.push("technical system user has a membership");
  const platformMemberships = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "OrganizationMembership" m JOIN "User" u ON u."id" = m."userId" WHERE u."platformRole" = 'SUPERADMIN'`);
  if (Number(platformMemberships.rows[0]?.count ?? 0) > 0) issues.push("SUPERADMIN user has a tenant membership");
  const membershipActiveMismatch = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "OrganizationMembership" m JOIN "User" u ON u."id" = m."userId" WHERE m."active" IS DISTINCT FROM u."active"`);
  if (Number(membershipActiveMismatch.rows[0]?.count ?? 0) > 0) issues.push("membership active state differs from User.active");
  const membershipRoleMismatch = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "OrganizationMembership" m JOIN "User" u ON u."id" = m."userId" WHERE (m."role" NOT IN ('OWNER','ADMIN','AGENT')) OR (m."role" <> 'OWNER' AND (u."role" NOT IN ('ADMIN','AGENT') OR m."role" <> u."role"))`);
  if (Number(membershipRoleMismatch.rows[0]?.count ?? 0) > 0) issues.push("membership role is invalid or differs from legacy User.role");
  const usersWithMultipleMemberships = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM (SELECT "userId" FROM "OrganizationMembership" GROUP BY "userId" HAVING count(*) > 1) duplicate_memberships`);
  if (Number(usersWithMultipleMemberships.rows[0]?.count ?? 0) > 0) issues.push("users with multiple organization memberships");

  for (const table of PROTECTED_TENANT_TABLES) {
    const nullResult = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${identifier(table)} WHERE "organizationId" IS NULL`);
    const nullCount = Number(nullResult.rows[0]?.count ?? 0);
    summary[`${table}.nullOrganizationId`] = nullCount;
    if (nullCount > 0) issues.push(`${table} has ${nullCount} rows without organizationId`);
    const dangling = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${identifier(table)} t LEFT JOIN "Organization" o ON o."id" = t."organizationId" WHERE t."organizationId" IS NOT NULL AND o."id" IS NULL`);
    const danglingCount = Number(dangling.rows[0]?.count ?? 0);
    if (danglingCount > 0) issues.push(`${table} has dangling organization references`);
  }

  for (const table of OPTIONAL_ORGANIZATION_TABLES) {
    const dangling = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${identifier(table)} t LEFT JOIN "Organization" o ON o."id" = t."organizationId" WHERE t."organizationId" IS NOT NULL AND o."id" IS NULL`);
    if (Number(dangling.rows[0]?.count ?? 0) > 0) issues.push(`${table} has dangling optional organization references`);
  }

  for (const [child, column, parent] of TENANT_RELATION_CHECKS) {
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
  const triggerResult = await client.query<{ tgname: string; tgenabled: string; table_name: string; function_name: string; definition: string }>(`
    SELECT t.tgname, t.tgenabled, c.relname AS table_name, p.proname AS function_name,
           pg_get_triggerdef(t.oid, true) AS definition
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE n.nspname = 'public' AND NOT t.tgisinternal
  `);
  const installed = new Map(triggerResult.rows.map((row) => [row.tgname, row]));
  const cutoverMigration = await client.query<{ applied: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM "${MIGRATIONS_TABLE}"
       WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL
    ) AS applied
  `, [CUTOVER_TRIGGER_REMOVAL_MIGRATION]);
  for (const [table, trigger] of tenantTriggersForMigrationState(Boolean(cutoverMigration.rows[0]?.applied))) {
    const row = installed.get(trigger);
    if (!row) { issues.push(`expected trigger ${trigger} is missing`); continue; }
    const definition = row.definition.replaceAll('"', '').replace(/\s+/g, " ");
    if (row.tgenabled !== "O") issues.push(`trigger ${trigger} is not a normal enabled trigger`);
    if (row.table_name !== table) issues.push(`trigger ${trigger} is attached to ${row.table_name}, not ${table}`);
    if (row.function_name !== "policydesk_assign_singleton_organization") issues.push(`trigger ${trigger} calls the wrong function`);
    if (!/BEFORE INSERT OR UPDATE OF organizationId ON/.test(definition)) issues.push(`trigger ${trigger} is not BEFORE INSERT OR UPDATE OF organizationId`);
  }
  const expectedGuards: Record<string, [string, string]> = {
    Organization_transition_delete_guard: ["Organization", "policydesk_guard_organization_delete"],
    Organization_transition_truncate_guard: ["Organization", "policydesk_guard_organization_delete"],
    OrganizationMembership_transition_guard: ["OrganizationMembership", "policydesk_guard_singleton_membership"],
    User_transition_membership_sync: ["User", "policydesk_sync_user_membership"],
    User_transition_owner_delete_guard: ["User", "policydesk_guard_user_owner_delete"],
  };
  for (const [trigger, [table, fn]] of Object.entries(expectedGuards)) {
    const row = installed.get(trigger);
    if (!row) issues.push(`expected guard trigger ${trigger} is missing`);
    else if (row.tgenabled !== "O" || row.table_name !== table || row.function_name !== fn) issues.push(`guard trigger ${trigger} has an unexpected definition`);
  }
  const membershipFunction = await client.query<{ definition: string }>(`
    SELECT pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'policydesk_sync_user_membership'
  `);
  const membershipFunctionDefinition = membershipFunction.rows[0]?.definition ?? "";
  if (!membershipFunctionDefinition.includes('NEW."platformRole" = \'SUPERADMIN\'')) issues.push("User membership sync does not exclude SUPERADMIN");
  const userMembershipTrigger = installed.get("User_transition_membership_sync")?.definition.replaceAll('"', '').replace(/\s+/g, " ") ?? "";
  if (!/AFTER INSERT OR UPDATE OF role, active, platformRole ON/.test(userMembershipTrigger)) issues.push("User membership sync trigger does not track platformRole");
  const indexes = await client.query<{ indexname: string; table_name: string; indisunique: boolean; indexdef: string; predicate: string | null }>(`
    SELECT i.relname AS indexname, t.relname AS table_name, x.indisunique,
           pg_get_indexdef(x.indexrelid) AS indexdef, pg_get_expr(x.indpred, x.indrelid) AS predicate
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_class t ON t.oid = x.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public' AND i.relname = ANY($1::text[])
  `, [["Organization_transition_singleton_idx", "OrganizationMembership_transition_owner_idx", "OrganizationMembership_userId_key"]]);
  const indexByName = new Map(indexes.rows.map((row) => [row.indexname, row]));
  const singleton = indexByName.get("Organization_transition_singleton_idx");
  if (!singleton || singleton.table_name !== "Organization" || !singleton.indisunique || !singleton.indexdef.replace(/\s+/g, "").includes("((1))")) issues.push("singleton expression index is not the required unique constant index");
  const ownerIndex = indexByName.get("OrganizationMembership_transition_owner_idx");
  const ownerPredicate = ownerIndex?.predicate?.replaceAll('"', '') ?? "";
  if (!ownerIndex || ownerIndex.table_name !== "OrganizationMembership" || !ownerIndex.indisunique || !ownerIndex.indexdef.replace(/\s+/g, "").includes("((1))") || !/role\s*=\s*'OWNER'/.test(ownerPredicate)) issues.push("Owner singleton index is not the required unique partial constant index");
  const singleMembershipIndex = indexByName.get("OrganizationMembership_userId_key");
  if (
    !singleMembershipIndex ||
    singleMembershipIndex.table_name !== "OrganizationMembership" ||
    !singleMembershipIndex.indisunique ||
    !/\("userId"\)/.test(singleMembershipIndex.indexdef)
  ) {
    issues.push("single organization membership unique index is missing or invalid");
  }

  return { ok: issues.length === 0, issues, summary };
}
