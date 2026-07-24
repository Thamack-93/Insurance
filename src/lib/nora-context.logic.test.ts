import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getDb = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({ getDb }));

import { resolveAuthorizedNoraContext } from "@/lib/nora-context";

const findFirst = vi.fn();

function makeDb() {
  return {
    client: { findFirst },
    policy: { findFirst },
    receipt: { findFirst },
    workItem: { findFirst },
    claim: { findFirst },
    policyEndorsement: { findFirst },
  };
}

describe("resolveAuthorizedNoraContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDb.mockReturnValue(makeDb());
  });

  it("returns the context only when the scoped receipt exists", async () => {
    findFirst.mockResolvedValue({ id: "receipt-1", receiptNumber: "REC-001" });

    await expect(
      resolveAuthorizedNoraContext({ type: "receipt", id: "receipt-1" }, "agent-1"),
    ).resolves.toEqual({ type: "receipt", id: "receipt-1", label: "REC-001" });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { id: "receipt-1" },
            { client: { portfolioOwnerId: "agent-1" } },
          ],
        },
      }),
    );
  });

  it("does not reveal a foreign or nonexistent context", async () => {
    findFirst.mockResolvedValue(null);

    await expect(
      resolveAuthorizedNoraContext({ type: "policy", id: "foreign-policy" }, "agent-1"),
    ).resolves.toBeNull();
    await expect(
      resolveAuthorizedNoraContext({ type: "policy", id: "missing-policy" }, "agent-1"),
    ).resolves.toBeNull();

    expect(findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          AND: [
            { id: "foreign-policy" },
            { client: { portfolioOwnerId: "agent-1" } },
          ],
        },
      }),
    );
  });

  it("allows an administrator scope to resolve a valid context without a portfolio filter", async () => {
    findFirst.mockResolvedValue({ id: "client-1", fullName: "Cliente Admin" });

    await expect(resolveAuthorizedNoraContext({ type: "client", id: "client-1" })).resolves.toEqual({
      type: "client",
      id: "client-1",
      label: "Cliente Admin",
    });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ id: "client-1" }, {}] },
      }),
    );
  });
});
