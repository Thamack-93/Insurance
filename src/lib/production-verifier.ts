import fs from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { auditMultiOrganizationState } from "../../scripts/check-multi-org-audit.ts";
import {
  auditTenantFoundation,
  PROTECTED_TENANT_TABLES,
} from "./tenant-organization-foundation.ts";

export type ProductionVerificationStatus = "PASS" | "WARN" | "BLOCKED";
export type ProductionTenantMode = "single-org" | "multi-org";

export type VerificationIssue = {
  code: string;
  severity: "WARN" | "BLOCKED";
  message: string;
};

export type ProductionVerificationReport = {
  status: ProductionVerificationStatus;
  generatedAt: string;
  tenantMode: ProductionTenantMode | "INVALID";
  sections: {
    migrations: Record<string, unknown>;
    organization: Record<string, unknown>;
    tenant: Record<string, unknown>;
    rls: Record<string, unknown>;
    knowledge: Record<string, unknown>;
    billing: Record<string, unknown>;
    backup: Record<string, unknown>;
    runtimeConfiguration: Record<string, unknown>;
  };
  issues: VerificationIssue[];
};

const MIGRATIONS_TABLE = "_prisma_migrations";
const CURRENT_SUBSCRIPTION_STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE"];
const EXPECTED_BILLING_SUBSCRIPTION_STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE", "CANCELED"];
const EXPECTED_BILLING_CHARGE_STATUSES = ["PENDING", "PAID", "VOID", "REFUNDED"];

function migrationNames() {
  const directory = path.join(process.cwd(), "prisma/migrations");
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(directory, entry.name, "migration.sql")))
    .map((entry) => entry.name)
    .sort();
}

function issue(code: string, severity: VerificationIssue["severity"], message: string): VerificationIssue {
  return { code, severity, message };
}

export function aggregateVerificationStatus(issues: VerificationIssue[]): ProductionVerificationStatus {
  return issues.some((item) => item.severity === "BLOCKED") ? "BLOCKED" : issues.length ? "WARN" : "PASS";
}

function safeErrorCode(error: unknown) {
  if (!(error instanceof Error)) return "UNEXPECTED_ERROR";
  if (/does not exist|relation .* does not exist/i.test(error.message)) return "REQUIRED_SCHEMA_OBJECT_MISSING";
  if (/password authentication|authentication failed/i.test(error.message)) return "DATABASE_AUTHENTICATION_FAILED";
  if (/timeout|timed out|connect/i.test(error.message)) return "DATABASE_CONNECTION_FAILED";
  return "DATABASE_QUERY_FAILED";
}

async function queryCount(client: PoolClient, sql: string, values: unknown[] = []) {
  const result = await client.query<{ count: string }>(sql, values);
  return Number(result.rows[0]?.count ?? 0);
}

async function verifyMigrations(client: PoolClient, issues: VerificationIssue[]) {
  const expected = migrationNames();
  try {
    const result = await client.query<{
      migration_name: string;
      finished_at: Date | null;
      rolled_back_at: Date | null;
      applied_steps_count: number;
    }>(`SELECT migration_name, finished_at, rolled_back_at, applied_steps_count FROM "${MIGRATIONS_TABLE}" ORDER BY migration_name`);
    const rows = result.rows;
    const applied = new Set(rows.filter((row) => row.finished_at && !row.rolled_back_at).map((row) => row.migration_name));
    const pending = expected.filter((name) => !applied.has(name));
    const unknown = rows.filter((row) => !expected.includes(row.migration_name)).map((row) => row.migration_name);
    const incomplete = rows.filter((row) => !row.finished_at || row.rolled_back_at || row.applied_steps_count < 0).map((row) => row.migration_name);
    const duplicateNames = [...new Set(rows.map((row) => row.migration_name).filter((name, index, all) => all.indexOf(name) !== index))];
    if (pending.length) issues.push(issue("MIGRATIONS_PENDING", "BLOCKED", `Production no tiene aplicadas ${pending.length} migraciones del repositorio.`));
    if (unknown.length) issues.push(issue("MIGRATIONS_UNKNOWN", "BLOCKED", `Production contiene ${unknown.length} migraciones ausentes del repositorio.`));
    if (incomplete.length) issues.push(issue("MIGRATIONS_INCOMPLETE", "BLOCKED", `Production contiene ${incomplete.length} migraciones fallidas o incompletas.`));
    if (duplicateNames.length) issues.push(issue("MIGRATIONS_DUPLICATE", "BLOCKED", `Production contiene ${duplicateNames.length} migraciones duplicadas.`));
    return {
      status: aggregateVerificationStatus(issues),
      repositoryMigrationCount: expected.length,
      appliedMigrationCount: applied.size,
      pendingMigrationCount: pending.length,
      unknownMigrationCount: unknown.length,
      incompleteMigrationCount: incomplete.length,
      duplicateMigrationCount: duplicateNames.length,
      pendingMigrationNames: pending,
    };
  } catch (error) {
    issues.push(issue("MIGRATIONS_UNAVAILABLE", "BLOCKED", `No se pudo leer ${MIGRATIONS_TABLE} (${safeErrorCode(error)}).`));
    return { status: "BLOCKED", repositoryMigrationCount: expected.length, appliedMigrationCount: 0 };
  }
}

