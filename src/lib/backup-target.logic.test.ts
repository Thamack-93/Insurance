import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildScheduledOrganizationBackupTarget,
  buildScheduledPlatformBackupTarget,
} from "./backup";

describe("scheduled backup targets", () => {
  const originalVersion = process.env.BACKUP_ENCRYPTION_KEY_VERSION;

  beforeEach(() => {
    process.env.BACKUP_ENCRYPTION_KEY_VERSION = "v2";
  });

  afterEach(() => {
    if (originalVersion === undefined) delete process.env.BACKUP_ENCRYPTION_KEY_VERSION;
    else process.env.BACKUP_ENCRYPTION_KEY_VERSION = originalVersion;
  });

  it("reuses one tenant pathname for every retry in the same UTC day", () => {
    const first = buildScheduledOrganizationBackupTarget("org-1", new Date("2026-08-25T05:00:00.000Z"));
    const retry = buildScheduledOrganizationBackupTarget("org-1", new Date("2026-08-25T23:59:59.000Z"));
    expect(retry).toEqual(first);
  });

  it("reuses one global pathname for every retry in the same UTC week", () => {
    const first = buildScheduledPlatformBackupTarget(new Date("2026-08-24T05:00:00.000Z"));
    const retry = buildScheduledPlatformBackupTarget(new Date("2026-08-30T23:59:59.000Z"));
    expect(retry).toEqual(first);
    expect(buildScheduledPlatformBackupTarget(new Date("2026-08-31T05:00:00.000Z"))).not.toEqual(first);
  });
});
