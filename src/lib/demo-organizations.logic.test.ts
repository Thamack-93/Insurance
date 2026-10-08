import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquireLock: vi.fn(),
  findOrganization: vi.fn(),
  systemTransaction: vi.fn(),
  release: vi.fn(),
  blobList: vi.fn(),
  blobDelete: vi.fn(),
  txCalls: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@vercel/blob", () => ({ list: mocks.blobList, del: mocks.blobDelete }));
vi.mock("@/lib/auth", () => ({ AuthError: class AuthError extends Error {}, hashPassword: vi.fn(), requireSuperAdmin: vi.fn() }));
vi.mock("@/lib/request-guards", () => ({ acquireDistributedLock: mocks.acquireLock }));
vi.mock("@/lib/organization-context", () => ({ withSystemOrganizationTransaction: mocks.systemTransaction }));
vi.mock("@/lib/demo-seed", () => ({ DEMO_SEED_VERSION: "demo-test", seedDemoBaseline: vi.fn(), validateDemoBaseline: vi.fn() }));
vi.mock("@/lib/tenant-organization-foundation", () => ({ SYSTEM_USER_ID: "system-user" }));
vi.mock("@/lib/nora-capture-handoff-storage.shared", () => ({ NORA_CAPTURE_HANDOFF_PREFIX: "nora-handoff" }));
vi.mock("@/lib/nora-pdf-storage.shared", () => ({ NORA_POLICY_PDF_PREFIX: "nora-pdf" }));

import { resetDemoOrganizationForCli } from "./demo-organizations";

describe("DEMO reset target guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.txCalls.length = 0;
    mocks.acquireLock.mockResolvedValue({ acquired: true, release: mocks.release, renew: vi.fn().mockResolvedValue(true) });
    mocks.findOrganization.mockResolvedValue({ id: "customer-org", kind: "CUSTOMER", status: "ACTIVE" });
    mocks.systemTransaction.mockImplementation(async (_organizationId: string, _purpose: string, callback: (tx: unknown) => unknown) =>
      callback({ organization: { findUnique: (...args: unknown[]) => { mocks.txCalls.push("organization.findUnique"); return mocks.findOrganization(...args); } } }),
    );
  });

  it("rejects a CUSTOMER before any reset write, blob operation, or tenant-data access", async () => {
    await expect(resetDemoOrganizationForCli("customer-org", "operator-request", false, "review customer reset")).rejects.toThrow("DEMO_RESET_REQUIRES_DEMO_ORGANIZATION");
    expect(mocks.txCalls).toEqual(["organization.findUnique"]);
    expect(mocks.blobList).not.toHaveBeenCalled();
    expect(mocks.blobDelete).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it.each([undefined, "", "short", "   reason   ", "r".repeat(501)])("requires an explicit operator reset reason (%s)", async (reason) => {
    await expect(resetDemoOrganizationForCli("demo-org", "operator-request", true, reason)).rejects.toThrow("DEMO_RESET_REASON_REQUIRED");
    expect(mocks.systemTransaction).not.toHaveBeenCalled();
    expect(mocks.blobList).not.toHaveBeenCalled();
    expect(mocks.blobDelete).not.toHaveBeenCalled();
  });

  it.each([new Date(0), new Date(Date.now() + 120_000)])("previews a RESETTING DEMO without recovering or modifying its lease (%s)", async (resetLeaseExpiresAt) => {
    const write = vi.fn(() => { throw new Error("PREVIEW_ATTEMPTED_WRITE"); });
    const state = { resetStatus: "RESETTING", resetLeaseExpiresAt, dataVersion: 3 };
    mocks.systemTransaction.mockImplementation(async (_organizationId: string, _purpose: string, callback: (tx: unknown) => unknown) => callback({
      organization: { findUnique: vi.fn().mockResolvedValue({ id: "demo-org", kind: "DEMO", status: "RESETTING" }), update: write, updateMany: write },
      demoOrganizationState: { findUnique: vi.fn().mockResolvedValue(state), update: write, updateMany: write },
      platformAuditLog: { create: write },
      client: { count: vi.fn().mockResolvedValue(25) },
      policy: { count: vi.fn().mockResolvedValue(20) },
      demoUploadArtifact: { count: vi.fn().mockResolvedValue(2) },
    }));
    await expect(resetDemoOrganizationForCli("demo-org", "preview-request", true, "review reset preview")).resolves.toMatchObject({
      dryRun: true, counts: { clients: 25, policies: 20 }, artifactCount: 2,
    });
    expect(write).not.toHaveBeenCalled();
    expect(mocks.blobList).not.toHaveBeenCalled();
    expect(mocks.blobDelete).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