async function verifyOrganization(client: PoolClient, mode: ProductionTenantMode, issues: VerificationIssue[]) {
  try {
    const organizations = await client.query<{ status: string }>(`SELECT "status" FROM "Organization" ORDER BY "id"`);
    const count = organizations.rowCount ?? 0;
    if (mode === "single-org" && count !== 1) issues.push(issue("ORGANIZATION_COUNT_INVALID", "BLOCKED", `El estado singleton requiere exactamente una organización; se encontraron ${count}.`));
    if (mode === "multi-org" && count < 2) issues.push(issue("MULTI_ORG_COUNT_INVALID", "BLOCKED", "El estado multi-org requiere al menos dos organizaciones."));
    if (organizations.rows.some((row) => !["ACTIVE", "SUSPENDED", "RESTORING", "BOOTSTRAP"].includes(row.status))) {
      issues.push(issue("ORGANIZATION_STATUS_INVALID", "BLOCKED", "Existe una organización con un estado no reconocido."));
    }
    if (mode === "single-org" && organizations.rows[0]?.status !== "ACTIVE") {
      issues.push(issue("ORGANIZATION_NOT_ACTIVE", "BLOCKED", "La organización singleton no está ACTIVE."));
    }
    const barrier = await client.query<{ name: string }>(`
      SELECT indexname AS name FROM pg_indexes
      WHERE schemaname = 'public' AND indexname IN ('Organization_transition_singleton_idx', 'OrganizationMembership_transition_owner_idx')
      UNION ALL
      SELECT tgname AS name FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
        AND tgname IN ('Organization_transition_delete_guard', 'Organization_transition_truncate_guard', 'OrganizationMembership_transition_guard')
    `);
    const barrierObjectCount = barrier.rowCount ?? 0;
    if (mode === "single-org" && barrierObjectCount < 5) issues.push(issue("SINGLETON_BARRIER_MISSING", "BLOCKED", "La barrera singleton no está completa."));
    if (mode === "multi-org" && barrierObjectCount > 0) issues.push(issue("SINGLETON_BARRIER_PRESENT", "BLOCKED", "La barrera singleton sigue presente tras declarar multi-org."));
    return { status: aggregateVerificationStatus(issues), organizationCount: count, statusValues: [...new Set(organizations.rows.map((row) => row.status))], singletonBarrierObjectCount: barrierObjectCount };
  } catch (error) {
    issues.push(issue("ORGANIZATION_CHECK_FAILED", "BLOCKED", `No se pudo verificar Organization (${safeErrorCode(error)}).`));
    return { status: "BLOCKED" };
  }
}

async function verifyTenant(client: PoolClient, mode: ProductionTenantMode, issues: VerificationIssue[]) {
  try {
    const result = mode === "single-org"
      ? await auditTenantFoundation(client, { requireActive: true })
      : await auditMultiOrganizationState(client);
    if (!result.ok) issues.push(issue("TENANT_AUDIT_FAILED", "BLOCKED", `El audit tenant reportó ${result.issues.length} inconsistencias.`));
    return { status: aggregateVerificationStatus(issues), auditPassed: result.ok, issueCount: result.issues.length, summary: sanitizeSummary(result.summary) };
  } catch (error) {
    issues.push(issue("TENANT_CHECK_FAILED", "BLOCKED", `No se pudo ejecutar el audit tenant (${safeErrorCode(error)}).`));
    return { status: "BLOCKED", auditPassed: false };
  }
}

