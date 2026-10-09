import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    platformRuntimeState: { findUnique: vi.fn() },
  };
  const db = {
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
  };
  return { transaction, db, getDb: vi.fn(() => db), organization: { id: "demo-a", status: "PROVISIONING", kind: "DEMO" } };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/auth", () => ({
  AuthError: class AuthError extends Error {
    constructor(message: string, public status = 401) { super(message); }
  },
  clearSessionCookie: vi.fn(),
  getSession: vi.fn(),
  requireUser: vi.fn(),
  setSessionCookie: vi.fn(),
}));

import { withSystemOrganizationTransaction } from "@/lib/organization-context";

describe("system tenant transactions during maintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.organization = { id: "demo-a", status: "PROVISIONING", kind: "DEMO" };
    mocks.transaction.$queryRaw.mockImplementation(async () => [mocks.organization]);
    mocks.transaction.$executeRaw.mockResolvedValue(1);
    mocks.transaction.platformRuntimeState.findUnique.mockResolvedValue({ writeMode: "MAINTENANCE" });
  });

  it("allows only a DEMO already in PROVISIONING to finish its synthetic seed", async () => {
    const callback = vi.fn(async () => "seeded");

    await expect(withSystemOrganizationTransaction("demo-a", "demo provision", callback)).resolves.toBe("seeded");
    expect(callback).toHaveBeenCalledOnce();
  });

  it.each([
    { kind: "CUSTOMER", status: "PROVISIONING", reason: "demo provision" },
    { kind: "DEMO", status: "ACTIVE", reason: "demo provision" },
    { kind: "CUSTOMER", status: "ACTIVE", reason: "renewal follow-up" },
  ])("keeps maintenance writes blocked for $kind/$status using $reason", async ({ kind, status, reason }) => {
    mocks.organization = { id: "demo-a", status, kind };
    const callback = vi.fn(async () => "must not run");

    await expect(withSystemOrganizationTransaction("demo-a", reason, callback)).rejects.toThrow("POLICYDESK_MAINTENANCE_MODE");
    expect(callback).not.toHaveBeenCalled();
  });
});
