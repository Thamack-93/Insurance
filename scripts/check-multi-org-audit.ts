import "dotenv/config";

import { Pool, type PoolClient } from "pg";
import {
  EXPECTED_TENANT_TRIGGERS,
  OPTIONAL_ORGANIZATION_TABLES,
  PROTECTED_TENANT_TABLES,
  SYSTEM_USER_ID,
  TENANT_RELATION_CHECKS,
} from "../src/lib/tenant-organization-foundation.ts";

type AuditResult = { ok: boolean; issues: string[]; summary: Record<string, number | string | boolean> };

function identifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function connectionString() {
  const value = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("POLICYDESK_MULTI_ORG_DATABASE_REQUIRED");
  return value;
}

async function count(client: PoolClient, sql: string, values: unknown[] = []) {
  const result = await client.query<{ count: string }>(sql, values);
  return Number(result.rows[0]?.count ?? 0);
}

export async function auditMultiOrganizationState(client: PoolClient): Promise<AuditResult> {
  const issues: string[] = [];
  const summary: Record<string, number | string | boolean> = {};
  const organizations = await client.query<{ id: string; kind: string; status: string }>(`SELECT "id","kind","status" FROM "Organization" ORDER BY "id"`);
  summary.organizationCount = organizations.rowCount ?? 0;
  if ((organizations.rowCount ?? 0) < 2) issues.push("MULTI_ORG_REQUIRES_AT_LEAST_TWO_ORGANIZATIONS");
  if (organizations.rows.some(({ kind }) => !["LEGACY", "CUSTOMER", "DEMO"].includes(kind))) issues.push("ORGANIZATION_KIND_INVALID");
  if (organizations.rows.some(({ status }) => !["ACTIVE", "SUSPENDED"].includes(status))) issues.push("ORGANIZATION_STATUS_INVALID");

  const barrierNames = [
    "Organization_transition_singleton_idx",
    "OrganizationMembership_transition_owner_idx",
    "Organization_transition_delete_guard",
    "Organization_transition_truncate_guard",
    "OrganizationMembership_transition_guard",
    "User_transition_membership_sync",
    "User_transition_owner_delete_guard",
    ...Object.values(EXPECTED_TENANT_TRIGGERS),
  ];
  const barriers = await count(client, `
    SELECT count(*)::text AS count FROM (
      SELECT indexname AS name FROM pg_indexes WHERE schemaname='public'
      UNION ALL
      SELECT t.tgname AS name FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal
    ) objects WHERE name = ANY($1::text[])
  `, [barrierNames]);
  summary.singletonBarrierObjectCount = barriers;
  if (barriers > 0) issues.push("SINGLETON_BARRIER_PRESENT");

  const duplicateMemberships = await count(client, `SELECT count(*)::text AS count FROM (SELECT "userId" FROM "OrganizationMembership" GROUP BY "userId" HAVING count(*) > 1) duplicate_memberships`);
  summary.usersWithMultipleMemberships = duplicateMemberships;
  if (duplicateMemberships > 0) issues.push("MULTIPLE_MEMBERSHIPS_FOUND");
  const forbiddenMemberships = await count(client, `SELECT count(*)::text AS count FROM "OrganizationMembership" m JOIN "User" u ON u."id"=m."userId" WHERE u."id"=$1 OR u."platformRole"='SUPERADMIN'`, [SYSTEM_USER_ID]);
  if (forbiddenMemberships > 0) issues.push("PLATFORM_OR_SYSTEM_MEMBERSHIP_FOUND");

  for (const organization of organizations.rows) {
    const activeOwners = await count(client, `SELECT count(*)::text AS count FROM "OrganizationMembership" m JOIN "User" u ON u."id"=m."userId" WHERE m."organizationId"=$1 AND m."role"='OWNER' AND m."active" AND u."active"`, [organization.id]);
    summary[`${organization.id}.activeOwners`] = activeOwners;
    if (activeOwners !== 1) issues.push(`ORGANIZATION_OWNER_COUNT_INVALID:${organization.id}`);
  }

  for (const table of PROTECTED_TENANT_TABLES) {
    const nulls = await count(client, `SELECT count(*)::text AS count FROM ${identifier(table)} WHERE "organizationId" IS NULL`);
    summary[`${table}.nullOrganizationId`] = nulls;
    if (nulls > 0) issues.push(`TENANT_NULL:${table}`);
    const dangling = await count(client, `SELECT count(*)::text AS count FROM ${identifier(table)} t LEFT JOIN "Organization" o ON o."id"=t."organizationId" WHERE t."organizationId" IS NOT NULL AND o."id" IS NULL`);
    if (dangling > 0) issues.push(`TENANT_DANGLING_ORGANIZATION:${table}`);
  }
  for (const table of OPTIONAL_ORGANIZATION_TABLES) {
    const dangling = await count(client, `SELECT count(*)::text AS count FROM ${identifier(table)} t LEFT JOIN "Organization" o ON o."id"=t."organizationId" WHERE t."organizationId" IS NOT NULL AND o."id" IS NULL`);
    if (dangling > 0) issues.push(`OPTIONAL_DANGLING_ORGANIZATION:${table}`);
  }
  for (const [child, column, parent] of TENANT_RELATION_CHECKS) {
    const crossed = await count(client, `SELECT count(*)::text AS count FROM ${identifier(child)} c JOIN ${identifier(parent)} p ON p."id"=c.${identifier(column)} WHERE c.${identifier(column)} IS NOT NULL AND c."organizationId" IS DISTINCT FROM p."organizationId"`);
    if (crossed > 0) issues.push(`TENANT_RELATION_MISMATCH:${child}.${column}`);
  }

  const portfolioMismatch = await count(client, `SELECT count(*)::text AS count FROM "Client" c LEFT JOIN "OrganizationMembership" m ON m."userId"=c."portfolioOwnerId" AND m."organizationId"=c."organizationId" AND m."active" WHERE c."portfolioOwnerId" IS NOT NULL AND m."id" IS NULL`);
  if (portfolioMismatch > 0) issues.push("PORTFOLIO_MEMBERSHIP_MISMATCH");
  const assignmentMismatch = await count(client, `SELECT count(*)::text AS count FROM "WorkItem" w LEFT JOIN "OrganizationMembership" m ON m."userId"=w."assignedToId" AND m."organizationId"=w."organizationId" AND m."active" WHERE w."assignedToId" IS NOT NULL AND m."id" IS NULL`);
  if (assignmentMismatch > 0) issues.push("ASSIGNED_MEMBERSHIP_MISMATCH");

  const unsafeDemoMembers = await count(client, `SELECT count(*)::text AS count FROM "OrganizationMembership" m JOIN "Organization" o ON o."id"=m."organizationId" JOIN "User" u ON u."id"=m."userId" WHERE o."kind"='DEMO' AND lower(u."email") NOT LIKE '%@policydesk.local'`);
  if (unsafeDemoMembers > 0) issues.push("DEMO_MEMBERSHIP_NOT_SYNTHETIC");

  const tenantDedupeIndexes = await client.query<{ indexname: string; indexdef: string }>(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname='public' AND indexname = ANY($1::text[])
  `, [["WorkItem_organizationId_sourceType_sourceId_key", "NotificationEvent_organizationId_dedupeKey_key", "Payment_organizationId_sourceEvidenceKey_key"]]);
  const definitions = new Map(tenantDedupeIndexes.rows.map(({ indexname, indexdef }) => [indexname, indexdef]));
  if (!definitions.get("WorkItem_organizationId_sourceType_sourceId_key")?.includes('UNIQUE INDEX') || !definitions.get("WorkItem_organizationId_sourceType_sourceId_key")?.includes('"organizationId", "sourceType", "sourceId"')) issues.push("WORK_ITEM_TENANT_DEDUPE_INDEX_INVALID");
  if (!definitions.get("NotificationEvent_organizationId_dedupeKey_key")?.includes('UNIQUE INDEX') || !definitions.get("NotificationEvent_organizationId_dedupeKey_key")?.includes('"organizationId", "dedupeKey"')) issues.push("NOTIFICATION_EVENT_TENANT_DEDUPE_INDEX_INVALID");
  if (!definitions.get("Payment_organizationId_sourceEvidenceKey_key")?.includes('UNIQUE INDEX') || !definitions.get("Payment_organizationId_sourceEvidenceKey_key")?.includes('"organizationId", "sourceEvidenceKey"')) issues.push("PAYMENT_TENANT_EVIDENCE_INDEX_INVALID");

  return { ok: issues.length === 0, issues, summary };
}

async function main() {
  const json = process.argv.includes("--json");
  const pool = new Pool({ connectionString: connectionString(), max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await auditMultiOrganizationState(client);
    await client.query("COMMIT");
    const payload = { mode: "multi-org-audit", ...result };
    if (json) console.log(JSON.stringify(payload, null, 2));
    else console.log(result.ok ? `Multi-org audit PASS (${result.summary.organizationCount} organizations).` : `Multi-org audit FAIL: ${result.issues.join("; ")}`);
    if (!result.ok) process.exitCode = 1;
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(JSON.stringify({ mode: "multi-org-audit", ok: false, error: "POLICYDESK_MULTI_ORG_AUDIT_FAILED" }));
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("check-multi-org-audit.ts")) void main();
