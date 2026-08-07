import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const AuthError = class AuthError extends Error {};
  const tx = {
    client: { updateMany: vi.fn() },
    activityLog: { updateMany: vi.fn() },
    organizationMembership: { deleteMany: vi.fn() },
    user: { delete: vi.fn() },
  };
  const db = {
    user: { findUnique: vi.fn(), count: vi.fn() },
    client: { count: vi.fn() },
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  return {
    tx,
    db,
    actor: { id: "admin-1", role: "ADMIN" },
    AuthError,
    requireAdmin: vi.fn(),
    writeActivityLog: vi.fn(),
    revalidatePath: vi.fn(),
    logError: vi.fn(),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/auth", () => ({
  AuthError: mocks.AuthError,
  SYSTEM_USER_ID: "system-user-0000",
  requireAdmin: mocks.requireAdmin,
  requireUser: vi.fn(),
  hashPassword: vi.fn(() => "hash"),
  verifyPassword: vi.fn(),
}));
vi.mock("@/lib/activity-log", () => ({ writeActivityLog: mocks.writeActivityLog }));
vi.mock("@/lib/logger", () => ({ logError: mocks.logError }));

import { deleteUser } from "@/app/(dashboard)/settings/users/actions";

describe("deleteUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue(mocks.actor);
    mocks.db.user.findUnique.mockResolvedValue({ id: "target-1", email: "target@example.test", role: "AGENT", active: false });
    mocks.db.client.count.mockResolvedValue(0);
    mocks.db.user.count.mockResolvedValue(1);
    mocks.tx.user.delete.mockResolvedValue({ id: "target-1" });
  });

  it("rejects deleting an active account", async () => {
    mocks.db.user.findUnique.mockResolvedValue({ id: "target-1", active: true, role: "AGENT" });
    const result = await deleteUser("target-1");
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/desactiva/i) });
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("protects the last active administrator", async () => {
    mocks.db.user.findUnique.mockResolvedValue({ id: "target-1", active: true, role: "ADMIN" });
    mocks.db.user.count.mockResolvedValue(0);
    const result = await deleteUser("target-1");
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/último administrador/i) });
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects deleting the system or current administrator", async () => {
    await expect(deleteUser("system-user-0000")).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/sistema/i) });
    await expect(deleteUser("admin-1")).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/propia/i) });
  });

  it("rejects non-administrator actors", async () => {
    mocks.requireAdmin.mockRejectedValue(new mocks.AuthError("Solo los administradores pueden continuar."));
    const result = await deleteUser("target-1");
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/administradores/i) });
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("requires a destination for an owned portfolio", async () => {
    mocks.db.client.count.mockResolvedValue(2);
    const result = await deleteUser("target-1");
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/reasignar/i) });
  });

  it("reassigns the portfolio, preserves audit and deletes only the account", async () => {
    mocks.db.client.count.mockResolvedValue(2);
    mocks.db.user.findUnique
      .mockResolvedValueOnce({ id: "target-1", email: "target@example.test", role: "AGENT", active: false })
      .mockResolvedValueOnce({ id: "agent-2", active: true });

    const result = await deleteUser("target-1", "agent-2");

    expect(result).toMatchObject({ ok: true });
    expect(mocks.tx.client.updateMany).toHaveBeenCalledWith({
      where: { portfolioOwnerId: "target-1" },
      data: { portfolioOwnerId: "agent-2" },
    });
    expect(mocks.tx.activityLog.updateMany).toHaveBeenCalledWith({
      where: { userId: "target-1" },
      data: { userId: "system-user-0000" },
    });
    expect(mocks.tx.organizationMembership.deleteMany).toHaveBeenCalledWith({ where: { userId: "target-1" } });
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
