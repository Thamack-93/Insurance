import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const AuthError = class AuthError extends Error {};
  const tx = {
    organization: { findUnique: vi.fn() },
    client: { count: vi.fn(), updateMany: vi.fn() },
    activityLog: { updateMany: vi.fn() },
    organizationMembership: { findFirst: vi.fn(), delete: vi.fn() },
    user: { create: vi.fn(), delete: vi.fn() },
  };
  const db = {
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  return {
    tx,
    db,
    actor: { id: "admin-1", role: "ADMIN" },
    context: {
      userId: "admin-1",
      organizationId: "org-a",
      membershipId: "membership-admin-1",
      membershipRole: "ADMIN",
    },
    AuthError,
    requireOrganizationRole: vi.fn(),
    assertOrganizationContextInTransaction: vi.fn(),
    writeActivityLog: vi.fn(),
    revalidatePath: vi.fn(),
    logError: vi.fn(),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/auth", () => ({
  AuthError: mocks.AuthError,
  SYSTEM_USER_ID: "system-user-0000",
  requireUser: vi.fn(),
  hashPassword: vi.fn(() => "hash"),
  verifyPassword: vi.fn(),
}));
vi.mock("@/lib/organization-context", () => ({
  requireOrganizationRole: mocks.requireOrganizationRole,
  assertOrganizationContextInTransaction: mocks.assertOrganizationContextInTransaction,
}));
vi.mock("@/lib/activity-log", () => ({ writeActivityLog: mocks.writeActivityLog }));
vi.mock("@/lib/logger", () => ({ logError: mocks.logError }));

import { deleteUser, inviteUser } from "@/app/(dashboard)/settings/users/actions";

describe("deleteUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOrganizationRole.mockResolvedValue(mocks.context);
    mocks.tx.organization.findUnique.mockResolvedValue({ kind: "CUSTOMER" });
    const targetMembership = {
      userId: "target-1",
      organizationId: "org-a",
      role: "AGENT",
      active: false,
      user: { id: "target-1", email: "target@example.test", active: false },
    };
    mocks.tx.organizationMembership.findFirst.mockImplementation(async ({ where }: { where: { id?: string; userId?: string } }) => {
      if (where.userId === "target-1") return targetMembership;
      if (where.userId === "agent-2") return { userId: "agent-2" };
      return null;
    });
    mocks.tx.client.count.mockResolvedValue(0);
    mocks.tx.user.delete.mockResolvedValue({ id: "target-1" });
  });

  it("rejects creating additional accounts inside a DEMO organization", async () => {
    mocks.tx.organization.findUnique.mockResolvedValue({ kind: "DEMO" });

    const result = await inviteUser({ name: "Extra User", email: "extra@example.test", role: "AGENT" });

    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/una sola cuenta/i) });
    expect(mocks.tx.user.create).not.toHaveBeenCalled();
  });

  it("rejects deleting an active account", async () => {
    mocks.tx.organizationMembership.findFirst.mockResolvedValue({ role: "AGENT", active: true, user: { id: "target-1", active: true } });
    const result = await deleteUser("target-1");
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/desactiva/i) });
    expect(mocks.tx.user.delete).not.toHaveBeenCalled();
  });

  it("protects an Owner from deletion", async () => {
    mocks.tx.organizationMembership.findFirst.mockResolvedValue({ role: "OWNER", active: true, user: { id: "target-1", active: true } });
    const result = await deleteUser("target-1");
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/propietario/i) });
    expect(mocks.tx.user.delete).not.toHaveBeenCalled();
  });

  it("rejects deleting the system or current administrator", async () => {
    await expect(deleteUser("system-user-0000")).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/sistema/i) });
    await expect(deleteUser("admin-1")).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/propia/i) });
  });

  it("rejects non-administrator actors", async () => {
    mocks.requireOrganizationRole.mockRejectedValue(new mocks.AuthError("Solo los administradores pueden continuar."));
    const result = await deleteUser("target-1");
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/administradores/i) });
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("requires a destination for an owned portfolio", async () => {
    mocks.tx.client.count.mockResolvedValue(2);
    const result = await deleteUser("target-1");
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/reasignar/i) });
  });

  it("reassigns the portfolio, preserves audit and deletes only the account", async () => {
    mocks.tx.client.count.mockResolvedValue(2);

    const result = await deleteUser("target-1", "agent-2");

    expect(result).toMatchObject({ ok: true });
    expect(mocks.tx.client.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org-a", portfolioOwnerId: "target-1" },
      data: { portfolioOwnerId: "agent-2" },
    });
    expect(mocks.tx.activityLog.updateMany).toHaveBeenCalledWith({
      where: { userId: "target-1", organizationId: "org-a" },
      data: { userId: "system-user-0000" },
    });
    expect(mocks.tx.organizationMembership.delete).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId: "org-a", userId: "target-1" } },
    });
    expect(mocks.tx.user.delete).toHaveBeenCalledWith({ where: { id: "target-1" } });
    expect(mocks.writeActivityLog).toHaveBeenCalledWith(expect.objectContaining({ action: "USER_DELETE", db: mocks.tx }));
  });

  it("reports a failed transaction without claiming deletion", async () => {
    mocks.tx.user.delete.mockRejectedValue(new Error("constraint failure"));
    const result = await deleteUser("target-1");
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/no se pudo eliminar/i) });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalled();
  });
});
