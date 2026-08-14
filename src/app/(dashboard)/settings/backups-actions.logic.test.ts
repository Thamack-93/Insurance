import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireSuperAdmin = vi.hoisted(() => vi.fn());
const createDatabaseBackup = vi.hoisted(() => vi.fn());
const listBackups = vi.hoisted(() => vi.fn());
const listRekeyedBackups = vi.hoisted(() => vi.fn());
const getBackupPreflightStatus = vi.hoisted(() => vi.fn());
const formatBackupPreflightError = vi.hoisted(() => vi.fn());
const verifyStoredBackup = vi.hoisted(() => vi.fn());
const rekeyStoredBackup = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth", () => ({ requireSuperAdmin, AuthError: class AuthError extends Error {} }));
vi.mock("@/lib/backup", () => ({
  createDatabaseBackup,
  formatBackupPreflightError,
  listBackups,
  listRekeyedBackups,
  getBackupPreflightStatus,
  verifyStoredBackup,
  rekeyStoredBackup,
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { createBackup, listBackupsAction, rekeyBackupAction, verifyBackupAction } from "./backups-actions";

describe("backups actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSuperAdmin.mockResolvedValue({ id: "admin-1" });
    getBackupPreflightStatus.mockReturnValue({ ready: true, checks: [] });
    formatBackupPreflightError.mockReturnValue("Configuración incompleta");
    listBackups.mockResolvedValue([
      { filename: "backup-1", pathname: "database-backups/backup-1", size: 10, createdAt: new Date("2026-07-04T00:00:00.000Z"), manifestAvailable: true },
    ]);
    listRekeyedBackups.mockResolvedValue([]);
    createDatabaseBackup.mockResolvedValue({
      filename: "backup-2",
      pathname: "database-backups/backup-2",
      size: 20,
      createdAt: new Date("2026-07-05T00:00:00.000Z"),
      manifestAvailable: true,
      manifest: {},
      pruned: [],
    });
    verifyStoredBackup.mockResolvedValue({
      valid: true,
      filename: "backup-1",
      size: 10,
      sha256: "a".repeat(64),
      manifest: { totals: { rows: 12 } },
    });
    rekeyStoredBackup.mockResolvedValue({
      sourceFilename: "backup-1",
      filename: "backup-2",
      pathname: "database-backup-rekeys/backup-2",
      size: 11,
      manifest: {},
    });
  });

  it("requires platform admin access before listing backups", async () => {
    const result = await listBackupsAction();

    expect(requireSuperAdmin).toHaveBeenCalledTimes(1);
    expect(listBackups).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        filename: "backup-1",
        size: 10,
        createdAt: "2026-07-04T00:00:00.000Z",
        manifestAvailable: true,
        storage: "original",
      },
    ]);
  });

  it("requires admin access before creating a backup", async () => {
    const result = await createBackup();

    expect(requireSuperAdmin).toHaveBeenCalledTimes(1);
    expect(createDatabaseBackup).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
    expect(result).toMatchObject({
      ok: true,
      id: "backup-2",
      redirectTo: "/settings",
    });
  });

  it("requires admin access before verifying a backup", async () => {
    const result = await verifyBackupAction("backup-1");

    expect(requireSuperAdmin).toHaveBeenCalledTimes(1);
    expect(verifyStoredBackup).toHaveBeenCalledWith("backup-1");
    expect(result).toMatchObject({
      ok: true,
      id: "backup-1",
      redirectTo: "/settings",
    });
  });

  it("requires admin access before creating an immutable re-encrypted copy", async () => {
    const result = await rekeyBackupAction("backup-1");

    expect(requireSuperAdmin).toHaveBeenCalledTimes(1);
    expect(rekeyStoredBackup).toHaveBeenCalledWith("backup-1");
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
    expect(result).toMatchObject({ ok: true, id: "backup-2", redirectTo: "/settings" });
  });
});
