import { describe, expect, it } from "vitest";
import {
  assertDisposableCertificationTarget,
  assertRestorePurposeGuard,
  assertRemoteTenantBackupTarget,
  canonicalNeonHost,
  certificationFingerprint,
  certificationPurpose,
} from "../../scripts/tenant-certification-target.mjs";

const baseEnv = {
  NODE_ENV: "test",
  TENANT_ISOLATION_TEST_DB: "1",
  PLAYWRIGHT_ENFORCE_DISPOSABLE_DB: "1",
  VERCEL_ENV: "",
};

describe("tenant certification target guard", () => {
  it("accepts an exact local disposable target", () => {
    const runId = "run_123";
    const database = "policydesk_tenant_test_run_123";
    const host = "127.0.0.1";
    const fingerprint = certificationFingerprint({ mode: "local", runId, database, host });
    expect(assertDisposableCertificationTarget(
      `postgresql://postgres:test@${host}:5432/${database}`,
      { ...baseEnv, TENANT_ISOLATION_RUN_ID: runId, TENANT_ISOLATION_DB_NAME: database, TENANT_ISOLATION_FINGERPRINT: fingerprint },
    ).mode).toBe("local");
  });

  it("accepts only an explicitly named and fingerprinted Stage 3 Neon branch", () => {
    const runId = "9d1a963";
    const database = "neondb";
    const branchId = "br-soft-recipe-apz29q8a";
    const branchName = "cert-stage3-9d1a963";
    const host = "ep-certification.c-7.us-east-1.aws.neon.tech";
    const fingerprint = certificationFingerprint({ mode: "neon", runId, database, host, branchId, branchName });
    const env = {
      ...baseEnv,
      TENANT_ISOLATION_REMOTE_BRANCH: "1",
      TENANT_ISOLATION_RUN_ID: runId,
      TENANT_ISOLATION_DB_NAME: database,
      TENANT_ISOLATION_FINGERPRINT: fingerprint,
      TENANT_ISOLATION_BRANCH_ID: branchId,
      TENANT_ISOLATION_BRANCH_NAME: branchName,
      TENANT_ISOLATION_NEON_HOST: host,
    };
    expect(assertDisposableCertificationTarget(`postgresql://owner:test@${host}/${database}`, env).mode).toBe("neon");
    expect(canonicalNeonHost("ep-certification-pooler.c-7.us-east-1.aws.neon.tech")).toBe(host);
  });

  it("accepts restore purpose only for the explicit full-SHA target and keeps backup source-only", () => {
    const sha = "a".repeat(40);
    const runId = "restore-run";
    const database = "neondb";
    const branchId = "br-restore-target";
    const branchName = `restore-cert-stage3-${sha}`;
    const host = "ep-restore.c-7.us-east-1.aws.neon.tech";
    const env = {
      ...baseEnv,
      TENANT_CERTIFICATION_PURPOSE: "restore",
      ALLOW_TEMPORARY_NEON_RESTORE: "true",
      TENANT_CERTIFICATION_REMOTE_BRANCH: "1",
      CERTIFICATION_CANDIDATE_SHA: sha,
      TENANT_ISOLATION_REMOTE_BRANCH: "1",
      TENANT_ISOLATION_RUN_ID: runId,
      TENANT_ISOLATION_DB_NAME: database,
      TENANT_ISOLATION_FINGERPRINT: certificationFingerprint({ mode: "neon", runId, database, host, branchId, branchName }),
      TENANT_ISOLATION_BRANCH_ID: branchId,
      TENANT_ISOLATION_BRANCH_NAME: branchName,
      TENANT_ISOLATION_NEON_HOST: host,
    };
    const admin = `postgresql://owner:test@${host}/${database}`;
    const runtime = `postgresql://policydesk_app:test@${host.replace(".", "-pooler.")}/${database}`;
    expect(assertDisposableCertificationTarget(admin, env, "restore", sha).branchName).toBe(branchName);
    expect(() => assertDisposableCertificationTarget(admin, { ...env, TENANT_CERTIFICATION_PURPOSE: "source" }, "restore", sha)).toThrow("TENANT_CERTIFICATION_RESTORE_OPT_IN_REQUIRED");
    expect(() => assertDisposableCertificationTarget(admin, { ...env, TENANT_ISOLATION_BRANCH_NAME: `restore-cert-stage3-${sha.slice(0, 8)}` }, "restore", sha)).toThrow("TENANT_CERTIFICATION_BRANCH_NAME_INVALID");
    expect(() => assertRestorePurposeGuard({ CERTIFICATION_CANDIDATE_SHA: sha }, sha)).toThrow("ALLOW_TEMPORARY_NEON_RESTORE_REQUIRED");
    expect(() => assertRestorePurposeGuard({ ALLOW_TEMPORARY_NEON_RESTORE: "true" }, sha)).toThrow("CERTIFICATION_CANDIDATE_SHA_REQUIRED");
    expect(() => assertRestorePurposeGuard({ ALLOW_TEMPORARY_NEON_RESTORE: "true", CERTIFICATION_CANDIDATE_SHA: sha }, "b".repeat(40))).toThrow("RESTORE_CANDIDATE_SHA_MISMATCH");
    expect(() => assertRemoteTenantBackupTarget(admin, runtime, { ...env, ALLOW_OPERATOR_BACKUP: "1" })).toThrow("TENANT_CERTIFICATION_BRANCH_NAME_INVALID");
  });

  it("fails closed for an unknown certification purpose", () => {
    expect(() => certificationPurpose({ ...baseEnv, NODE_ENV: "test", TENANT_CERTIFICATION_PURPOSE: "other" } as NodeJS.ProcessEnv)).toThrow("TENANT_CERTIFICATION_PURPOSE_INVALID");
  });

  it("rejects Vercel Preview even with all disposable guards enabled", () => {
    const runId = "candidate-run";
    const database = "neondb";
    const branchId = "br-test-candidate";
    const branchName = "cert-stage3-aabbccdd";
    const host = "ep-certification.c-7.us-east-1.aws.neon.tech";
    const env = {
      ...baseEnv,
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "preview",
      TENANT_CERTIFICATION_REMOTE_BRANCH: "1",
      TENANT_ISOLATION_REMOTE_BRANCH: "1",
      TENANT_ISOLATION_RUN_ID: runId,
      TENANT_ISOLATION_DB_NAME: database,
      TENANT_ISOLATION_FINGERPRINT: certificationFingerprint({ mode: "neon", runId, database, host, branchId, branchName }),
      TENANT_ISOLATION_BRANCH_ID: branchId,
      TENANT_ISOLATION_BRANCH_NAME: branchName,
      TENANT_ISOLATION_NEON_HOST: host,
    };
    expect(() => assertDisposableCertificationTarget(`postgresql://owner:test@${host}/${database}`, env))
      .toThrow("TENANT_CERTIFICATION_REFUSES_VERCEL_ENVIRONMENT");
  });

  it("rejects every other Vercel Preview branch for remote tenant certification", () => {
    const env = {
      ...baseEnv,
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "preview",
      TENANT_CERTIFICATION_REMOTE_BRANCH: "1",
      TENANT_ISOLATION_REMOTE_BRANCH: "1",
      TENANT_ISOLATION_BRANCH_ID: "br-unapproved-temporary",
      TENANT_ISOLATION_BRANCH_NAME: "cert-stage3-aabbccdd",
    };
    expect(() => assertDisposableCertificationTarget("postgresql://owner:test@ep-other.c-7.us-east-1.aws.neon.tech/neondb", env))
      .toThrow("TENANT_CERTIFICATION_REFUSES_VERCEL_ENVIRONMENT");
  });

  it("rejects a remote target without its exact fingerprint or branch name", () => {
    const env = {
      ...baseEnv,
      TENANT_ISOLATION_REMOTE_BRANCH: "1",
      TENANT_ISOLATION_RUN_ID: "9d1a963",
      TENANT_ISOLATION_DB_NAME: "neondb",
      TENANT_ISOLATION_FINGERPRINT: "wrong",
      TENANT_ISOLATION_BRANCH_ID: "br-production",
      TENANT_ISOLATION_BRANCH_NAME: "main",
      TENANT_ISOLATION_NEON_HOST: "ep-production.c-7.us-east-1.aws.neon.tech",
    };
    expect(() => assertDisposableCertificationTarget("postgresql://owner:test@ep-production.c-7.us-east-1.aws.neon.tech/neondb", env)).toThrow("TENANT_CERTIFICATION_BRANCH_NAME_INVALID");
  });

  it("allows backup only when direct admin and pooled runtime URLs fingerprint to the same disposable branch", () => {
    const runId = "9d1a963";
    const database = "neondb";
    const branchId = "br-soft-recipe-apz29q8a";
    const branchName = "cert-stage3-9d1a963";
    const host = "ep-certification.c-7.us-east-1.aws.neon.tech";
    const fingerprint = certificationFingerprint({ mode: "neon", runId, database, host, branchId, branchName });
    const env = {
      ...baseEnv,
      ALLOW_OPERATOR_BACKUP: "1",
      TENANT_CERTIFICATION_REMOTE_BRANCH: "1",
      TENANT_ISOLATION_REMOTE_BRANCH: "1",
      TENANT_ISOLATION_RUN_ID: runId,
      TENANT_ISOLATION_DB_NAME: database,
      TENANT_ISOLATION_FINGERPRINT: fingerprint,
      TENANT_ISOLATION_BRANCH_ID: branchId,
      TENANT_ISOLATION_BRANCH_NAME: branchName,
      TENANT_ISOLATION_NEON_HOST: host,
    };
    const adminUrl = `postgresql://owner:test@${host}/${database}`;
    const runtimeUrl = `postgresql://policydesk_app:test@ep-certification-pooler.c-7.us-east-1.aws.neon.tech/${database}`;
    expect(assertRemoteTenantBackupTarget(adminUrl, runtimeUrl, env)).toMatchObject({ mode: "neon", branchId, fingerprint });
    expect(() => assertRemoteTenantBackupTarget(adminUrl, runtimeUrl.replace("-pooler", ""), env)).toThrow("BACKUP_REQUIRES_POOLED_RUNTIME_URL");
    expect(() => assertRemoteTenantBackupTarget(adminUrl, runtimeUrl.replace("policydesk_app", "owner"), env)).toThrow("BACKUP_REQUIRES_RESTRICTED_RUNTIME_ROLE");
    expect(() => assertRemoteTenantBackupTarget(adminUrl, runtimeUrl, { ...env, CERTIFICATION_CANDIDATE_SHA: "ff".repeat(20) })).toThrow("TENANT_CERTIFICATION_CANDIDATE_SHA_MISMATCH");
  });

  it("rejects production and incorrectly pooled administrative backup connections", () => {
    const runId = "9d1a963";
    const database = "neondb";
    const branchId = "br-soft-recipe-apz29q8a";
    const branchName = "cert-stage3-9d1a963";
    const host = "ep-certification.c-7.us-east-1.aws.neon.tech";
    const env = {
      ...baseEnv,
      ALLOW_OPERATOR_BACKUP: "1",
      TENANT_CERTIFICATION_REMOTE_BRANCH: "1",
      TENANT_ISOLATION_REMOTE_BRANCH: "1",
      TENANT_ISOLATION_RUN_ID: runId,
      TENANT_ISOLATION_DB_NAME: database,
      TENANT_ISOLATION_FINGERPRINT: certificationFingerprint({ mode: "neon", runId, database, host, branchId, branchName }),
      TENANT_ISOLATION_BRANCH_ID: branchId,
      TENANT_ISOLATION_BRANCH_NAME: branchName,
      TENANT_ISOLATION_NEON_HOST: host,
    };
    const runtimeUrl = `postgresql://app:test@ep-certification-pooler.c-7.us-east-1.aws.neon.tech/${database}`;
    expect(() => assertRemoteTenantBackupTarget(`postgresql://owner:test@ep-production.c-7.us-east-1.aws.neon.tech/${database}`, runtimeUrl, env))
      .toThrow("TENANT_CERTIFICATION_NEON_HOST_MISMATCH");
    expect(() => assertRemoteTenantBackupTarget(`postgresql://owner:test@ep-certification-pooler.c-7.us-east-1.aws.neon.tech/${database}`, runtimeUrl, env))
      .toThrow("BACKUP_REQUIRES_DIRECT_DATABASE_URL");
  });
});
