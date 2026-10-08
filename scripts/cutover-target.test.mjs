import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertMaintenanceOrCutoverTarget, assertProductionCutoverTarget } from "./cutover-target.mjs";
import { certificationFingerprint } from "./tenant-certification-target.mjs";

const productionIdentity = {
  NEON_PROJECT_ID: "bitter-frost-67704350",
  TENANT_ISOLATION_BRANCH_ID: "br-fancy-wildflower-apfbks1o",
};
const productionUrl = "postgresql://operator:secret@ep-withered-hall-ap9wt7s5.c-7.us-east-1.aws.neon.tech/neondb";

describe("maintenance and multi-org cutover target guard", () => {
  it("accepts only the pinned Production project, branch, database and direct host", () => {
    assert.deepEqual(assertProductionCutoverTarget(productionUrl, productionIdentity), {
      projectId: "bitter-frost-67704350",
      branchId: "br-fancy-wildflower-apfbks1o",
      database: "neondb",
      host: "ep-withered-hall-ap9wt7s5.c-7.us-east-1.aws.neon.tech",
    });
  });

  it("rejects a database or endpoint host that differs from the pinned target", () => {
    assert.throws(
      () => assertProductionCutoverTarget(productionUrl.replace("/neondb", "/other"), productionIdentity),
      /POLICYDESK_CUTOVER_PRODUCTION_DATABASE_MISMATCH/,
    );
    assert.throws(
      () => assertProductionCutoverTarget(productionUrl.replace("ep-withered-hall-ap9wt7s5", "ep-other"), productionIdentity),
      /POLICYDESK_CUTOVER_PRODUCTION_HOST_MISMATCH/,
    );
  });

  it("rejects pooler URLs even when their database and branch labels match", () => {
    const poolerUrl = productionUrl.replace(".neon.tech", "-pooler.neon.tech");
    assert.throws(
      () => assertProductionCutoverTarget(poolerUrl, productionIdentity),
      /POLICYDESK_CUTOVER_PRODUCTION_DIRECT_DATABASE_REQUIRED/,
    );
    assert.throws(
      () => assertProductionCutoverTarget(`${productionUrl}?pgbouncer=true`, productionIdentity),
      /POLICYDESK_CUTOVER_PRODUCTION_DIRECT_DATABASE_REQUIRED/,
    );
  });

  it("does not trust a branch ID supplied by the environment unless it is allowlisted", () => {
    assert.throws(() => assertProductionCutoverTarget(productionUrl, {
      ...productionIdentity,
      TENANT_ISOLATION_BRANCH_ID: "br-some-other-production-branch",
    }), /POLICYDESK_CUTOVER_PRODUCTION_BRANCH_NOT_ALLOWLISTED/);
    assert.throws(() => assertProductionCutoverTarget(productionUrl, {
      ...productionIdentity,
      NEON_PROJECT_ID: "some-other-project",
    }), /POLICYDESK_CUTOVER_PRODUCTION_BRANCH_NOT_ALLOWLISTED/);
  });

  it("preserves the strict disposable certification path for CI test databases", () => {
    const database = "policydesk_tenant_test_cutover_guard";
    const runId = "run-42";
    const host = "127.0.0.1";
    const env = {
      NODE_ENV: "test",
      TENANT_ISOLATION_TEST_DB: "1",
      PLAYWRIGHT_ENFORCE_DISPOSABLE_DB: "1",
      TENANT_ISOLATION_DB_NAME: database,
      TENANT_ISOLATION_RUN_ID: runId,
      TENANT_ISOLATION_FINGERPRINT: certificationFingerprint({ mode: "local", runId, database, host }),
    };
    const result = assertMaintenanceOrCutoverTarget(`postgresql://postgres:postgres@${host}:5432/${database}`, env);
    assert.deepEqual({ mode: result.mode, database: result.database, host: result.host }, { mode: "local", database, host });
    assert.throws(() => assertMaintenanceOrCutoverTarget(`postgresql://postgres:postgres@${host}:5432/${database}`, {
      ...env,
      PLAYWRIGHT_ENFORCE_DISPOSABLE_DB: "0",
    }), /TENANT_CERTIFICATION_REQUIRES_DISPOSABLE_TEST_GUARDS/);
  });

  it("never routes a Production host through disposable certification flags", () => {
    const database = "policydesk_tenant_test_cutover_guard";
    const runId = "run-42";
    const env = {
      NODE_ENV: "test",
      TENANT_ISOLATION_TEST_DB: "1",
      PLAYWRIGHT_ENFORCE_DISPOSABLE_DB: "1",
      TENANT_ISOLATION_DB_NAME: database,
      TENANT_ISOLATION_RUN_ID: runId,
      TENANT_ISOLATION_FINGERPRINT: certificationFingerprint({
        mode: "local",
        runId,
        database,
        host: "127.0.0.1",
      }),
    };

    assert.throws(
      () => assertMaintenanceOrCutoverTarget(productionUrl, env),
      /POLICYDESK_CUTOVER_DISPOSABLE_TARGET_MUST_BE_LOCAL/,
    );
  });
});
