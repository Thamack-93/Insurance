import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireSuperAdmin = vi.hoisted(() => vi.fn());
const getBackupPreflightStatus = vi.hoisted(() => vi.fn());
const formatBackupPreflightError = vi.hoisted(() => vi.fn());
const verifyStoredBackup = vi.hoisted(() => vi.fn());
const rekeyStoredBackup = vi.hoisted(() => vi.fn());
const getPlatformBackupArtifacts = vi.hoisted(() => vi.fn());
const getOrganizationBackupArtifacts = vi.hoisted(() => vi.fn());
const getBackupArtifact = vi.hoisted(() => vi.fn());
const upsertBackupArtifact = vi.hoisted(() => vi.fn());
const updateBackupArtifactStatus = vi.hoisted(() => vi.fn());
const createAndCatalogBackup = vi.hoisted(() => vi.fn());
const reconcileBackupCatalog = vi.hoisted(() => vi.fn());
const findOrganization = vi.hoisted(() => vi.fn());
const createPlatformAudit = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth", () => ({ requireSuperAdmin, AuthError: class AuthError extends Error {} }));
vi.mock("@/lib/backup", () => ({
  formatBackupPreflightError,
  getBackupPreflightStatus,
  verifyStoredBackup,
  rekeyStoredBackup,
}));
vi.mock("@/lib/backup-catalog", () => ({
  getPlatformBackupArtifacts,
  getOrganizationBackupArtifacts,
  getBackupArtifact,
  upsertBackupArtifact,
  updateBackupArtifactStatus,
}));
vi.mock("@/lib/backup-orchestrator", () => ({ createAndCatalogBackup, reconcileBackupCatalog }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    organization: { findUnique: findOrganization },
    platformAuditLog: { create: createPlatformAudit },
  }),
}));

import {
  createBackup,
  listBackupsAction,
  listOrganizationBackupsAction,
  reconcileBackupCatalogAction,
  rekeyBackupAction,
  verifyBackupAction,
} from "./backups-actions";

const platformArtifact = {
  id: "artifact-1",
  pathname: "database-backups/backup-1",
  filename: "backup-1",
  size: 10,
  createdAt: "2026-07-04T00:00:00.000Z",
  manifestAvailable: true,
  storage: "original",
  scope: "PLATFORM",
  organizationId: null,
  status: "VERIFIED",
  capability: "DATABASE_ONLY",
  formatVersion: 1,
  keyVersion: "v2",
  sourceArtifactId: null,
  payloadSha256: "a".repeat(64),
  manifestSha256: "b".repeat(64),
};

describe("backup catalog actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSuperAdmin.mockResolvedValue({ id: "admin-1" });
    getBackupPreflightStatus.mockReturnValue({ ready: true, checks: [] });
    formatBackupPreflightError.mockReturnValue("Configuración incompleta");
    findOrganization.mockResolvedValue({ id: "org-1" });
    getPlatformBackupArtifacts.mockResolvedValue([platformArtifact]);
    getOrganizationBackupArtifacts.mockResolvedValue([{ ...platformArtifact, id: "tenant-1", scope: "ORGANIZATION", organizationId: "org-1" }]);
    getBackupArtifact.mockResolvedValue(platformArtifact);
    createAndCatalogBackup.mockResolvedValue({ filename: "backup-2", pathname: "database-backups/backup-2", size: 20, manifest: {}, pruned: [] });
    verifyStoredBackup.mockResolvedValue({
      valid: true,
      filename: "backup-1",
      size: 10,
      sha256: "a".repeat(64),
      manifest: { scope: "PLATFORM", capability: "DATABASE_ONLY", totals: { rows: 12 } },
    });
    rekeyStoredBackup.mockResolvedValue({
      sourceFilename: "backup-1",
      filename: "backup-2",
      pathname: "database-backup-rekeys/backup-2",
      size: 11,
      manifest: { completedAt: "2026-07-05T00:00:00.000Z", capability: "DATABASE_ONLY" },
    });
    reconcileBackupCatalog.mockResolvedValue({ verified: 2, invalid: 0, blocked: 0, discovered: 2 });
  });

  it("lists platform backups from BackupArtifact without storage writes", async () => {
    const result = await listBackupsAction();
    expect(result).toHaveLength(1);
    expect(getPlatformBackupArtifacts).toHaveBeenCalledTimes(1);
    expect(upsertBackupArtifact).not.toHaveBeenCalled();
  });

  it("lists only cataloged organization artifacts", async () => {
    const result = await listOrganizationBackupsAction("org-1");
    expect(result).toEqual([expect.objectContaining({ id: "tenant-1", organizationId: "org-1" })]);
    expect(getOrganizationBackupArtifacts).toHaveBeenCalledWith("org-1");
    expect(upsertBackupArtifact).not.toHaveBeenCalled();
  });

  it("creates manual backups through the catalog orchestrator", async () => {
    const result = await createBackup();
    expect(createAndCatalogBackup).toHaveBeenCalledWith({ scope: "PLATFORM" });
    expect(result).toMatchObject({ ok: true, id: "backup-2" });
  });

  it("resolves global verification exclusively by artifactId", async () => {
    const result = await verifyBackupAction("artifact-1");
    expect(getBackupArtifact).toHaveBeenCalledWith("artifact-1");
    expect(verifyStoredBackup).toHaveBeenCalledWith("backup-1", "database-backups/backup-1");
    expect(result).toMatchObject({ ok: true, id: "artifact-1" });
  });

  it("resolves rekey source exclusively by artifactId and catalogs the copy", async () => {
    const result = await rekeyBackupAction("artifact-1");
    expect(rekeyStoredBackup).toHaveBeenCalledWith("backup-1", expect.any(Date), "database-backups/backup-1");
    expect(upsertBackupArtifact).toHaveBeenCalledWith(expect.objectContaining({ sourceArtifactId: "artifact-1", status: "VERIFIED" }));
    expect(result).toMatchObject({ ok: true, id: "backup-2" });
  });

  it("reconciles only through the explicit audited SUPERADMIN action", async () => {
    const result = await reconcileBackupCatalogAction();
    expect(reconcileBackupCatalog).toHaveBeenCalledTimes(1);
    expect(createPlatformAudit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "BACKUP_CATALOG_RECONCILED" }) }));
    expect(result).toMatchObject({ ok: true });
  });
});
