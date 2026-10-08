import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquireLock: vi.fn(),
  requireSuperAdmin: vi.fn(),
  rootTransaction: vi.fn(),
  findOrganization: vi.fn(),
  systemTransaction: vi.fn(),
  release: vi.fn(),
  blobList: vi.fn(),
  blobDelete: vi.fn(),
  txCalls: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@vercel/blob", () => ({ list: mocks.blobList, del: mocks.blobDelete }));
vi.mock("@/lib/auth", () => ({ AuthError: class AuthError extends Error {}, hashPassword: vi.fn(), requireSuperAdmin: mocks.requireSuperAdmin }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ $transaction: mocks.rootTransaction }) }));
vi.mock("@/lib/request-guards", () => ({ acquireDistributedLock: mocks.acquireLock }));
vi.mock("@/lib/organization-context", () => ({ withSystemOrganizationTransaction: mocks.systemTransaction }));
vi.mock("@/lib/demo-seed", () => ({ DEMO_SEED_VERSION: "demo-test", seedDemoBaseline: vi.fn(), validateDemoBaseline: vi.fn() }));
vi.mock("@/lib/tenant-organization-foundation", () => ({ SYSTEM_USER_ID: "system-user" }));
vi.mock("@/lib/nora-capture-handoff-storage.shared", () => ({ NORA_CAPTURE_HANDOFF_PREFIX: "nora-handoff" }));
vi.mock("@/lib/nora-pdf-storage.shared", () => ({ NORA_POLICY_PDF_PREFIX: "nora-pdf" }));

import { provisionDemoOrganization, resetDemoOrganizationForCli } from "./demo-organizations";

describe("DEMO reset target guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PLATFORM_ORG_PROVISIONING_ENABLED", "1");
    mocks.requireSuperAdmin.mockResolvedValue({ id: "platform-admin" });
    mocks.txCalls.length = 0;
    mocks.acquireLock.mockResolvedValue({ acquired: true, release: mocks.release, renew: vi.fn().mockResolvedValue(true) });
    mocks.findOrganization.mockResolvedValue({ id: "customer-org", kind: "CUSTOMER", status: "ACTIVE" });
    mocks.systemTransaction.mockImplementation(async (_organizationId: string, _purpose: string, callback: (tx: unknown) => unknown) =>
      callback({ organization: { findUnique: (...args: unknown[]) => { mocks.txCalls.push("organization.findUnique"); return mocks.findOrganization(...args); } } }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects provisioning more than the single DEMO owner before acquiring locks or writing", async () => {
    await expect(provisionDemoOrganization({ name: "Prospect", ownerName: "DEMO Owner", requestedUsers: 2 }))
      .rejects.toThrow("DEMO_SINGLE_USER_REQUIRED");
    expect(mocks.acquireLock).not.toHaveBeenCalled();
    expect(mocks.systemTransaction).not.toHaveBeenCalled();
  });

  it("reconciles old multi-user DEMOs and revokes extra accounts on an idempotent retry", async () => {
    const organizationId = "org_demo_40542f7e6b9ec1650870123e";
    const extraUserId = "previous-demo-agent";
    const updateMembership = vi.fn().mockResolvedValue({ count: 1 });
    const deactivateUser = vi.fn().mockResolvedValue({ count: 1 });
    const revokeSessions = vi.fn().mockResolvedValue({ count: 2 });
    const audit = vi.fn().mockResolvedValue({});
    const tx = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: organizationId, kind: "DEMO", status: "ACTIVE", name: "Prospect", slug: "prospect" }),
      },
      organizationMembership: {
        findMany: vi.fn().mockResolvedValue([{ userId: extraUserId, active: true, user: { active: true, platformRole: "NONE" } }]),
        updateMany: updateMembership,
      },
      user: { updateMany: deactivateUser },
      session: { updateMany: revokeSessions },
      platformAuditLog: { create: audit },
      organizationCapability: { upsert: vi.fn().mockResolvedValue({}) },
      demoOrganizationState: { findUnique: vi.fn().mockResolvedValue({ trialEndsAt: new Date("2026-11-01T00:00:00Z") }) },
    };
    mocks.rootTransaction.mockImplementation(async (callback: (client: unknown) => unknown) => callback(tx));

    const result = await provisionDemoOrganization({ name: "Prospect", ownerName: "DEMO Owner" });

    expect(result).toMatchObject({ organizationId, credentials: [], temporaryPassword: "" });
    expect(updateMembership).toHaveBeenCalledWith({
      where: { organizationId, userId: extraUserId, active: true },
      data: { active: false },
    });
    expect(deactivateUser).toHaveBeenCalledWith({
      where: { id: extraUserId, active: true },
      data: { active: false, sessionVersion: { increment: 1 } },
    });
    expect(revokeSessions).toHaveBeenCalledWith({
      where: { userId: extraUserId, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "DEMO_MEMBER_ACCESS_REVOKED", targetUserId: extraUserId }),
    }));
    expect(mocks.systemTransaction).not.toHaveBeenCalled();
  });

  it("audits session revocation when an extra DEMO member is already inactive", async () => {
    const organizationId = "org_demo_40542f7e6b9ec1650870123e";
    const extraUserId = "previous-demo-agent";
    const revokeSessions = vi.fn().mockResolvedValue({ count: 1 });
    const audit = vi.fn().mockResolvedValue({});
    const tx = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: organizationId, kind: "DEMO", status: "ACTIVE", name: "Prospect", slug: "prospect" }),
      },
      organizationMembership: {
        findMany: vi.fn().mockResolvedValue([{ userId: extraUserId, active: false, user: { active: false, platformRole: "NONE" } }]),
        updateMany: vi.fn(),
      },
      user: { updateMany: vi.fn() },
      session: { updateMany: revokeSessions },
      platformAuditLog: { create: audit },
      organizationCapability: { upsert: vi.fn().mockResolvedValue({}) },
      demoOrganizationState: { findUnique: vi.fn().mockResolvedValue({ trialEndsAt: new Date("2026-11-01T00:00:00Z") }) },
    };
    mocks.rootTransaction.mockImplementation(async (callback: (client: unknown) => unknown) => callback(tx));

    const result = await provisionDemoOrganization({ name: "Prospect", ownerName: "DEMO Owner" });

    expect(result).toMatchObject({ organizationId, credentials: [], temporaryPassword: "" });
    expect(tx.organizationMembership.updateMany).not.toHaveBeenCalled();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(revokeSessions).toHaveBeenCalledWith({
      where: { userId: extraUserId, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "DEMO_MEMBER_ACCESS_REVOKED",
        targetUserId: extraUserId,
        metadataJson: expect.stringContaining('"sessionsRevoked":1'),
      }),
    }));
  });

  it("fails closed instead of changing a SUPERADMIN membership during DEMO reconciliation", async () => {
    const tx = {
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: "demo-org", kind: "DEMO", status: "ACTIVE", name: "Prospect", slug: "prospect" }),
      },
      organizationMembership: {
        findMany: vi.fn().mockResolvedValue([{ userId: "platform-admin", active: true, user: { active: true, platformRole: "SUPERADMIN" } }]),
        updateMany: vi.fn(),
      },
    };
    mocks.rootTransaction.mockImplementation(async (callback: (client: unknown) => unknown) => callback(tx));

    await expect(provisionDemoOrganization({ name: "Prospect", ownerName: "DEMO Owner" }))
      .rejects.toThrow("DEMO_SINGLE_USER_INVARIANT_UNSAFE_MEMBER");
    expect(tx.organizationMembership.updateMany).not.toHaveBeenCalled();
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
