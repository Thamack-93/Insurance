import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

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

/** @param {Array<{run_id:string,database_name:string,host:string,fingerprint:string}>} rows @param {{runId:string,database:string,host:string,fingerprint:string}} target */
export function assertPersistedRestoreMarker(rows, target) {
  const row = rows[0];
  if (rows.length !== 1 || row.run_id !== target.runId || row.database_name !== target.database || row.host !== target.host || row.fingerprint !== target.fingerprint) {
    throw new Error("RESTORE_CERTIFICATION_MARKER_MISMATCH");
  }
}

/** Bind destructive restore-purpose commands to the exact checked-out candidate.
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [actualHead]
 */
export function assertRestorePurposeGuard(env = process.env, actualHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()) {
  if (env.ALLOW_TEMPORARY_NEON_RESTORE !== "true") throw new Error("ALLOW_TEMPORARY_NEON_RESTORE_REQUIRED");
  if (env.VERCEL === "1" || env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview") throw new Error("TENANT_CERTIFICATION_REFUSES_VERCEL_ENVIRONMENT");
  const sha = env.CERTIFICATION_CANDIDATE_SHA?.trim() ?? "";
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("CERTIFICATION_CANDIDATE_SHA_REQUIRED");
  if (actualHead !== sha) throw new Error("RESTORE_CANDIDATE_SHA_MISMATCH");
  return sha;
}

/** Explicitly opt in to the independently named Stage 3 restore branch.
 * @param {Record<string, string | undefined>} [env]
 */
export function certificationPurpose(env = process.env) {
  const purpose = env.TENANT_CERTIFICATION_PURPOSE?.trim() || "source";
  if (purpose !== "source" && purpose !== "restore") throw new Error("TENANT_CERTIFICATION_PURPOSE_INVALID");
  if (purpose === "restore") assertRestorePurposeGuard(env);
  return purpose;
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

/** @param {string} connectionString @param {Record<string, string | undefined>} [env] @param {"source" | "restore"} [purpose] @param {string} [actualHead] */
export function assertDisposableCertificationTarget(connectionString, env = process.env, purpose = "source", actualHead) {
  if (purpose !== "source" && purpose !== "restore") throw new Error("TENANT_CERTIFICATION_PURPOSE_INVALID");
  if (purpose === "restore") assertRestorePurposeGuard(env, actualHead ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
  if (env.VERCEL === "1" || env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview") {
    throw new Error("TENANT_CERTIFICATION_REFUSES_VERCEL_ENVIRONMENT");
  }
  if (env.NODE_ENV !== "test" || env.TENANT_ISOLATION_TEST_DB !== "1" || env.PLAYWRIGHT_ENFORCE_DISPOSABLE_DB !== "1") {
    throw new Error("TENANT_CERTIFICATION_REQUIRES_DISPOSABLE_TEST_GUARDS");
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
  const prefix = purpose === "restore" ? "restore-cert-stage3-" : "cert-stage3-";
  const suffix = purpose === "restore" ? "[0-9a-f]{40}" : "[0-9a-f]{7,40}";
  if (!new RegExp(`^${prefix}${suffix}$`).test(branchName)) throw new Error("TENANT_CERTIFICATION_BRANCH_NAME_INVALID");
  if (purpose === "restore" && env.TENANT_CERTIFICATION_PURPOSE !== "restore") throw new Error("TENANT_CERTIFICATION_RESTORE_OPT_IN_REQUIRED");
  if (env.CERTIFICATION_CANDIDATE_SHA && branchName !== `${prefix}${env.CERTIFICATION_CANDIDATE_SHA}`) {
    throw new Error("TENANT_CERTIFICATION_CANDIDATE_SHA_MISMATCH");
  }
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

/** A no-prune tenant backup is allowed only when both URLs resolve to the
 * same explicitly fingerprinted remote Neon certification branch. */
/** @param {string} adminUrl @param {string} runtimeUrl @param {Record<string, string | undefined>} [env] */
export function assertRemoteTenantBackupTarget(adminUrl, runtimeUrl, env = process.env) {
  if (env.ALLOW_OPERATOR_BACKUP !== "1") throw new Error("ALLOW_OPERATOR_BACKUP_REQUIRED");
  if (env.TENANT_CERTIFICATION_REMOTE_BRANCH !== "1") throw new Error("TENANT_CERTIFICATION_REMOTE_BRANCH_NOT_AUTHORIZED");
  const admin = assertDisposableCertificationTarget(adminUrl, env, "source");
  const runtime = assertDisposableCertificationTarget(runtimeUrl, env, "source");
  if (admin.mode !== "neon" || runtime.mode !== "neon") throw new Error("TENANT_BACKUP_REQUIRES_REMOTE_NEON_BRANCH");
  if (admin.fingerprint !== runtime.fingerprint) throw new Error("TENANT_BACKUP_RUNTIME_DATABASE_MISMATCH");
  if (/-pooler/i.test(new URL(adminUrl).hostname) || new URL(adminUrl).searchParams.has("pgbouncer")) {
    throw new Error("BACKUP_REQUIRES_DIRECT_DATABASE_URL");
  }
  if (!/-pooler\./i.test(new URL(runtimeUrl).hostname)) throw new Error("BACKUP_REQUIRES_POOLED_RUNTIME_URL");
  if (new URL(runtimeUrl).username !== "policydesk_app") throw new Error("BACKUP_REQUIRES_RESTRICTED_RUNTIME_ROLE");
  return admin;
}
