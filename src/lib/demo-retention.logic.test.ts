import { describe, expect, it } from "vitest";
import { demoUploadRetentionDeadline } from "./demo-retention";

describe("DEMO upload retention deadlines", () => {
  it("starts preventive purge at 47 hours and expires at 48 hours", () => {
    const uploadedAt = new Date("2026-09-08T00:00:00.000Z");
    const result = demoUploadRetentionDeadline(uploadedAt);
    expect(result.purgeAfterAt.toISOString()).toBe("2026-09-09T23:00:00.000Z");
    expect(result.expiresAt.toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });
});
