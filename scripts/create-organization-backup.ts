import "dotenv/config";
import { Pool } from "pg";

import { buildManualOrganizationBackupTarget } from "../src/lib/backup.ts";
import { createAndCatalogBackup } from "../src/lib/backup-orchestrator.ts";
import { assertRemoteTenantBackupTarget } from "./tenant-certification-target.mjs";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function assertDirectDatabaseUrl() {
  const value = required("DATABASE_ADMIN_URL");
  const url = new URL(value);
  if (/pooler/i.test(url.hostname) || url.searchParams.has("pgbouncer")) throw new Error("BACKUP_REQUIRES_DIRECT_DATABASE_URL");
}

async function assertSyntheticCustomerCertificationDatabase(organizationId: string) {
  if (organizationId !== required("TENANT_CERTIFICATION_ORGANIZATION_ID")) throw new Error("TENANT_BACKUP_CERTIFICATION_ORGANIZATION_MISMATCH");
  const adminUrl = required("DATABASE_ADMIN_URL");
  const runtimeUrl = required("DATABASE_URL");
  const target = assertRemoteTenantBackupTarget(adminUrl, runtimeUrl);
  const pool = new Pool({ connectionString: adminUrl, max: 1, application_name: "policydesk-tenant-backup-preflight" });
  try {
    const marker = await pool.query<{ run_id: string; database_name: string; host: string; fingerprint: string }>(
      `SELECT run_id, database_name, host, fingerprint
       FROM "__policydesk_tenant_isolation_run"
       WHERE run_id = $1`,
      [target.runId],
    );
    if (marker.rowCount !== 1 || marker.rows[0].database_name !== target.database || marker.rows[0].host !== target.host || marker.rows[0].fingerprint !== target.fingerprint) {
      throw new Error("TENANT_BACKUP_CERTIFICATION_MARKER_MISMATCH");
    }
    const organization = await pool.query<{ kind: string; status: string }>(
      'SELECT kind, status FROM "Organization" WHERE id = $1',
      [organizationId],
    );
    if (organization.rowCount !== 1 || organization.rows[0].kind !== "CUSTOMER" || organization.rows[0].status !== "ACTIVE") {
      throw new Error("TENANT_BACKUP_REQUIRES_ACTIVE_SYNTHETIC_CUSTOMER_ORGANIZATION");
    }
    const fixture = await pool.query<{ documents: string; nonFixtureMembers: string; nonFixtureClients: string; nonFixturePolicies: string; nonFixtureReceipts: string }>(`
      SELECT
        (SELECT count(*)::text FROM "Document" WHERE "organizationId" = $1) AS documents,
        (SELECT count(*)::text FROM "OrganizationMembership" m JOIN "User" u ON u.id = m."userId" WHERE m."organizationId" = $1 AND u.email NOT LIKE 'tenant-%@policydesk.local') AS "nonFixtureMembers",
        (SELECT count(*)::text FROM "Client" WHERE "organizationId" = $1 AND id NOT LIKE 'tenant-%') AS "nonFixtureClients",
        (SELECT count(*)::text FROM "Policy" WHERE "organizationId" = $1 AND id NOT LIKE 'tenant-%') AS "nonFixturePolicies",
        (SELECT count(*)::text FROM "Receipt" WHERE "organizationId" = $1 AND id NOT LIKE 'tenant-%') AS "nonFixtureReceipts"
    `, [organizationId]);
    const counts = fixture.rows[0];
    if (!counts || Number(counts.documents) !== 0 || Number(counts.nonFixtureMembers) !== 0 || Number(counts.nonFixtureClients) !== 0 || Number(counts.nonFixturePolicies) !== 0 || Number(counts.nonFixtureReceipts) !== 0) {
      throw new Error("TENANT_BACKUP_CERTIFICATION_DATA_NOT_SYNTHETIC");
    }
  } finally {
    await pool.end();
  }
}

async function findVerifiedArtifactId(organizationId: string, pathname: string) {
  const pool = new Pool({ connectionString: required("DATABASE_ADMIN_URL"), max: 1, application_name: "policydesk-tenant-backup-artifact-id" });
  try {
    const result = await pool.query<{ id: string }>(
      `SELECT id FROM "BackupArtifact"
       WHERE scope = 'ORGANIZATION' AND "organizationId" = $1 AND pathname = $2 AND status = 'VERIFIED'
       ORDER BY "createdAt" DESC LIMIT 1`,
      [organizationId, pathname],
    );
    if (result.rowCount !== 1) throw new Error("TENANT_BACKUP_VERIFIED_ARTIFACT_ID_NOT_FOUND");
    return result.rows[0].id;
  } finally {
    await pool.end();
  }
}

async function main() {
  if (process.env.ALLOW_OPERATOR_BACKUP !== "1") throw new Error("ALLOW_OPERATOR_BACKUP=1 es obligatorio.");
  assertDirectDatabaseUrl();
  const organizationId = process.argv.slice(2).find((arg) => arg.startsWith("--organization="))?.slice("--organization=".length).trim();
  const skipPrune = process.argv.includes("--skip-prune");
  if (!organizationId) throw new Error("Uso: npm run backup:create:organization -- --organization=<id>");
  if (skipPrune) await assertSyntheticCustomerCertificationDatabase(organizationId);
  const now = new Date();
  const backup = await createAndCatalogBackup({ scope: "ORGANIZATION", organizationId, target: buildManualOrganizationBackupTarget(organizationId, now), skipPrune });
  const artifactId = await findVerifiedArtifactId(organizationId, backup.pathname);
  console.log(JSON.stringify({ status: "PASS", scope: backup.scope, organizationId, artifactId, filename: backup.filename, pathname: backup.pathname, createdAt: backup.createdAt }));
}

main().catch((error) => {
  console.error((error instanceof Error ? error.message : "ORGANIZATION_BACKUP_FAILED").replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "postgresql://[redacted]"));
  process.exitCode = 1;
});
