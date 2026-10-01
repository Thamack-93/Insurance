import { mkdir, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { validateDomainInvariants, validateForeignKeys } from "../src/lib/backup-restore-validation";
import { assertDisposableCertificationTarget } from "./tenant-certification-target.mjs";

// Baseline validation of the source fixture; never a restore certificate.
async function main() {
  const connectionString = process.env.DATABASE_ADMIN_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_ADMIN_URL_REQUIRED");
  const target = assertDisposableCertificationTarget(connectionString);
  const candidateSha = process.env.CERTIFICATION_CANDIDATE_SHA?.trim();
  if (!candidateSha || target.mode !== "neon" || target.branchName !== `cert-stage3-${candidateSha}`) throw new Error("REQUIRES_SHA_BOUND_TEMPORARY_SOURCE");
  const pool = new Pool({ connectionString, max: 1, application_name: "policydesk-certification-source-integrity" });
  const client = await pool.connect();
  const report: Record<string, unknown> = { status: "RUNNING", candidateSha, scope: "SOURCE_BASELINE_ONLY", readOnly: true, source: target };
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const marker = await client.query<{ fingerprint: string }>('SELECT fingerprint FROM "__policydesk_tenant_isolation_run" WHERE run_id=$1', [target.runId]);
    if (marker.rowCount !== 1 || marker.rows[0].fingerprint !== target.fingerprint) throw new Error("CERTIFICATION_MARKER_MISMATCH");
    const foreignKeys = await validateForeignKeys(client);
    report.foreignKeys = foreignKeys;
    const domainChecks = await validateDomainInvariants(client);
    await client.query("ROLLBACK");
    Object.assign(report, { status: "PASS", domainChecks });
    console.log(JSON.stringify({ ...report, foreignKeys: foreignKeys.length, domainChecks: domainChecks.length }));
  } catch (error) {
    report.status = "FAIL";
    report.failure = (error instanceof Error ? error.message : "SOURCE_INTEGRITY_FAILED").replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "postgresql://[redacted]");
    throw error;
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
    report.completedAt = new Date().toISOString();
    await mkdir("artifacts/tenant-certification", { recursive: true });
    await writeFile("artifacts/tenant-certification/source-integrity-baseline.json", JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  }
}

main().catch((error) => {
  console.error((error instanceof Error ? error.message : "SOURCE_INTEGRITY_FAILED").replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "postgresql://[redacted]"));
  process.exitCode = 1;
});
