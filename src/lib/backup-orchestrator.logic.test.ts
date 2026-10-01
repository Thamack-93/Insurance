import { beforeEach, describe, expect, it, vi } from "vitest";

const createDatabaseBackup = vi.hoisted(() => vi.fn());
const createOrganizationDatabaseBackup = vi.hoisted(() => vi.fn());
const deleteStoredBackup = vi.hoisted(() => vi.fn());
const verifyStoredBackup = vi.hoisted(() => vi.fn());
const reserveBackupArtifact = vi.hoisted(() => vi.fn());
const updateBackupArtifactStatus = vi.hoisted(() => vi.fn());
const upsertBackupArtifact = vi.hoisted(() => vi.fn());
const getPlatformBackupArtifacts = vi.hoisted(() => vi.fn());
const getOrganizationBackupArtifacts = vi.hoisted(() => vi.fn());
const listBackups = vi.hoisted(() => vi.fn());
const listRekeyedBackups = vi.hoisted(() => vi.fn());
const listEmergencyBackups = vi.hoisted(() => vi.fn());
const listOrganizationBackups = vi.hoisted(() => vi.fn());
const getAllBackupArtifacts = vi.hoisted(() => vi.fn());
const getBackupArtifactByPathname = vi.hoisted(() => vi.fn());
const markBackupArtifactsPruned = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/backup", () => ({
  buildManualPlatformBackupTarget: vi.fn(),
  buildManualOrganizationBackupTarget: vi.fn(),
  createDatabaseBackup,
  createOrganizationDatabaseBackup,
  deleteStoredBackup,
  verifyStoredBackup,
  listBackups,
  listRekeyedBackups,
  listEmergencyBackups,
  listOrganizationBackups,
  GLOBAL_BACKUP_RETENTION_DAYS: 30,
}));
vi.mock("@/lib/backup-catalog", () => ({
  reserveBackupArtifact,
  updateBackupArtifactStatus,
  upsertBackupArtifact,
  getPlatformBackupArtifacts,
  getOrganizationBackupArtifacts,
  markBackupArtifactsPruned,
  getAllBackupArtifacts,
  getBackupArtifactByPathname,
}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

import { createAndCatalogBackup, reconcileBackupCatalog } from "./backup-orchestrator";

const target = { filename: "policydesk-20260825T000000000Z-aaaaaaaaaaaa-kv-v2.ndjson.gz.enc", pathname: "database-backups/policydesk-20260825T000000000Z-aaaaaaaaaaaa-kv-v2.ndjson.gz.enc" };
const manifest = {
  scope: "PLATFORM",
  createdAt: "2026-08-25T05:00:00.000Z",
  capability: "DATABASE_ONLY",
  totals: { tables: 2, rows: 3 },
};

describe("createAndCatalogBackup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    reserveBackupArtifact.mockResolvedValue({ id: "artifact-1", status: "CREATING" });
    deleteStoredBackup.mockResolvedValue(undefined);
    updateBackupArtifactStatus.mockResolvedValue(undefined);
    upsertBackupArtifact.mockResolvedValue(undefined);
    markBackupArtifactsPruned.mockResolvedValue(0);
    getPlatformBackupArtifacts.mockResolvedValue([]);
    getOrganizationBackupArtifacts.mockResolvedValue([]);
    listBackups.mockResolvedValue([]);
    listRekeyedBackups.mockResolvedValue([]);
    listEmergencyBackups.mockResolvedValue([]);
    listOrganizationBackups.mockResolvedValue([]);
    getAllBackupArtifacts.mockResolvedValue([]);
    getBackupArtifactByPathname.mockResolvedValue(null);
    createDatabaseBackup.mockResolvedValue({ ...target, size: 10, createdAt: new Date("2026-08-25T05:00:00.000Z"), manifestAvailable: true, manifest, pruned: [] });
  });

  it("creates one physical object and reuses it on a retry of the same target", async () => {
    verifyStoredBackup
      .mockResolvedValueOnce({ valid: false, filename: target.filename, reason: "missing" })
      .mockResolvedValueOnce({ valid: true, filename: target.filename, size: 10, sha256: "a".repeat(64), manifest })
      .mockResolvedValueOnce({ valid: true, filename: target.filename, size: 10, sha256: "a".repeat(64), manifest });

    await createAndCatalogBackup({ scope: "PLATFORM", target, now: new Date("2026-08-25T05:00:00.000Z") });
    await createAndCatalogBackup({ scope: "PLATFORM", target, now: new Date("2026-08-25T05:05:00.000Z") });

    expect(createDatabaseBackup).toHaveBeenCalledTimes(1);
    expect(reserveBackupArtifact).toHaveBeenCalledTimes(2);
    expect(upsertBackupArtifact).toHaveBeenCalledWith(expect.objectContaining({ status: "VERIFIED" }));
  });

  it("marks the reservation BLOCKED and removes partial blobs when verification fails", async () => {
    verifyStoredBackup.mockResolvedValue({ valid: false, filename: target.filename, reason: "hash mismatch" });

    await expect(createAndCatalogBackup({ scope: "PLATFORM", target })).rejects.toThrow("hash mismatch");

    expect(updateBackupArtifactStatus).toHaveBeenCalledWith("artifact-1", "BLOCKED");
    expect(deleteStoredBackup).toHaveBeenCalledWith(target.pathname);
  });

  it("retries transient post-upload availability without deleting the partial backup", async () => {
    verifyStoredBackup
      .mockResolvedValueOnce({ valid: false, filename: target.filename, reason: "missing manifest", code: "MANIFEST_NOT_FOUND" })
      .mockResolvedValueOnce({ valid: false, filename: target.filename, reason: "missing payload", code: "PAYLOAD_NOT_FOUND" })
      .mockResolvedValueOnce({ valid: true, filename: target.filename, size: 10, sha256: "a".repeat(64), manifest });

    await createAndCatalogBackup({ scope: "PLATFORM", target, now: new Date("2026-08-25T05:00:00.000Z") });

    expect(verifyStoredBackup).toHaveBeenCalledTimes(3);
    expect(deleteStoredBackup).toHaveBeenCalledTimes(1);
    expect(updateBackupArtifactStatus).not.toHaveBeenCalledWith("artifact-1", "BLOCKED");
  });

  it("deletes expired verified payloads and marks their catalog rows PRUNED", async () => {
    verifyStoredBackup
      .mockResolvedValueOnce({ valid: false, filename: target.filename, reason: "missing" })
      .mockResolvedValueOnce({ valid: true, filename: target.filename, size: 10, sha256: "a".repeat(64), manifest });
    getPlatformBackupArtifacts.mockResolvedValue([
      { id: "old", pathname: "database-backups/old", storage: "original", status: "VERIFIED", createdAt: "2026-07-01T05:00:00.000Z" },
    ]);

    const result = await createAndCatalogBackup({ scope: "PLATFORM", target, now: new Date("2026-08-25T05:00:00.000Z") });

    expect(deleteStoredBackup).toHaveBeenCalledWith("database-backups/old");
    expect(markBackupArtifactsPruned).toHaveBeenCalledWith(["database-backups/old"]);
    expect(result.pruned).toEqual(["database-backups/old"]);
  });

  it("rejects retention bypass outside a disposable remote certification branch", async () => {
    await expect(createAndCatalogBackup({ scope: "ORGANIZATION", organizationId: "org-demo", target, skipPrune: true }))
      .rejects.toThrow("BACKUP_PRUNE_SKIP_REQUIRES_DISPOSABLE_REMOTE_NEON_BRANCH");
    expect(reserveBackupArtifact).not.toHaveBeenCalled();
  });

  it("preserves shared Blob backups during an explicitly guarded remote tenant drill", async () => {
    const host = "ep-certification.c-7.us-east-1.aws.neon.tech";
    const runId = "9d1a963";
    const branchId = "br-soft-recipe-apz29q8a";
    const branchName = "cert-stage3-9d1a963";
    vi.stubEnv("ALLOW_OPERATOR_BACKUP", "1");
    vi.stubEnv("TENANT_CERTIFICATION_REMOTE_BRANCH", "1");
    vi.stubEnv("TENANT_CERTIFICATION_REMOTE_BRANCH", "1");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("TENANT_ISOLATION_TEST_DB", "1");
    vi.stubEnv("PLAYWRIGHT_ENFORCE_DISPOSABLE_DB", "1");
    vi.stubEnv("TENANT_ISOLATION_REMOTE_BRANCH", "1");
    vi.stubEnv("TENANT_ISOLATION_BRANCH_NAME", branchName);
    vi.stubEnv("TENANT_ISOLATION_BRANCH_ID", branchId);
    vi.stubEnv("TENANT_ISOLATION_RUN_ID", runId);
    vi.stubEnv("TENANT_ISOLATION_DB_NAME", "neondb");
    vi.stubEnv("TENANT_ISOLATION_NEON_HOST", host);
    const { certificationFingerprint } = await import("../../scripts/tenant-certification-target.mjs");
    vi.stubEnv("TENANT_ISOLATION_FINGERPRINT", certificationFingerprint({ mode: "neon", runId, database: "neondb", host, branchId, branchName }));
    vi.stubEnv("DATABASE_ADMIN_URL", `postgresql://owner:fake@${host}/neondb`);
    vi.stubEnv("DATABASE_URL", `postgresql://policydesk_app:fake@ep-certification-pooler.c-7.us-east-1.aws.neon.tech/neondb`);
    const tenantTarget = { filename: "tenant", pathname: "organization-backups/org-demo/tenant" };
    const tenantManifest = { ...manifest, scope: "ORGANIZATION", organization: { id: "org-demo" } };
    verifyStoredBackup
      .mockResolvedValueOnce({ valid: false, filename: tenantTarget.filename, reason: "missing" })
      .mockResolvedValueOnce({ valid: true, filename: tenantTarget.filename, size: 10, sha256: "a".repeat(64), manifest: tenantManifest });
    createOrganizationDatabaseBackup.mockResolvedValue({
      ...tenantTarget,
      size: 10,
      createdAt: new Date("2026-08-25T05:00:00.000Z"),
      manifestAvailable: true,
      scope: "ORGANIZATION",
      organizationId: "org-demo",
      manifest: tenantManifest,
      pruned: [],
    });

    const result = await createAndCatalogBackup({ scope: "ORGANIZATION", organizationId: "org-demo", target: tenantTarget, skipPrune: true });

    expect(result.pruned).toEqual([]);
    expect(getOrganizationBackupArtifacts).not.toHaveBeenCalled();
    expect(deleteStoredBackup).toHaveBeenCalledTimes(1);
    expect(deleteStoredBackup).toHaveBeenCalledWith(tenantTarget.pathname);
    expect(deleteStoredBackup).not.toHaveBeenCalledWith(expect.stringMatching(/^organization-backups\/org-demo\/(?!tenant)/));
  });

  it("rejects Preview instead of bypassing retention guards", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TENANT_CERTIFICATION_REMOTE_BRANCH", "1");
    vi.stubEnv("ALLOW_OPERATOR_BACKUP", "1");
    vi.stubEnv("TENANT_ISOLATION_REMOTE_BRANCH", "1");
    vi.stubEnv("TENANT_ISOLATION_BRANCH_ID", "br-test-candidate");
    vi.stubEnv("TENANT_ISOLATION_BRANCH_NAME", "cert-stage3-aabbccdd");
    vi.stubEnv("TENANT_ISOLATION_RUN_ID", "candidate-run");
    vi.stubEnv("TENANT_ISOLATION_DB_NAME", "neondb");
    vi.stubEnv("TENANT_ISOLATION_NEON_HOST", "ep-certification.c-7.us-east-1.aws.neon.tech");
    vi.stubEnv("TENANT_ISOLATION_FINGERPRINT", "synthetic-fingerprint");
    vi.stubEnv("DATABASE_ADMIN_URL", `postgresql://owner:fake@ep-certification.c-7.us-east-1.aws.neon.tech/neondb`);
    vi.stubEnv("DATABASE_URL", `postgresql://policydesk_app:fake@ep-certification-pooler.c-7.us-east-1.aws.neon.tech/neondb`);
    const tenantTarget = { filename: "tenant", pathname: "organization-backups/org_pedro_gomez_0001/tenant" };
    const tenantManifest = { ...manifest, scope: "ORGANIZATION", organization: { id: "org_pedro_gomez_0001" } };
    verifyStoredBackup
      .mockResolvedValueOnce({ valid: false, filename: tenantTarget.filename, reason: "missing" })
      .mockResolvedValueOnce({ valid: true, filename: tenantTarget.filename, size: 10, sha256: "a".repeat(64), manifest: tenantManifest });
    createOrganizationDatabaseBackup.mockResolvedValue({
      ...tenantTarget,
      size: 10,
      createdAt: new Date("2026-08-25T05:00:00.000Z"),
      manifestAvailable: true,
      scope: "ORGANIZATION",
      organizationId: "org_pedro_gomez_0001",
      manifest: tenantManifest,
      pruned: [],
    });

    await expect(createAndCatalogBackup({ scope: "ORGANIZATION", organizationId: "org_pedro_gomez_0001", target: tenantTarget, skipPrune: true }))
      .rejects.toThrow("BACKUP_PRUNE_SKIP_REQUIRES_DISPOSABLE_REMOTE_NEON_BRANCH");
    expect(reserveBackupArtifact).not.toHaveBeenCalled();
  });

  it("rejects a tenant manifest attributed to another organization", async () => {
    const tenantTarget = { filename: "tenant", pathname: "organization-backups/org-1/tenant" };
    const wrongManifest = { ...manifest, scope: "ORGANIZATION", organization: { id: "org-2" } };
    verifyStoredBackup.mockResolvedValue({ valid: true, filename: "tenant", size: 10, sha256: "a".repeat(64), manifest: wrongManifest });

    await expect(createAndCatalogBackup({ scope: "ORGANIZATION", organizationId: "org-1", target: tenantTarget })).rejects.toThrow("otra organización");
    expect(updateBackupArtifactStatus).toHaveBeenCalledWith("artifact-1", "BLOCKED");
  });

  it("downgrades missing blocked reservations to INVALID while preserving the catalog row", async () => {
    const db = await import("@/lib/db");
    vi.mocked(db.getDb).mockReturnValue({
      organization: { findMany: vi.fn().mockResolvedValue([]) },
    } as never);
    getAllBackupArtifacts.mockResolvedValue([
      { id: "stale", pathname: "database-backups/missing", status: "BLOCKED" },
    ]);

    const result = await reconcileBackupCatalog();

    expect(updateBackupArtifactStatus).toHaveBeenCalledWith("stale", "INVALID");
    expect(result).toMatchObject({ verified: 0, invalid: 1, blocked: 0 });
  });
});
