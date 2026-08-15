import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  requireUser: vi.fn(),
  setSessionCookie: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  writeActivityLog: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  AuthError: class AuthError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  getSession: mocks.getSession,
  requireUser: mocks.requireUser,
  setSessionCookie: mocks.setSessionCookie,
}));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    organizationMembership: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
    },
  }),
}));
vi.mock("@/lib/activity-log", () => ({ writeActivityLog: mocks.writeActivityLog }));

import { resolveOrganizationContext } from "@/lib/organization-context";

const user = {
  id: "user-a",
  email: "a@example.test",
  name: "User A",
  role: "ADMIN",
  platformRole: "NONE",
};

const membership = {
  id: "membership-a",
  role: "ADMIN",
  active: true,
  organization: { id: "org-a", name: "Org A", slug: "org-a", status: "ACTIVE" },
};

describe("organization context resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ userId: user.id, organizationId: undefined });
    mocks.requireUser.mockResolvedValue(user);
    mocks.findMany.mockResolvedValue([membership]);
    mocks.findFirst.mockResolvedValue(membership);
  });

  it("automatically resolves the only active membership when the signed hint is absent", async () => {
    await expect(resolveOrganizationContext()).resolves.toMatchObject({
      status: "ready",
      context: { organizationId: "org-a", membershipRole: "ADMIN" },
    });
  });

  it("fails stale instead of silently replacing a contradictory signed hint", async () => {
    mocks.getSession.mockResolvedValue({ userId: user.id, organizationId: "org-b" });
    await expect(resolveOrganizationContext()).resolves.toMatchObject({ status: "stale-selection" });
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("treats multiple memberships as corruption even if only one is active", async () => {
    mocks.findMany.mockResolvedValue([
      membership,
      {
        ...membership,
        id: "membership-b",
        active: false,
        organization: { id: "org-b", name: "Org B", slug: "org-b", status: "ACTIVE" },
      },
    ]);
    await expect(resolveOrganizationContext()).resolves.toMatchObject({ status: "corrupt-memberships" });
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("blocks an inactive membership immediately", async () => {
    mocks.findMany.mockResolvedValue([{ ...membership, active: false }]);
    await expect(resolveOrganizationContext()).resolves.toEqual({ status: "no-membership", options: [] });
  });
});
