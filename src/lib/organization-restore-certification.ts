import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { PROTECTED_TENANT_TABLES } from "@/lib/tenant-organization-foundation";
import { auditMultiOrganizationState } from "../../scripts/check-multi-org-audit";
import { assertDisposableCertificationTarget, assertPersistedRestoreMarker, canonicalNeonHost } from "../../scripts/tenant-certification-target.mjs";
import { checkTargetMigrationDrift } from "@/lib/backup-restore";
import type { ParsedBackup } from "@/lib/backup-restore-validation";

export function assertRestoreCertificationConnections(sourceUrl: string, adminUrl: string, runtimeUrl: string, env = process.env) {
  if (!/^[0-9a-f]{40}$/.test(env.CERTIFICATION_CANDIDATE_SHA ?? "")) throw new Error("CERTIFICATION_CANDIDATE_SHA_REQUIRED");
  const source = assertDisposableCertificationTarget(sourceUrl, env);
  const targetEnv = {
    ...env,
    TENANT_ISOLATION_BRANCH_ID: env.RESTORE_NEON_BRANCH_ID,
    TENANT_ISOLATION_BRANCH_NAME: env.RESTORE_NEON_BRANCH,
    TENANT_ISOLATION_NEON_HOST: env.RESTORE_NEON_HOST,
    TENANT_ISOLATION_FINGERPRINT: env.RESTORE_TARGET_FINGERPRINT,
  };
  const target = assertDisposableCertificationTarget(adminUrl, targetEnv, "restore");
  const runtime = assertDisposableCertificationTarget(runtimeUrl, targetEnv, "restore");
  const admin = new URL(adminUrl);
  const app = new URL(runtimeUrl);
  if (source.mode !== "neon" || target.mode !== "neon" || runtime.mode !== "neon") throw new Error("RESTORE_REQUIRES_REMOTE_NEON");
  if (source.branchId === target.branchId || canonicalNeonHost(source.host) === target.host) throw new Error("RESTORE_TARGET_EQUALS_SOURCE");
  if (/-pooler\./i.test(admin.hostname) || admin.searchParams.has("pgbouncer")) throw new Error("RESTORE_REQUIRES_DIRECT_ADMIN_CONNECTION");
  if (!/-pooler\./i.test(app.hostname) || app.username !== "policydesk_app") throw new Error("RESTORE_REQUIRES_POOLED_RESTRICTED_RUNTIME");
  if (target.fingerprint !== runtime.fingerprint) throw new Error("RESTORE_RUNTIME_TARGET_MISMATCH");
  return { source, target };
}

export async function verifyRestoreMarker(adminUrl: string, target: ReturnType<typeof assertRestoreCertificationConnections>["target"]) {
  const pool = new Pool({ connectionString: adminUrl, max: 1 });
  try {
    const result = await pool.query<{ run_id: string; database_name: string; host: string; fingerprint: string }>(
      'SELECT run_id, database_name, host, fingerprint FROM "__policydesk_tenant_isolation_run"');
    assertPersistedRestoreMarker(result.rows, target);
  } finally { await pool.end(); }
}

function stableJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

const RESTORE_VALUE_TABLES = ["Policy", "PolicyInsuredParty", "PolicyInsuredAsset"] as const;
export function assertRestoreAcceptanceFixtures(parsed: ParsedBackup, organizationId: string) {
  const ids: Record<string, string> = { Policy: "tenant-recovery-policy-renewal", PolicyInsuredParty: "tenant-recovery-insured-party", PolicyInsuredAsset: "tenant-recovery-insured-asset" };
  for (const [table, id] of Object.entries(ids)) {
    const row = (parsed.rows.get(`public.${table}`) ?? []).find(record => record.data.id === id && record.data.organizationId === organizationId)?.data;
    if (!row) throw new Error(`RESTORE_ACCEPTANCE_FIXTURE_MISSING:${table}:${id}`);
    if (table === "Policy") {
      const sourceText = (row.riskDetails as { sourceText?: unknown } | null)?.sourceText;
      if (typeof row.insuredObject !== "string" || typeof sourceText !== "string" || !sourceText.trim()) throw new Error("RESTORE_ACCEPTANCE_FIXTURE_INCOMPLETE:Policy");
    }
  }
}
export function assertOrganizationRestoreValues(parsed: ParsedBackup, organizationId: string, actual: Record<string, Array<Record<string, unknown>>>) {
  for (const table of RESTORE_VALUE_TABLES) {
    const expectedRows = (parsed.rows.get(`public.${table}`) ?? []).map(({ data }) => data).filter(row => row.organizationId === organizationId);
    const actualRows = actual[table] ?? [];
    const byId = (rows: Array<Record<string, unknown>>) => new Map(rows.map(row => [String(row.id), row]));
    const expectedById = byId(expectedRows);
    const actualById = byId(actualRows);
    if (expectedById.size !== expectedRows.length || actualById.size !== actualRows.length || expectedById.size !== actualById.size) throw new Error(`RESTORE_VALUE_ROWSET_MISMATCH:${table}`);
    for (const [id, expected] of expectedById) {
      const row = actualById.get(id);
      if (!row) throw new Error(`RESTORE_VALUE_TARGET_ROW_MISSING:${table}:${id}`);
      if (stableJson(row) !== stableJson(expected)) {
        const differing = [...new Set([...Object.keys(expected), ...Object.keys(row)])].find(key => stableJson(expected[key]) !== stableJson(row[key]));
        throw new Error(`RESTORE_VALUE_PRESERVATION_FAILED:${table}:${id}:${differing ?? "row"}`);
      }
    }
  }
}

