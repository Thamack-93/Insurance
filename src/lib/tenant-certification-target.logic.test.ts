import { describe, expect, it } from "vitest";
import {
  assertDisposableCertificationTarget,
  canonicalNeonHost,
  certificationFingerprint,
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
});
