import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  findMany: vi.fn(),
  withSystemOrganizationTransaction: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/organization-context", () => ({ withSystemOrganizationTransaction: mocks.withSystemOrganizationTransaction }));
vi.mock("@vercel/blob", () => ({ del: vi.fn(), list: mocks.list }));

import { demoUploadRetentionDeadline, runDemoRetention } from "./demo-retention";

describe("DEMO upload retention deadlines", () => {
  it("starts preventive purge at 47 hours and expires at 48 hours", () => {
    const uploadedAt = new Date("2026-09-08T00:00:00.000Z");
    const result = demoUploadRetentionDeadline(uploadedAt);
    expect(result.purgeAfterAt.toISOString()).toBe("2026-09-09T23:00:00.000Z");
    expect(result.expiresAt.toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });
});

describe("DEMO retention lifecycle", () => {
  it("reports due real-data resets without executing them", async () => {
    mocks.list.mockResolvedValue({ blobs: [], hasMore: false });
    mocks.withSystemOrganizationTransaction.mockImplementation(async (_organizationId: string, _reason: string, callback: (tx: unknown) => unknown) => callback({}));
    mocks.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "demo-1", status: "SUSPENDED", demoState: { trialEndsAt: new Date("2026-09-01T00:00:00.000Z"), realDataResetAt: new Date("2026-09-08T00:00:00.000Z"), resetStatus: "IDLE", resetLeaseExpiresAt: null } }]);
    mocks.getDb.mockReturnValue({ organization: { findMany: mocks.findMany } });

    await expect(runDemoRetention(new Date("2026-09-09T00:00:00.000Z"))).resolves.toMatchObject({
      filesPurged: 0,
      resets: 0,
      pendingResets: 1,
      suspended: 0,
      failures: 0,
    });
  });
});