export async function certifyOrganizationRestore(input: { adminUrl: string; runtimeUrl: string; organizationId: string; tables: Array<{ table: string; rows: number }>; parsedBackup: ParsedBackup }) {
  const pool = new Pool({ connectionString: input.runtimeUrl, max: 1 });
  const client = await pool.connect();
  try {
    const role = await client.query<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>("SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user");
    if (role.rows[0]?.current_user !== "policydesk_app" || role.rows[0].rolsuper || role.rows[0].rolbypassrls) throw new Error("RESTORE_RUNTIME_ROLE_NOT_RESTRICTED");
    const rls = await client.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>("SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1::text[])", [PROTECTED_TENANT_TABLES]);
    for (const table of PROTECTED_TENANT_TABLES) if (!rls.rows.some(row => row.relname === table && row.relrowsecurity && row.relforcerowsecurity)) throw new Error(`RESTORE_RLS_NOT_FORCED:${table}`);
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SELECT set_config('app.organization_id', '', true)");
    for (const table of PROTECTED_TENANT_TABLES) {
      const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "${table}"`);
      if (Number(result.rows[0]?.count) !== 0) throw new Error(`RESTORE_UNSCOPED_READ_VISIBLE:${table}`);
    }
    await client.query("SELECT set_config('app.organization_id', $1, true)", [input.organizationId]);
    const counts: Record<string, number> = {};
    for (const expected of input.tables) {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(expected.table)) throw new Error("RESTORE_TABLE_INVALID");
      const scope = (PROTECTED_TENANT_TABLES as readonly string[]).includes(expected.table) ? "" : ' WHERE "organizationId" = $1';
      const result = await client.query<{ count: string; foreign_count: string }>(`SELECT count(*)::text AS count, count(*) FILTER (WHERE "organizationId" IS DISTINCT FROM $1)::text AS foreign_count FROM "${expected.table}"${scope}`, [input.organizationId]);
      const row = result.rows[0];
      if (Number(row?.count) !== expected.rows || Number(row?.foreign_count) !== 0) throw new Error(`RESTORE_RUNTIME_COUNT_OR_ISOLATION_FAILED:${expected.table}`);
      counts[expected.table] = Number(row.count);
    }
    await client.query("COMMIT");
    await client.query("BEGIN READ ONLY");
    const cleanup = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM "Client"');
    if (Number(cleanup.rows[0]?.count) !== 0) throw new Error("RESTORE_RUNTIME_CONTEXT_LEAK");
    await client.query("ROLLBACK");
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: input.runtimeUrl, max: 1 }) });
    let applicationReads;
    try {
      applicationReads = await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT set_config('app.organization_id', ${input.organizationId}, true)`;
        const where = { organizationId: input.organizationId };
        const result = { Client: await tx.client.count({ where }), Policy: await tx.policy.count({ where }), Receipt: await tx.receipt.count({ where }), Payment: await tx.payment.count({ where }), WorkItem: await tx.workItem.count({ where }) };
        for (const [table, count] of Object.entries(result)) if (counts[table] !== count) throw new Error(`RESTORE_APPLICATION_READ_MISMATCH:${table}`);
        await tx.policy.findMany({ where, take: 3, include: { client: true, receipts: true } });
        return result;
      });
    } finally { await db.$disconnect(); }
    {
      const valuePool = new Pool({ connectionString: input.adminUrl, max: 1 });
      try {
        const actual = Object.fromEntries(await Promise.all(RESTORE_VALUE_TABLES.map(async table => {
          const result = await valuePool.query(`SELECT * FROM "${table}" WHERE "organizationId"=$1 ORDER BY "id"`, [input.organizationId]);
          return [table, result.rows as Array<Record<string, unknown>>];
        })));
        assertOrganizationRestoreValues(input.parsedBackup, input.organizationId, actual);
      } finally { await valuePool.end(); }
    }
    const admin = new Pool({ connectionString: input.adminUrl, max: 1 });
    const auditor = await admin.connect();
    let audit;
    try {
      await auditor.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      audit = await auditMultiOrganizationState(auditor);
      if (!audit.ok) throw new Error("RESTORE_MULTI_ORG_AUDIT_FAILED");
      await auditor.query("COMMIT");
    } finally { await auditor.query("ROLLBACK").catch(() => undefined); auditor.release(); await admin.end(); }
    const drift = await checkTargetMigrationDrift(input.adminUrl);
    return { runtimeRole: "policydesk_app", forcedRlsTables: PROTECTED_TENANT_TABLES.length, counts, applicationReads, noContext: "PASS", isolation: "PASS", contextCleanup: "PASS", audit, drift };
  } finally { await client.query("ROLLBACK").catch(() => undefined); client.release(); await pool.end(); }
}
