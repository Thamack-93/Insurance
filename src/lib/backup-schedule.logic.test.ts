import { describe, expect, it } from "vitest";
import {
  getBackupScheduleStatus,
  isPlatformBackupDue,
  isTenantBackupDue,
} from "./backup-schedule";

describe("backup schedule", () => {
  it("makes a previous UTC calendar day due at the next 05:00 UTC run", () => {
    const latest = new Date("2026-08-25T05:07:00.000Z");
    expect(isTenantBackupDue(latest, new Date("2026-08-26T05:00:00.000Z"))).toBe(true);
  });

  it("does not repeat a global snapshot before seven calendar days", () => {
    const latest = new Date("2026-08-20T05:02:00.000Z");
    expect(isPlatformBackupDue(latest, new Date("2026-08-26T05:00:00.000Z"))).toBe(false);
    expect(isPlatformBackupDue(latest, new Date("2026-08-27T05:00:00.000Z"))).toBe(true);
  });

  it("reports the next aligned cron boundary", () => {
    const status = getBackupScheduleStatus(
      new Date("2026-08-25T05:07:00.000Z"),
      new Date("2026-08-25T10:00:00.000Z"),
      1,
    );
    expect(status.nextDueAt.toISOString()).toBe("2026-08-26T05:00:00.000Z");
    expect(status.status).toBe("HEALTHY");
  });
});