function sanitizeSummary(summary: Record<string, number | string | boolean>) {
  const safe: Record<string, number | string | boolean> = {};
  for (const [key, value] of Object.entries(summary)) {
    if (/^[a-zA-Z]+Count$/.test(key) || /organizationCount|activeOwnerCount|usersMissingMembership|nullOrganizationId|organizationStatus/.test(key)) safe[key] = value;
  }
  return safe;
}

async function verifyRls(client: PoolClient, mode: ProductionTenantMode, issues: VerificationIssue[]) {
  try {
    const result = await client.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
    `, [PROTECTED_TENANT_TABLES]);
    const enabled = result.rows.filter((row) => row.relrowsecurity).length;
    const forced = result.rows.filter((row) => row.relforcerowsecurity).length;
    const status = enabled === 0 ? "DISABLED" : enabled === result.rows.length ? "ENABLED" : "MIXED";
    if (result.rows.length !== PROTECTED_TENANT_TABLES.length || status === "MIXED") issues.push(issue("RLS_STATE_INDETERMINATE", "BLOCKED", "El estado RLS no se pudo verificar de forma uniforme."));
    if (mode === "single-org" && status === "DISABLED") issues.push(issue("RLS_DISABLED_SINGLETON", "WARN", "RLS está DISABLED, conforme al estado singleton actual."));
    if (mode === "single-org" && status === "ENABLED") issues.push(issue("RLS_ENABLED_BEFORE_CUTOVER", "WARN", "RLS está ENABLED antes del cutover multi-org declarado."));
    if (mode === "multi-org" && (status !== "ENABLED" || forced !== result.rows.length)) issues.push(issue("RLS_REQUIRED_FOR_MULTI_ORG", "BLOCKED", "El estado multi-org requiere RLS ENABLED y FORCE en todas las tablas protegidas."));
    return { status: aggregateVerificationStatus(issues), state: status, protectedTableCount: result.rows.length, enabledTableCount: enabled, forcedTableCount: forced };
  } catch (error) {
    issues.push(issue("RLS_CHECK_FAILED", "BLOCKED", `No se pudo consultar RLS (${safeErrorCode(error)}).`));
    return { status: "BLOCKED", state: "UNKNOWN" };
  }
}

async function verifyKnowledge(client: PoolClient, issues: VerificationIssue[]) {
  try {
    const [general, internal, duplicateGeneral, duplicateInternal, chunkMismatches] = await Promise.all([
      client.query<{ total: string; active: string; invalidActive: string; expiredActive: string; activeWithoutChunks: string; activeIntegrityInvalid: string }>(`
        SELECT count(*)::text AS total,
          count(*) FILTER (WHERE status = 'ACTIVE')::text AS active,
          count(*) FILTER (WHERE status = 'ACTIVE' AND ("contentHash" !~ '^[0-9a-f]{64}$' OR "manifestHash" !~ '^[0-9a-f]{64}$' OR "integrityVersion" <> 'CHUNK_MANIFEST_V1' OR "integrityVerifiedAt" IS NULL))::text AS "invalidActive",
          count(*) FILTER (WHERE status = 'ACTIVE' AND (("effectiveFrom" IS NOT NULL AND (CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')::date < "effectiveFrom") OR ("effectiveTo" IS NOT NULL AND (CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')::date > "effectiveTo")))::text AS "expiredActive",
          count(*) FILTER (WHERE status = 'ACTIVE' AND NOT EXISTS (SELECT 1 FROM "GeneralKnowledgeChunk" c WHERE c."sourceId" = s."id"))::text AS "activeWithoutChunks",
          count(*) FILTER (WHERE status = 'ACTIVE' AND ("manifestHash" !~ '^[0-9a-f]{64}$' OR "integrityVersion" <> 'CHUNK_MANIFEST_V1' OR "integrityVerifiedAt" IS NULL))::text AS "activeIntegrityInvalid"
        FROM "GeneralKnowledgeSource" s
      `),
      client.query<{ organizationId: string; total: string; active: string; invalid: string; expired: string; withoutChunks: string }>(`
        SELECT "organizationId", count(*)::text AS total,
          count(*) FILTER (WHERE status = 'ACTIVE')::text AS active,
          count(*) FILTER (WHERE "contentHash" !~ '^[0-9a-f]{64}$' OR "manifestHash" !~ '^[0-9a-f]{64}$')::text AS invalid,
          count(*) FILTER (WHERE status = 'ACTIVE' AND (("effectiveFrom" IS NOT NULL AND (CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')::date < "effectiveFrom") OR ("effectiveTo" IS NOT NULL AND (CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')::date > "effectiveTo")))::text AS expired,
          count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "KnowledgeChunk" c WHERE c."sourceId" = s."id"))::text AS "withoutChunks"
        FROM "KnowledgeSource" s GROUP BY "organizationId" ORDER BY "organizationId"
      `),
      queryCount(client, `SELECT count(*)::text FROM (SELECT "product" FROM "GeneralKnowledgeSource" WHERE status = 'ACTIVE' GROUP BY "product" HAVING count(*) > 1) duplicates`),
      queryCount(client, `SELECT count(*)::text FROM (SELECT "organizationId", "insurerName", "product" FROM "KnowledgeSource" WHERE status = 'ACTIVE' GROUP BY "organizationId", "insurerName", "product" HAVING count(*) > 1) duplicates`),
      queryCount(client, `SELECT count(*)::text FROM "KnowledgeChunk" c JOIN "KnowledgeSource" s ON s."id" = c."sourceId" WHERE c."organizationId" <> s."organizationId"`),
    ]);
    const g = general.rows[0] ?? { total: "0", active: "0", invalidActive: "0", expiredActive: "0", activeWithoutChunks: "0", activeIntegrityInvalid: "0" };
    const internalRows = internal.rows.map((row, index) => ({ organizationOrdinal: index + 1, total: Number(row.total), active: Number(row.active) }));
    const generalActive = Number(g.active);
    const corruption = Number(g.invalidActive) + Number(g.expiredActive) + Number(g.activeWithoutChunks) + Number(g.activeIntegrityInvalid) + duplicateGeneral + duplicateInternal + chunkMismatches + internal.rows.reduce((sum, row) => sum + Number(row.invalid) + Number(row.expired) + Number(row.withoutChunks), 0);
    if (generalActive === 0) issues.push(issue("GENERAL_KNOWLEDGE_EMPTY", "BLOCKED", "No existe una fuente GENERAL ACTIVE."));
    if (corruption > 0) issues.push(issue("KNOWLEDGE_INTEGRITY_FAILED", "BLOCKED", "La integridad, vigencia o relación tenant de knowledge falló."));
    return { status: aggregateVerificationStatus(issues), general: { total: Number(g.total), active: generalActive, invalidActive: Number(g.invalidActive), outOfDateActive: Number(g.expiredActive), activeWithoutChunks: Number(g.activeWithoutChunks) }, internalByOrganization: internalRows, duplicateGeneral, duplicateInternal, tenantChunkMismatches: chunkMismatches };
  } catch (error) {
    issues.push(issue("KNOWLEDGE_CHECK_FAILED", "BLOCKED", `No se pudo verificar knowledge (${safeErrorCode(error)}).`));
    return { status: "BLOCKED" };
  }
}

async function verifyBilling(client: PoolClient, issues: VerificationIssue[]) {
  try {
    const [counts, currentMultiplicity, crossOrg, unsafeAmounts, lifecycle, duplicateRequestIds] = await Promise.all([
      client.query<{ plans: string; subscriptions: string; charges: string }>(`SELECT (SELECT count(*) FROM "Plan")::text AS plans, (SELECT count(*) FROM "OrganizationSubscription")::text AS subscriptions, (SELECT count(*) FROM "BillingCharge")::text AS charges`),
      queryCount(client, `SELECT count(*)::text FROM (SELECT "organizationId" FROM "OrganizationSubscription" WHERE status = ANY($1::text[]) GROUP BY "organizationId" HAVING count(*) > 1) invalid`, [CURRENT_SUBSCRIPTION_STATUSES]),
      queryCount(client, `SELECT count(*)::text FROM "BillingCharge" c JOIN "OrganizationSubscription" s ON s."id" = c."subscriptionId" WHERE c."organizationId" <> s."organizationId"`),
      queryCount(client, `SELECT count(*)::text FROM (SELECT "monthlyAmountMinor" AS amount FROM "Plan" UNION ALL SELECT "monthlyAmountMinor" FROM "OrganizationSubscription" UNION ALL SELECT "amountMinor" FROM "BillingCharge") amounts WHERE amount < 0 OR amount::numeric > 9007199254740991`),
      queryCount(client, `SELECT count(*)::text FROM (SELECT 1 FROM "OrganizationSubscription" WHERE status <> ALL($1::text[]) OR "endsAt" IS NOT NULL AND "endsAt" < "startedAt" UNION ALL SELECT 1 FROM "BillingCharge" WHERE status <> ALL($2::text[]) OR "periodEnd" < "periodStart" OR (status = 'PAID' AND "paidAt" IS NULL)) lifecycle`, [EXPECTED_BILLING_SUBSCRIPTION_STATUSES, EXPECTED_BILLING_CHARGE_STATUSES]),
      queryCount(client, `SELECT count(*)::text FROM (SELECT "requestId" FROM "Plan" GROUP BY "requestId" HAVING count(*) > 1 UNION ALL SELECT "requestId" FROM "OrganizationSubscription" GROUP BY "requestId" HAVING count(*) > 1 UNION ALL SELECT "requestId" FROM "BillingCharge" GROUP BY "requestId" HAVING count(*) > 1) duplicates`),
    ]);
    const row = counts.rows[0] ?? { plans: "0", subscriptions: "0", charges: "0" };
    if (currentMultiplicity || crossOrg || unsafeAmounts || lifecycle || duplicateRequestIds) issues.push(issue("BILLING_INTEGRITY_FAILED", "BLOCKED", "La integridad del ledger de billing falló."));
    const billingMutationFlag = process.env.PLATFORM_BILLING_MUTATIONS_ENABLED?.trim();
    if (billingMutationFlag === "1") issues.push(issue("BILLING_MUTATIONS_ENABLED", "BLOCKED", "Las mutaciones de platform billing están habilitadas."));
    if (!billingMutationFlag) issues.push(issue("BILLING_GUARD_NOT_EXPLICIT", "WARN", "La variable de guard billing no fue proporcionada por el entorno autorizado; el runtime fail-closed se observa como default, no como evidencia externa."));
    return { status: aggregateVerificationStatus(issues), planCount: Number(row.plans), subscriptionCount: Number(row.subscriptions), chargeCount: Number(row.charges), currentSubscriptionMultiplicity: currentMultiplicity, crossOrganizationRelationships: crossOrg, unsafeAmountCount: unsafeAmounts, lifecycleIssueCount: lifecycle, duplicateRequestIdCount: duplicateRequestIds, mutationsGuarded: billingMutationFlag !== "1" };
  } catch (error) {
    issues.push(issue("BILLING_CHECK_FAILED", "BLOCKED", `No se pudo verificar billing (${safeErrorCode(error)}).`));
    return { status: "BLOCKED" };
  }
}

async function verifyBackup(client: PoolClient, issues: VerificationIssue[]) {
  try {
    const [counts, invalidScopes, invalidManifest, invalidReferences] = await Promise.all([
      client.query<{ artifacts: string; restoreRuns: string }>(`SELECT (SELECT count(*) FROM "BackupArtifact")::text AS artifacts, (SELECT count(*) FROM "OrganizationRestoreRun")::text AS "restoreRuns"`),
      queryCount(client, `SELECT count(*)::text FROM "BackupArtifact" WHERE (scope = 'PLATFORM' AND "organizationId" IS NOT NULL) OR (scope IN ('ORGANIZATION', 'LEGACY_SINGLETON') AND "organizationId" IS NULL)`),
      queryCount(client, `SELECT count(*)::text FROM "BackupArtifact" WHERE "manifestAvailable" AND ("formatVersion" IS NULL OR "keyVersion" IS NULL OR "payloadSha256" IS NULL OR "manifestSha256" IS NULL)`),
      queryCount(client, `SELECT count(*)::text FROM "OrganizationRestoreRun" r LEFT JOIN "BackupArtifact" a ON a."id" = r."artifactId" WHERE a."id" IS NULL OR a."organizationId" IS DISTINCT FROM r."organizationId"`),
    ]);
    const row = counts.rows[0] ?? { artifacts: "0", restoreRuns: "0" };
    if (invalidScopes || invalidManifest || invalidReferences) issues.push(issue("BACKUP_CATALOG_INTEGRITY_FAILED", "BLOCKED", "La consistencia del catálogo de backups falló."));
    if (Number(row.artifacts) === 0) issues.push(issue("BACKUP_CATALOG_EMPTY", "WARN", "El catálogo de backups no contiene artifacts; no se inspeccionaron payloads."));
    return { status: aggregateVerificationStatus(issues), artifactCount: Number(row.artifacts), restoreRunCount: Number(row.restoreRuns), invalidScopeCount: invalidScopes, invalidManifestCount: invalidManifest, invalidReferenceCount: invalidReferences, payloadsInspected: false };
  } catch (error) {
    issues.push(issue("BACKUP_CHECK_FAILED", "BLOCKED", `No se pudo verificar el catálogo de backups (${safeErrorCode(error)}).`));
    return { status: "BLOCKED" };
  }
}

export function resolveProductionTenantMode(value = process.env.PRODUCTION_EXPECTED_TENANT_MODE): ProductionTenantMode | "INVALID" {
  const normalized = value?.trim() || "single-org";
  return normalized === "single-org" || normalized === "multi-org" ? normalized : "INVALID";
}

function verifyRuntimeConfiguration(issues: VerificationIssue[]) {
  const configuredNoraMode = process.env.NORA_AGENT_MODE?.trim().toLowerCase();
  const noraAgentMode = configuredNoraMode === "off" || configuredNoraMode === "admin" || configuredNoraMode === "all" ? configuredNoraMode : "off";
  if (!configuredNoraMode || !["off", "admin", "all"].includes(configuredNoraMode)) {
    issues.push(issue("NORA_MODE_NOT_EXPLICIT", "WARN", "NORA_AGENT_MODE no está explícitamente configurado; Nora permanece fail-closed en off."));
  }
  return { status: aggregateVerificationStatus(issues), noraAgentMode, noraModeExplicit: configuredNoraMode === noraAgentMode, billingMutationsGuarded: process.env.PLATFORM_BILLING_MUTATIONS_ENABLED !== "1" };
}

export async function verifyProductionState(connectionString: string): Promise<ProductionVerificationReport> {
  const tenantMode = resolveProductionTenantMode();
  const issues: VerificationIssue[] = [];
  if (tenantMode === "INVALID") issues.push(issue("TENANT_MODE_INVALID", "BLOCKED", "PRODUCTION_EXPECTED_TENANT_MODE debe ser single-org o multi-org."));
  const pool = new Pool({ connectionString, max: 1, application_name: "policydesk-production-verifier" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const mode = tenantMode === "INVALID" ? "single-org" : tenantMode;
    const migrationIssues: VerificationIssue[] = [];
    const organizationIssues: VerificationIssue[] = [];
    const tenantIssues: VerificationIssue[] = [];
    const rlsIssues: VerificationIssue[] = [];
    const knowledgeIssues: VerificationIssue[] = [];
    const billingIssues: VerificationIssue[] = [];
    const backupIssues: VerificationIssue[] = [];
    const runtimeIssues: VerificationIssue[] = [];
    const [migrations, organization, tenant, rls, knowledge, billing, backup, runtimeConfiguration] = await Promise.all([
      verifyMigrations(client, migrationIssues),
      verifyOrganization(client, mode, organizationIssues),
      verifyTenant(client, mode, tenantIssues),
      verifyRls(client, mode, rlsIssues),
      verifyKnowledge(client, knowledgeIssues),
      verifyBilling(client, billingIssues),
      verifyBackup(client, backupIssues),
      Promise.resolve(verifyRuntimeConfiguration(runtimeIssues)),
    ]);
    await client.query("ROLLBACK");
    const allIssues = [...issues, ...migrationIssues, ...organizationIssues, ...tenantIssues, ...rlsIssues, ...knowledgeIssues, ...billingIssues, ...backupIssues, ...runtimeIssues];
    const status = aggregateVerificationStatus(allIssues);
    return { status, generatedAt: new Date().toISOString(), tenantMode, sections: { migrations, organization, tenant, rls, knowledge, billing, backup, runtimeConfiguration }, issues: allIssues };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return {
      status: "BLOCKED",
      generatedAt: new Date().toISOString(),
      tenantMode,
      sections: { migrations: {}, organization: {}, tenant: {}, rls: {}, knowledge: {}, billing: {}, backup: {}, runtimeConfiguration: {} },
      issues: [...issues, issue(safeErrorCode(error), "BLOCKED", "La verificación Production no pudo completarse.")],
    };
  } finally {
    client.release();
    await pool.end();
  }
}
