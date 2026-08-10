import { describe, expect, it } from "vitest";
import {
  canonicalNeonEndpointId,
  DEPLOYMENT_DATABASE_ERROR_MESSAGE,
  DeploymentDatabaseSafetyError,
  deriveDeploymentFingerprint,
  evaluateDeploymentDatabaseSafety,
} from "@/lib/deployment-db-safety";

const fingerprint = deriveDeploymentFingerprint({
  projectId: "project-safe",
  branchId: "branch-preview",
  databaseIdOrName: "policydesk",
});

describe("deployment database safety", () => {
  it("derives a deterministic fingerprint without embedding credentials", () => {
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(deriveDeploymentFingerprint({
      projectId: "project-safe",
      branchId: "branch-preview",
      databaseIdOrName: "policydesk",
    })).toBe(fingerprint);
    expect(fingerprint).not.toContain("project-safe");
  });

  it("normalizes pooled and direct Neon endpoint ids", () => {
    expect(canonicalNeonEndpointId("postgresql://user:secret@ep-safe-pooler.us-east-2.aws.neon.tech/policydesk?sslmode=require"))
      .toBe("ep-safe");
    expect(canonicalNeonEndpointId("postgresql://user:secret@ep-safe.us-east-2.aws.neon.tech/policydesk?sslmode=require"))
      .toBe("ep-safe");
  });

  it.each(["production", "preview"] as const)("passes for a matching %s deployment and database", (environment) => {
    expect(evaluateDeploymentDatabaseSafety({
      expectedEnvironment: environment,
      expectedFingerprint: fingerprint,
      vercel: "1",
      vercelEnvironment: environment,
      actualEnvironment: environment.toUpperCase(),
      actualFingerprint: fingerprint,
    })).toMatchObject({ safe: true, code: null });
  });

  it("allows an explicitly configured disposable CI database", () => {
    expect(evaluateDeploymentDatabaseSafety({
      expectedEnvironment: "test",
      expectedFingerprint: fingerprint,
      actualEnvironment: "TEST",
      actualFingerprint: fingerprint,
    })).toMatchObject({ safe: true, code: null });
  });

  it.each([
    ["production", "preview", fingerprint, "POLICYDESK_DEPLOYMENT_DATABASE_MISMATCH"],
    ["preview", "preview", "f".repeat(64), "POLICYDESK_DEPLOYMENT_DATABASE_MISMATCH"],
    ["preview", null, null, "POLICYDESK_DEPLOYMENT_DATABASE_UNINITIALIZED"],
    ["invalid", "preview", fingerprint, "POLICYDESK_DEPLOYMENT_DATABASE_UNINITIALIZED"],
  ])("fails closed for expected=%s actual=%s", (expected, actual, actualFingerprint, code) => {
    expect(evaluateDeploymentDatabaseSafety({
      expectedEnvironment: expected,
      expectedFingerprint: fingerprint,
      actualEnvironment: actual,
      actualFingerprint,
    })).toMatchObject({ safe: false, code });
  });

  it("does not infer deployment identity from NODE_ENV-like defaults", () => {
    expect(evaluateDeploymentDatabaseSafety({
      actualEnvironment: "TEST",
      actualFingerprint: fingerprint,
    })).toMatchObject({
      safe: false,
      code: "POLICYDESK_DEPLOYMENT_DATABASE_UNINITIALIZED",
      expectedEnvironment: null,
    });
  });

  it("uses a sanitized deterministic error without connection details", () => {
    const error = new DeploymentDatabaseSafetyError("POLICYDESK_DEPLOYMENT_DATABASE_MISMATCH");
    const serialized = JSON.stringify({ message: error.message, code: error.code });
    expect(error.message).toBe(DEPLOYMENT_DATABASE_ERROR_MESSAGE);
    expect(serialized).not.toContain("postgresql://");
    expect(serialized).not.toContain("password");
  });

  it("rejects Vercel runtime metadata that disagrees with explicit configuration", () => {
    expect(evaluateDeploymentDatabaseSafety({
      expectedEnvironment: "preview",
      expectedFingerprint: fingerprint,
      vercel: "1",
      vercelEnvironment: "production",
      actualEnvironment: "PREVIEW",
      actualFingerprint: fingerprint,
    })).toMatchObject({
      safe: false,
      code: "POLICYDESK_DEPLOYMENT_DATABASE_MISMATCH",
      runtimeEnvironmentMatches: false,
    });
  });
});
