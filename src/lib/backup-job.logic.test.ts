import { beforeEach, describe, expect, it, vi } from "vitest";

const getLatestVerifiedBackupArtifact = vi.hoisted(() => vi.fn());
const createAndCatalogBackup = vi.hoisted(() => vi.fn());
const findManyOrganizations = vi.hoisted(() => vi.fn());

vi.mock("@/lib/backup", () => ({
  buildScheduledPlatformBackupTarget: () => ({ filename: "global-target", pathname: "database-backups/global-target" }),
  buildScheduledOrganizationBackupTarget: (organizationId: string) => ({ filename: `tenant-${organizationId}`, pathname: `organization-backups/${organizationId}/tenant-${organizationId}` }),
}));
vi.mock("@/lib/backup-catalog", () => ({ getLatestVerifiedBackupArtifact }));
vi.mock("@/lib/backup-orchestrator", () => ({ createAndCatalogBackup }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ organization: { findMany: findManyOrganizations } }) }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { calendarDaysSince, isGlobalBackupDue, runBackupJob } from "./backup-job";

describe("backup job mandatory cadence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyOrganizations.mockResolvedValue([]);
    getLatestVerifiedBackupArtifact.mockResolvedValue(null);
    createAndCatalogBackup.mockImplementation(async (input: { target: { filename: string; pathname: string } }) => ({
      ...input.target,
      size: 1,
      manifest: { totals: { tables: 1, rows: 1 } },
      pruned: [],
    }));
  });

  it("counts UTC calendar days and keeps the platform snapshot weekly", () => {
    const latest = new Date("2026-08-19T23:59:59.000Z");
    const now = new Date("2026-08-26T05:00:00.000Z");
    expect(calendarDaysSince(latest, now)).toBe(7);
    expect(isGlobalBackupDue(latest, now)).toBe(true);
  });

  it("does not consult historical autoBackup or backupFrequency settings", async () => {
    await runBackupJob({ now: new Date("2026-08-26T05:00:00.000Z") });
    expect(createAndCatalogBackup).toHaveBeenCalledWith(expect.objectContaining({ scope: "PLATFORM" }));
  });

  it("runs a tenant backup on the next 05:00 UTC window even when yesterday finished late", async () => {
    findManyOrganizations.mockResolvedValue([{ id: "org-1" }]);
    getLatestVerifiedBackupArtifact.mockImplementation(async (input: { scope: string }) => input.scope === "PLATFORM"
      ? { createdAt: "2026-08-25T05:00:00.000Z" }
      : { createdAt: "2026-08-25T05:07:00.000Z" });

    await runBackupJob({ now: new Date("2026-08-26T05:00:00.000Z") });

    expect(createAndCatalogBackup).toHaveBeenCalledTimes(1);
    expect(createAndCatalogBackup).toHaveBeenCalledWith(expect.objectContaining({ scope: "ORGANIZATION", organizationId: "org-1" }));
  });

  it("attempts every tenant and returns failure when any due backup fails", async () => {
    findManyOrganizations.mockResolvedValue([{ id: "org-1" }, { id: "org-2" }]);
    createAndCatalogBackup.mockImplementation(async (input: { scope: string; organizationId?: string; target: { filename: string; pathname: string } }) => {
      if (input.scope === "PLATFORM" || input.organizationId === "org-1") throw new Error("storage unavailable");
      return { ...input.target, size: 1, manifest: { totals: { tables: 1, rows: 1 } }, pruned: [] };
    });

    const result = await runBackupJob({ now: new Date("2026-08-26T05:00:00.000Z") });

    expect(result.ok).toBe(false);
    expect(result.failures).toBe(2);
    expect(result.organizations).toEqual([
      expect.objectContaining({ organizationId: "org-1", status: "failed" }),
      expect.objectContaining({ organizationId: "org-2", status: "created" }),
    ]);
  });
});
