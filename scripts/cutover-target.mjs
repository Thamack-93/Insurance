import { assertDisposableCertificationTarget, certificationPurpose } from "./tenant-certification-target.mjs";

/**
 * Production identity pinned for the one approved PolicyDesk Neon project.
 * Branch IDs supplied by the operator environment are checked against this
 * allowlist and the branch's direct endpoint host; they are never trusted as
 * the source of target identity.
 */
export const PRODUCTION_CUTOVER_TARGETS = Object.freeze({
  "bitter-frost-67704350": Object.freeze({
    branchId: "br-fancy-wildflower-apfbks1o",
    database: "neondb",
    host: "ep-withered-hall-ap9wt7s5.c-7.us-east-1.aws.neon.tech",
  }),
});

/** @param {string} connectionString @param {Record<string, string | undefined>} [env] */
export function assertProductionCutoverTarget(connectionString, env = process.env) {
  const projectId = env.NEON_PROJECT_ID?.trim();
  const branchId = env.TENANT_ISOLATION_BRANCH_ID?.trim();
  if (!projectId || !branchId) throw new Error("POLICYDESK_CUTOVER_PRODUCTION_IDENTITY_REQUIRED");

  const expected = PRODUCTION_CUTOVER_TARGETS[projectId];
  if (!expected || branchId !== expected.branchId) {
    throw new Error("POLICYDESK_CUTOVER_PRODUCTION_BRANCH_NOT_ALLOWLISTED");
  }

  let target;
  try {
    target = new URL(connectionString);
  } catch {
    throw new Error("POLICYDESK_CUTOVER_DATABASE_URL_INVALID");
  }
  if (target.protocol !== "postgres:" && target.protocol !== "postgresql:") {
    throw new Error("POLICYDESK_CUTOVER_REQUIRES_POSTGRES");
  }
  const database = decodeURIComponent(target.pathname.replace(/^\//, "").split("?")[0]);
  if (database !== expected.database) throw new Error("POLICYDESK_CUTOVER_PRODUCTION_DATABASE_MISMATCH");
  if (/-pooler(?:\.|$)/i.test(target.hostname) || target.searchParams.has("pgbouncer")) {
    throw new Error("POLICYDESK_CUTOVER_PRODUCTION_DIRECT_DATABASE_REQUIRED");
  }
  if (target.hostname.toLowerCase() !== expected.host) {
    throw new Error("POLICYDESK_CUTOVER_PRODUCTION_HOST_MISMATCH");
  }

  return { projectId, branchId, database, host: target.hostname.toLowerCase() };
}

/** Route CI disposable databases through their existing strict certification guard. */
/** @param {string} connectionString @param {Record<string, string | undefined>} [env] */
export function assertMaintenanceOrCutoverTarget(connectionString, env = process.env) {
  if (env.TENANT_ISOLATION_TEST_DB === "1") {
    let target;
    try {
      target = new URL(connectionString);
    } catch {
      throw new Error("POLICYDESK_CUTOVER_DISPOSABLE_DATABASE_URL_INVALID");
    }
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    if (!localHosts.has(target.hostname.toLowerCase())) {
      throw new Error("POLICYDESK_CUTOVER_DISPOSABLE_TARGET_MUST_BE_LOCAL");
    }
    return assertDisposableCertificationTarget(connectionString, env, certificationPurpose(env));
  }
  return assertProductionCutoverTarget(connectionString, env);
}
