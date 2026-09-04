import fs from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { auditMultiOrganizationState } from "../../scripts/check-multi-org-audit.ts";
import {
  auditTenantFoundation,
  OPTIONAL_ORGANIZATION_TABLES,
  PROTECTED_TENANT_TABLES,
} from "./tenant-organization-foundation.ts";
import {
  getBackupScheduleStatus,
  PLATFORM_BACKUP_INTERVAL_DAYS,
  TENANT_BACKUP_INTERVAL_DAYS,
} from "./backup-schedule.ts";

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

async function verifyMigrations(client: PoolClient, issues: VerificationIssue[], mode: ProductionTenantMode) {
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
    const pendingCutover = pending.filter((name) => name === "20260831010000_multi_tenant_rls_cutover");
    const blockingPending = mode === "single-org"
      ? pending.filter((name) => name !== "20260831010000_multi_tenant_rls_cutover")
      : pending;
    const unknown = rows.filter((row) => !expected.includes(row.migration_name)).map((row) => row.migration_name);
    const incomplete = rows.filter((row) => !row.finished_at || row.rolled_back_at || row.applied_steps_count < 0).map((row) => row.migration_name);
    const duplicateNames = [...new Set(rows.map((row) => row.migration_name).filter((name, index, all) => all.indexOf(name) !== index))];
    if (blockingPending.length) issues.push(issue("MIGRATIONS_PENDING", "BLOCKED", `Production no tiene aplicadas ${blockingPending.length} migraciones del repositorio.`));
    if (pendingCutover.length && mode === "single-org") issues.push(issue("TENANT_CUTOVER_PENDING", "WARN", "La migración RLS final permanece pendiente mientras Production sigue en singleton; debe aplicarse durante la ventana de mantenimiento."));
    if (unknown.length) issues.push(issue("MIGRATIONS_UNKNOWN", "BLOCKED", `Production contiene ${unknown.length} migraciones ausentes del repositorio.`));
    if (incomplete.length) issues.push(issue("MIGRATIONS_INCOMPLETE", "BLOCKED", `Production contiene ${incomplete.length} migraciones fallidas o incompletas.`));
    if (duplicateNames.length) issues.push(issue("MIGRATIONS_DUPLICATE", "BLOCKED", `Production contiene ${duplicateNames.length} migraciones duplicadas.`));
    return {
      status: aggregateVerificationStatus(issues),
      repositoryMigrationCount: expected.length,
      appliedMigrationCount: applied.size,
      pendingMigrationCount: pending.length,
      blockingPendingMigrationCount: blockingPending.length,
      pendingCutoverMigration: pendingCutover.length === 1,
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
    if (mode === "multi-org" && count < 1) issues.push(issue("MULTI_ORG_COUNT_INVALID", "BLOCKED", "El estado multi-org requiere al menos una organización; la certificación de dos organizaciones ocurre antes del cutover."));
    if (organizations.rows.some((row) => !["ACTIVE", "SUSPENDED", "RESTORING", "BOOTSTRAP", "PROVISIONING", "RESETTING"].includes(row.status))) {
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
    const ownerTrigger = await client.query<{ tgenabled: string; functionName: string }>(`
      SELECT t.tgenabled, p.proname AS "functionName"
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE n.nspname = 'public' AND c.relname = 'OrganizationMembership'
         AND t.tgname = 'policydesk_owner_membership_invariant'
    `);
    const ownerInvariantInstalled = ownerTrigger.rows.length === 1 && ownerTrigger.rows[0].tgenabled === "O" && ownerTrigger.rows[0].functionName === "policydesk_guard_owner_membership";
    if (mode === "multi-org" && !ownerInvariantInstalled) issues.push(issue("OWNER_INVARIANT_TRIGGER_MISSING", "BLOCKED", "Falta el trigger final de invariante de propietario por organización."));
    return { status: aggregateVerificationStatus(issues), organizationCount: count, statusValues: [...new Set(organizations.rows.map((row) => row.status))], singletonBarrierObjectCount: barrierObjectCount, ownerInvariantInstalled };
  } catch (error) {
    issues.push(issue("ORGANIZATION_CHECK_FAILED", "BLOCKED", `No se pudo verificar Organization (${safeErrorCode(error)}).`));
    return { status: "BLOCKED" };
  }
}

async function verifyTenant(client: PoolClient, mode: ProductionTenantMode, issues: VerificationIssue[]) {
  try {
    const result = mode === "single-org"
      ? await auditTenantFoundation(client, { requireActive: true })
      : await auditMultiOrganizationState(client, { requireTwoOrganizations: false });
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
    const [counts, invalidScopes, invalidManifest, invalidReferences, tenantRows, globalLatest, unhealthyArtifacts, demoState] = await Promise.all([
      client.query<{ artifacts: string; restoreRuns: string }>(`SELECT (SELECT count(*) FROM "BackupArtifact")::text AS artifacts, (SELECT count(*) FROM "OrganizationRestoreRun")::text AS "restoreRuns"`),
      queryCount(client, `SELECT count(*)::text FROM "BackupArtifact" WHERE (scope = 'PLATFORM' AND "organizationId" IS NOT NULL) OR (scope IN ('ORGANIZATION', 'LEGACY_SINGLETON') AND "organizationId" IS NULL)`),
      queryCount(client, `SELECT count(*)::text FROM "BackupArtifact" WHERE "manifestAvailable" AND ("formatVersion" IS NULL OR "keyVersion" IS NULL OR "payloadSha256" IS NULL OR "manifestSha256" IS NULL)`),
      queryCount(client, `SELECT count(*)::text FROM "OrganizationRestoreRun" r LEFT JOIN "BackupArtifact" a ON a."id" = r."artifactId" WHERE a."id" IS NULL OR a."organizationId" IS DISTINCT FROM r."organizationId"`),
      client.query<{ organizationId: string; latestVerifiedAt: Date | null }>(`
        SELECT o."id" AS "organizationId", max(a."createdAt") AS "latestVerifiedAt"
        FROM "Organization" o
        LEFT JOIN "BackupArtifact" a
          ON a."organizationId" = o."id" AND a.scope = 'ORGANIZATION' AND a.status = 'VERIFIED'
        WHERE o.status = 'ACTIVE'
          AND o.kind <> 'DEMO'
        GROUP BY o."id"
      `),
      client.query<{ latestVerifiedAt: Date | null }>(`
        SELECT max("createdAt") AS "latestVerifiedAt"
        FROM "BackupArtifact"
        WHERE scope = 'PLATFORM' AND "organizationId" IS NULL AND status = 'VERIFIED'
      `),
      client.query<{ blocked: string; staleCreating: string }>(`
        SELECT
          count(*) FILTER (WHERE status = 'BLOCKED')::text AS blocked,
          count(*) FILTER (WHERE status = 'CREATING' AND "updatedAt" < now() - interval '2 hours')::text AS "staleCreating"
        FROM "BackupArtifact"
      `),
      client.query<{ activeDemos: string; demoBackupArtifacts: string; manifestsWithDemoPolicy: string; platformVerified: string }>(`
        SELECT
          (SELECT count(*) FROM "Organization" WHERE "kind" = 'DEMO' AND "status" = 'ACTIVE')::text AS "activeDemos",
          (SELECT count(*) FROM "BackupArtifact" a JOIN "Organization" o ON o."id" = a."organizationId" WHERE o."kind" = 'DEMO' AND a.scope = 'ORGANIZATION')::text AS "demoBackupArtifacts",
          (SELECT count(*) FROM "BackupArtifact" WHERE scope = 'PLATFORM' AND status = 'VERIFIED' AND "metadataJson" IS NOT NULL AND ("metadataJson"::jsonb #>> ARRAY['demoExclusion','policy']) = 'EXCLUDE_DEMO')::text AS "manifestsWithDemoPolicy",
          (SELECT count(*) FROM "BackupArtifact" WHERE scope = 'PLATFORM' AND status = 'VERIFIED')::text AS "platformVerified"
      `),
    ]);
    const row = counts.rows[0] ?? { artifacts: "0", restoreRuns: "0" };
    const now = new Date();
    const missingTenant = tenantRows.rows.filter((item) => !item.latestVerifiedAt).length;
    const overdueTenant = tenantRows.rows.filter((item) => item.latestVerifiedAt && getBackupScheduleStatus(item.latestVerifiedAt, now, TENANT_BACKUP_INTERVAL_DAYS).due).length;
    const latestGlobalAt = globalLatest.rows[0]?.latestVerifiedAt ?? null;
    const globalSchedule = getBackupScheduleStatus(latestGlobalAt, now, PLATFORM_BACKUP_INTERVAL_DAYS);
    const unhealthy = unhealthyArtifacts.rows[0] ?? { blocked: "0", staleCreating: "0" };
    if (invalidScopes || invalidManifest || invalidReferences) issues.push(issue("BACKUP_CATALOG_INTEGRITY_FAILED", "BLOCKED", "La consistencia del catálogo de backups falló."));
    if (Number(row.artifacts) === 0) issues.push(issue("BACKUP_CATALOG_EMPTY", "WARN", "El catálogo de backups no contiene artifacts; no se inspeccionaron payloads."));
    if (missingTenant > 0) issues.push(issue("TENANT_BACKUP_MISSING", "BLOCKED", `${missingTenant} organizaciones activas no tienen backup tenant VERIFIED.`));
    if (overdueTenant > 0) issues.push(issue("TENANT_BACKUP_OVERDUE", "BLOCKED", `${overdueTenant} organizaciones activas tienen el RPO diario vencido.`));
    if (!latestGlobalAt || globalSchedule.due) issues.push(issue("PLATFORM_BACKUP_OVERDUE", "BLOCKED", "El backup global semanal no existe o está vencido."));
    if (Number(unhealthy.blocked) > 0) issues.push(issue("BACKUP_ARTIFACTS_BLOCKED", "BLOCKED", `El catálogo contiene ${Number(unhealthy.blocked)} artefactos BLOCKED.`));
    if (Number(unhealthy.staleCreating) > 0) issues.push(issue("BACKUP_ARTIFACTS_STALE_CREATING", "BLOCKED", `El catálogo contiene ${Number(unhealthy.staleCreating)} artefactos CREATING antiguos.`));
    const demo = demoState.rows[0] ?? { activeDemos: "0", demoBackupArtifacts: "0", manifestsWithDemoPolicy: "0", platformVerified: "0" };
    if (Number(demo.demoBackupArtifacts) > 0) issues.push(issue("DEMO_BACKUP_NOT_EXCLUDED", "BLOCKED", `El catálogo contiene ${Number(demo.demoBackupArtifacts)} artifacts de backup de organizaciones DEMO.`));
    if (Number(demo.platformVerified) > 0 && Number(demo.manifestsWithDemoPolicy) === 0) issues.push(issue("DEMO_EXCLUSION_MANIFEST_MISSING", "BLOCKED", "Ningún backup de plataforma VERIFIED declara la exclusión DEMO."));
    return {
      status: aggregateVerificationStatus(issues),
      artifactCount: Number(row.artifacts),
      restoreRunCount: Number(row.restoreRuns),
      invalidScopeCount: invalidScopes,
      invalidManifestCount: invalidManifest,
      invalidReferenceCount: invalidReferences,
      activeOrganizationCount: tenantRows.rowCount ?? 0,
      tenantMissingCount: missingTenant,
      tenantOverdueCount: overdueTenant,
      platformWeeklyStatus: globalSchedule.status,
      blockedArtifactCount: Number(unhealthy.blocked),
      staleCreatingCount: Number(unhealthy.staleCreating),
      activeDemoCount: Number(demo.activeDemos),
      demoBackupArtifactCount: Number(demo.demoBackupArtifacts),
      demoExclusionManifestCount: Number(demo.manifestsWithDemoPolicy),
      catalogAndRpoOnly: true,
      payloadsInspected: false,
      recoverabilityVerified: false,
    };
  } catch (error) {
    issues.push(issue("BACKUP_CHECK_FAILED", "BLOCKED", `No se pudo verificar el catálogo de backups (${safeErrorCode(error)}).`));
    return { status: "BLOCKED" };
  }
}

export function resolveProductionTenantMode(value = process.env.PRODUCTION_EXPECTED_TENANT_MODE): ProductionTenantMode | "INVALID" {
  const normalized = value?.trim() || "single-org";
  return normalized === "single-org" || normalized === "multi-org" ? normalized : "INVALID";
}

function verifyRuntimeConfiguration(issues: VerificationIssue[], mode: ProductionTenantMode) {
  const configuredNoraMode = process.env.NORA_AGENT_MODE?.trim().toLowerCase();
  const noraAgentMode = configuredNoraMode === "off" || configuredNoraMode === "admin" || configuredNoraMode === "all" ? configuredNoraMode : "off";
  if (!configuredNoraMode || !["off", "admin", "all"].includes(configuredNoraMode)) {
    issues.push(issue("NORA_MODE_NOT_EXPLICIT", "WARN", "NORA_AGENT_MODE no está explícitamente configurado; Nora permanece fail-closed en off."));
  }
  const killSwitches = [
    "PLATFORM_UPLOADS_ENABLED",
    "PLATFORM_NORA_ENABLED",
    "PLATFORM_IMPORTS_ENABLED",
    "PLATFORM_EXPORTS_ENABLED",
    "PLATFORM_EMAIL_ENABLED",
    "PLATFORM_TELEGRAM_ENABLED",
    "PLATFORM_WHATSAPP_ENABLED",
    "PLATFORM_QUALITAS_ENABLED",
  ] as const;
  const missingKillSwitches = killSwitches.filter((name) => !["0", "1"].includes(process.env[name]?.trim() ?? ""));
  if (missingKillSwitches.length > 0) {
    issues.push(issue(
      "GLOBAL_KILL_SWITCHES_NOT_EXPLICIT",
      mode === "multi-org" ? "BLOCKED" : "WARN",
      `Faltan ${missingKillSwitches.length} kill switches globales explícitos para el entorno de ejecución.`,
    ));
  }
  return {
    status: aggregateVerificationStatus(issues),
    noraAgentMode,
    noraModeExplicit: configuredNoraMode === noraAgentMode,
    billingMutationsGuarded: process.env.PLATFORM_BILLING_MUTATIONS_ENABLED !== "1",
    killSwitchesExplicit: missingKillSwitches.length === 0,
    missingKillSwitchCount: missingKillSwitches.length,
  };
}

async function verifyDatabaseRole(client: PoolClient, mode: ProductionTenantMode, issues: VerificationIssue[], usingReadOnlyVerifier: boolean) {
  try {
    const current = await client.query<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean }>(`SELECT current_user, r.rolsuper, r.rolbypassrls, r.rolcanlogin FROM pg_roles r WHERE r.rolname = current_user`);
    const row = current.rows[0];
    const expected = usingReadOnlyVerifier
      ? process.env.PRODUCTION_READONLY_ROLE?.trim()
      : process.env.TENANT_RLS_APP_ROLE?.trim();
    if (!row) issues.push(issue("RUNTIME_ROLE_MISSING", "BLOCKED", "No se pudo resolver current_user en pg_roles."));
    if (row?.rolsuper || row?.rolbypassrls) issues.push(issue("RUNTIME_ROLE_BYPASSES_RLS", "BLOCKED", "El runtime verifier usa un rol superusuario o BYPASSRLS."));
    if (row && !row.rolcanlogin) issues.push(issue("RUNTIME_ROLE_CANNOT_LOGIN", "BLOCKED", "El rol runtime no puede iniciar sesión con DATABASE_URL."));
    if (expected && row?.current_user !== expected) issues.push(issue("RUNTIME_ROLE_UNEXPECTED", "BLOCKED", `current_user no coincide con el rol esperado ${expected}.`));
    if (!expected && mode === "multi-org") issues.push(issue("RUNTIME_ROLE_NOT_DECLARED", "BLOCKED", usingReadOnlyVerifier ? "PRODUCTION_READONLY_ROLE es obligatorio cuando se usa PRODUCTION_READONLY_DATABASE_URL." : "TENANT_RLS_APP_ROLE es obligatorio en modo multi-org."));
    if (usingReadOnlyVerifier && !process.env.TENANT_RLS_APP_ROLE?.trim() && mode === "multi-org") issues.push(issue("RUNTIME_ROLE_NOT_DECLARED", "BLOCKED", "TENANT_RLS_APP_ROLE también es obligatorio para verificar los grants del runtime."));
    const owners = await queryCount(client, `SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = ANY($1::text[]) AND pg_get_userbyid(c.relowner) = current_user`, [PROTECTED_TENANT_TABLES]);
    if (owners > 0) issues.push(issue("RUNTIME_ROLE_OWNS_PROTECTED_TABLE", "BLOCKED", "El rol runtime no puede ser dueño de tablas protegidas."));
    const securityDefiner = await client.query<{ owner: string | null; canLogin: boolean | null; bypassRls: boolean | null; config: string[] | null }>(`
      SELECT pg_get_userbyid(p.proowner) AS owner, r.rolcanlogin AS "canLogin", r.rolbypassrls AS "bypassRls", p.proconfig AS config
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        LEFT JOIN pg_roles r ON r.rolname = pg_get_userbyid(p.proowner)
       WHERE n.nspname = 'public' AND p.proname = 'policydesk_platform_tenant_metrics'
       ORDER BY p.oid DESC
       LIMIT 1
    `);
    const aggregateOwner = securityDefiner.rows[0];
    const expectedAggregateOwner = process.env.TENANT_RLS_PLATFORM_OWNER_ROLE?.trim() || "policydesk_platform_owner";
    if (!aggregateOwner) issues.push(issue("SECURITY_DEFINER_MISSING", "BLOCKED", "Falta el aggregate SECURITY DEFINER de platform."));
    else {
      if (aggregateOwner.owner !== expectedAggregateOwner) issues.push(issue("SECURITY_DEFINER_OWNER_UNEXPECTED", "BLOCKED", `El aggregate SECURITY DEFINER debe pertenecer a ${expectedAggregateOwner}.`));
      if (aggregateOwner.canLogin) issues.push(issue("SECURITY_DEFINER_OWNER_LOGIN", "BLOCKED", "El dueño del aggregate SECURITY DEFINER no puede iniciar sesión."));
      if (!aggregateOwner.bypassRls) issues.push(issue("SECURITY_DEFINER_OWNER_RLS", "BLOCKED", "El dueño del aggregate SECURITY DEFINER debe poder leer agregados fuera de un tenant."));
      if (!aggregateOwner.config?.some((entry) => entry === "search_path=pg_catalog, public")) {
        issues.push(issue("SECURITY_DEFINER_SEARCH_PATH_UNSAFE", "BLOCKED", "El aggregate SECURITY DEFINER debe fijar search_path=pg_catalog, public."));
      }
    }
    let missingRuntimePrivileges = 0;
    let unexpectedRuntimePrivileges = 0;
    let platformRuntimeStateCanWrite = false;
    const runtimeRole = process.env.TENANT_RLS_APP_ROLE?.trim() || expected;
    if (runtimeRole) {
      missingRuntimePrivileges = await queryCount(client, `
        SELECT count(*)::text FROM unnest($2::text[]) AS tables(table_name)
         WHERE NOT has_table_privilege($1, format('public.%I', table_name), 'SELECT')
            OR NOT has_table_privilege($1, format('public.%I', table_name), 'INSERT')
            OR NOT has_table_privilege($1, format('public.%I', table_name), 'UPDATE')
            OR NOT has_table_privilege($1, format('public.%I', table_name), 'DELETE')
      `, [runtimeRole, PROTECTED_TENANT_TABLES]);
      if (missingRuntimePrivileges > 0) issues.push(issue("RUNTIME_GRANTS_INCOMPLETE", "BLOCKED", `El rol runtime carece de DML explícito en ${missingRuntimePrivileges} tablas protegidas.`));

      // Verify the complete least-privilege matrix, not only the protected
      // tables. This catches a role that can still mutate platform plans,
      // runtime state, or other global control rows after the cutover.
      const expectedPrivileges = new Map<string, Set<string>>();
      for (const table of PROTECTED_TENANT_TABLES) expectedPrivileges.set(table, new Set(["SELECT", "INSERT", "UPDATE", "DELETE"]));
      for (const table of OPTIONAL_ORGANIZATION_TABLES) expectedPrivileges.set(table, new Set(["SELECT", "INSERT", "UPDATE", "DELETE"]));
      for (const table of ["User", "Organization", "OrganizationMembership", "NotificationChannel", "TelegramWebhookUpdate", "SystemSetting", "Session", "UserPreference"]) {
        expectedPrivileges.set(table, new Set(["SELECT", "INSERT", "UPDATE", "DELETE"]));
      }
      expectedPrivileges.set("PlatformAuditLog", new Set(["SELECT", "INSERT"]));
      expectedPrivileges.set("Plan", new Set(["SELECT"]));
      expectedPrivileges.set("GeneralKnowledgeSource", new Set(["SELECT"]));
      expectedPrivileges.set("GeneralKnowledgeChunk", new Set(["SELECT"]));
      expectedPrivileges.set("PlatformRuntimeState", new Set(["SELECT"]));
      const granted = await client.query<{ table_name: string; privilege_type: string }>(`
        SELECT table_name, privilege_type
          FROM information_schema.role_table_grants
         WHERE grantee = $1 AND table_schema = 'public'
      `, [runtimeRole]);
      const actualPrivileges = new Map<string, Set<string>>();
      for (const grant of granted.rows) {
        const privileges = actualPrivileges.get(grant.table_name) ?? new Set<string>();
        privileges.add(grant.privilege_type);
        actualPrivileges.set(grant.table_name, privileges);
      }
      for (const [table, privileges] of expectedPrivileges) {
        for (const privilege of privileges) {
          if (!actualPrivileges.get(table)?.has(privilege)) missingRuntimePrivileges++;
        }
      }
      for (const [table, privileges] of actualPrivileges) {
        const expectedForTable = expectedPrivileges.get(table);
        for (const privilege of privileges) {
          if (!expectedForTable?.has(privilege)) unexpectedRuntimePrivileges++;
        }
      }
      if (unexpectedRuntimePrivileges > 0) issues.push(issue("RUNTIME_GRANTS_TOO_BROAD", "BLOCKED", `El rol runtime tiene ${unexpectedRuntimePrivileges} privilegios de tabla fuera de la matriz aprobada.`));
      if (missingRuntimePrivileges > 0 && !issues.some((item) => item.code === "RUNTIME_GRANTS_INCOMPLETE")) {
        issues.push(issue("RUNTIME_GRANTS_INCOMPLETE", "BLOCKED", `La matriz de privilegios runtime tiene ${missingRuntimePrivileges} permisos faltantes.`));
      }

      const privilegedFunctions = await client.query<{ proname: string; has_execute: boolean }>(`
        SELECT p.proname, has_function_privilege($1, p.oid, 'EXECUTE') AS has_execute
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.prosecdef
      `, [runtimeRole]);
      const allowedSecurityDefiners = new Set(["policydesk_platform_tenant_metrics"]);
      const unauthorizedSecurityDefiners = privilegedFunctions.rows.filter((fn) => fn.has_execute && !allowedSecurityDefiners.has(fn.proname));
      if (unauthorizedSecurityDefiners.length > 0) issues.push(issue("RUNTIME_SECURITY_DEFINER_GRANTS_TOO_BROAD", "BLOCKED", `El rol runtime puede ejecutar ${unauthorizedSecurityDefiners.length} funciones SECURITY DEFINER no aprobadas.`));
      const controlPrivilege = await client.query<{ canInsert: boolean; canUpdate: boolean; canDelete: boolean }>(`
        SELECT has_table_privilege($1, 'public."PlatformRuntimeState"', 'INSERT') AS "canInsert",
               has_table_privilege($1, 'public."PlatformRuntimeState"', 'UPDATE') AS "canUpdate",
               has_table_privilege($1, 'public."PlatformRuntimeState"', 'DELETE') AS "canDelete"
      `, [runtimeRole]);
      platformRuntimeStateCanWrite = Boolean(controlPrivilege.rows[0]?.canInsert || controlPrivilege.rows[0]?.canUpdate || controlPrivilege.rows[0]?.canDelete);
      if (platformRuntimeStateCanWrite) issues.push(issue("PLATFORM_RUNTIME_STATE_GRANT_TOO_BROAD", "BLOCKED", "El rol runtime no puede modificar PlatformRuntimeState; ese flujo es operativo y directo."));
    }
    return {
      status: aggregateVerificationStatus(issues),
      currentUser: row?.current_user ?? "UNKNOWN",
      expectedRole: expected ?? null,
      isSuperuser: row?.rolsuper ?? null,
      bypassRls: row?.rolbypassrls ?? null,
      canLogin: row?.rolcanlogin ?? null,
      protectedTablesOwned: owners,
      missingRuntimePrivileges,
      unexpectedRuntimePrivileges,
      platformRuntimeStateCanWrite,
      securityDefinerOwner: aggregateOwner?.owner ?? null,
      securityDefinerOwnerCanLogin: aggregateOwner?.canLogin ?? null,
      securityDefinerOwnerBypassRls: aggregateOwner?.bypassRls ?? null,
    };
  } catch (error) {
    issues.push(issue("RUNTIME_ROLE_CHECK_FAILED", "BLOCKED", `No se pudo verificar el rol runtime (${safeErrorCode(error)}).`));
    return { status: "BLOCKED", currentUser: "UNKNOWN" };
  }
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
    const usingReadOnlyVerifier = Boolean(process.env.PRODUCTION_READONLY_DATABASE_URL?.trim());
    const [migrations, organization, tenant, rls, knowledge, billing, backup, runtimeConfiguration, databaseRole] = await Promise.all([
      verifyMigrations(client, migrationIssues, mode),
      verifyOrganization(client, mode, organizationIssues),
      verifyTenant(client, mode, tenantIssues),
      verifyRls(client, mode, rlsIssues),
      verifyKnowledge(client, knowledgeIssues),
      verifyBilling(client, billingIssues),
      verifyBackup(client, backupIssues),
      Promise.resolve(verifyRuntimeConfiguration(runtimeIssues, mode)),
      verifyDatabaseRole(client, mode, runtimeIssues, usingReadOnlyVerifier),
    ]);
    await client.query("ROLLBACK");
    const allIssues = [...issues, ...migrationIssues, ...organizationIssues, ...tenantIssues, ...rlsIssues, ...knowledgeIssues, ...billingIssues, ...backupIssues, ...runtimeIssues];
    const status = aggregateVerificationStatus(allIssues);
    return { status, generatedAt: new Date().toISOString(), tenantMode, sections: { migrations, organization, tenant, rls, knowledge, billing, backup, runtimeConfiguration: { ...runtimeConfiguration, databaseRole } }, issues: allIssues };
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
