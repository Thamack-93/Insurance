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
const markBackupArtifactsPruned = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/backup", () => ({
  buildManualPlatformBackupTarget: vi.fn(),
  buildManualOrganizationBackupTarget: vi.fn(),
  createDatabaseBackup,
  createOrganizationDatabaseBackup,
  deleteStoredBackup,
  verifyStoredBackup,
  listBackups: vi.fn(),
  listRekeyedBackups: vi.fn(),
  listEmergencyBackups: vi.fn(),
  listOrganizationBackups: vi.fn(),
  GLOBAL_BACKUP_RETENTION_DAYS: 30,
}));
vi.mock("@/lib/backup-catalog", () => ({
  reserveBackupArtifact,
  updateBackupArtifactStatus,
  upsertBackupArtifact,
  getPlatformBackupArtifacts,
  getOrganizationBackupArtifacts,
  markBackupArtifactsPruned,
  getAllBackupArtifacts: vi.fn(),
  getBackupArtifactByPathname: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

import { createAndCatalogBackup } from "./backup-orchestrator";

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
    reserveBackupArtifact.mockResolvedValue({ id: "artifact-1", status: "CREATING" });
    deleteStoredBackup.mockResolvedValue(undefined);
    updateBackupArtifactStatus.mockResolvedValue(undefined);
    upsertBackupArtifact.mockResolvedValue(undefined);
    markBackupArtifactsPruned.mockResolvedValue(0);
    getPlatformBackupArtifacts.mockResolvedValue([]);
    getOrganizationBackupArtifacts.mockResolvedValue([]);
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

  it("rejects a tenant manifest attributed to another organization", async () => {
    const tenantTarget = { filename: "tenant", pathname: "organization-backups/org-1/tenant" };
    const wrongManifest = { ...manifest, scope: "ORGANIZATION", organization: { id: "org-2" } };
    verifyStoredBackup.mockResolvedValue({ valid: true, filename: "tenant", size: 10, sha256: "a".repeat(64), manifest: wrongManifest });

    await expect(createAndCatalogBackup({ scope: "ORGANIZATION", organizationId: "org-1", target: tenantTarget })).rejects.toThrow("otra organización");
    expect(updateBackupArtifactStatus).toHaveBeenCalledWith("artifact-1", "BLOCKED");
  });
});
