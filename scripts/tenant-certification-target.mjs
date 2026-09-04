import { createHash } from "node:crypto";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** @param {Record<string, string | undefined>} env @param {string} name */
function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

/** @param {string} hostname */
export function canonicalNeonHost(hostname) {
  return hostname.toLowerCase().replace(/-pooler(?=\.)/, "");
}

/**
 * @param {{ mode: "local" | "neon"; runId: string; database: string; host: string; branchId?: string; branchName?: string }} input
 */
export function certificationFingerprint({ mode, runId, database, host, branchId, branchName }) {
  const source = mode === "local"
    ? `local-postgres:${runId}:${database}:${host}`
    : `neon-branch:${runId}:${branchId}:${branchName}:${database}:${canonicalNeonHost(host)}`;
  return createHash("sha256").update(source).digest("hex");
}

/** @param {string} connectionString @param {Record<string, string | undefined>} env */
export function assertDisposableCertificationTarget(connectionString, env = process.env) {
  if (env.NODE_ENV !== "test" || env.TENANT_ISOLATION_TEST_DB !== "1" || env.PLAYWRIGHT_ENFORCE_DISPOSABLE_DB !== "1") {
    throw new Error("TENANT_CERTIFICATION_REQUIRES_DISPOSABLE_TEST_GUARDS");
  }
  if (env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview") {
    throw new Error("TENANT_CERTIFICATION_REFUSES_VERCEL_ENVIRONMENT");
  }

  const target = new URL(connectionString);
  if (target.protocol !== "postgres:" && target.protocol !== "postgresql:") {
    throw new Error("TENANT_CERTIFICATION_REQUIRES_POSTGRES");
  }
  const runId = required(env, "TENANT_ISOLATION_RUN_ID");
  const expectedDatabase = required(env, "TENANT_ISOLATION_DB_NAME");
  const configuredFingerprint = required(env, "TENANT_ISOLATION_FINGERPRINT");
  const currentDatabase = decodeURIComponent(target.pathname.replace(/^\//, "").split("?")[0]);
  const host = target.hostname.toLowerCase();
  if (currentDatabase !== expectedDatabase || ["postgres", "template0", "template1"].includes(currentDatabase.toLowerCase())) {
    throw new Error("TENANT_CERTIFICATION_DATABASE_MISMATCH");
  }

  if (LOCAL_HOSTS.has(host)) {
    if (!/^policydesk_tenant_test_[A-Za-z0-9_]+$/.test(expectedDatabase)) {
      throw new Error("TENANT_CERTIFICATION_REQUIRES_DEDICATED_LOCAL_DATABASE");
    }
    const expectedFingerprint = certificationFingerprint({ mode: "local", runId, database: expectedDatabase, host });
    if (configuredFingerprint !== expectedFingerprint) throw new Error("TENANT_CERTIFICATION_FINGERPRINT_MISMATCH");
    return { mode: "local", runId, database: expectedDatabase, host, fingerprint: expectedFingerprint };
  }

  if (env.TENANT_ISOLATION_REMOTE_BRANCH !== "1") {
    throw new Error("TENANT_CERTIFICATION_REMOTE_BRANCH_NOT_AUTHORIZED");
  }
  const branchId = required(env, "TENANT_ISOLATION_BRANCH_ID");
  const branchName = required(env, "TENANT_ISOLATION_BRANCH_NAME");
  const configuredHost = canonicalNeonHost(required(env, "TENANT_ISOLATION_NEON_HOST"));
  const canonicalHost = canonicalNeonHost(host);
  if (!/^br-[a-z0-9-]+$/.test(branchId)) throw new Error("TENANT_CERTIFICATION_BRANCH_ID_INVALID");
  if (!/^cert-stage3-[0-9a-f]{7,40}$/.test(branchName)) throw new Error("TENANT_CERTIFICATION_BRANCH_NAME_INVALID");
  if (!canonicalHost.endsWith(".neon.tech") || canonicalHost !== configuredHost) {
    throw new Error("TENANT_CERTIFICATION_NEON_HOST_MISMATCH");
  }
  const expectedFingerprint = certificationFingerprint({
    mode: "neon",
    runId,
    database: expectedDatabase,
    host: canonicalHost,
    branchId,
    branchName,
  });
  if (configuredFingerprint !== expectedFingerprint) throw new Error("TENANT_CERTIFICATION_FINGERPRINT_MISMATCH");
  return { mode: "neon", runId, database: expectedDatabase, host: canonicalHost, branchId, branchName, fingerprint: expectedFingerprint };
}
