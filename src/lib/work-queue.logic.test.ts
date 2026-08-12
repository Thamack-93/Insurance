import { beforeEach, describe, expect, it, vi } from "vitest";

const getDb = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({ getDb }));

import { getWorkItems } from "@/lib/work-queue";

function legacyRenewal() {
  return {
    id: "work-1",
    sourceType: "Renewal",
    sourceId: "policy-1:2026-07-01",
    workItemType: "TASK",
    taskType: "RENEWAL",
    status: "OPEN",
    priority: "MEDIUM",
    severity: null,
    folio: null,
    title: "Renovación: POL-001",
    description: null,
    entityType: "POLICY",
    entityId: "policy-1",
    clientId: null,
    policyId: null,
    insurerId: null,
    receiptId: null,
    startDate: new Date("2026-06-01T00:00:00.000Z"),
    dueDate: new Date("2026-07-01T00:00:00.000Z"),
    closedDate: null,
    readAt: null,
    notes: null,
    createdById: null,
    updatedById: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    client: null,
    policy: null,
    insurer: null,
    receipt: null,
  };
}

function currentRenewal() {
  const reference = "policy:policy-1:renewal-workItem";
  return {
    ...legacyRenewal(),
    sourceId: reference,
    entityType: "WORKITEM",
    entityId: reference,
  };
}

describe("work queue legacy renewal context", () => {
  const db = {
    workItem: { findMany: vi.fn() },
    policy: { findMany: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getDb.mockReturnValue(db);
  });

  it("resolves historical renewal relations without writing data", async () => {
    db.workItem.findMany.mockResolvedValue([legacyRenewal()]);
    db.policy.findMany.mockResolvedValue([{
      id: "policy-1",
      policyNumber: "POL-001",
      policyType: "Auto",
      status: "ACTIVE",
      startDate: new Date("2025-07-01T00:00:00.000Z"),
      endDate: new Date("2026-07-01T00:00:00.000Z"),
      client: { id: "client-1", fullName: "María García" },
      insurer: { id: "insurer-1", name: "Seguros Atlas" },
    }]);

    const [item] = await getWorkItems({ portfolioOwnerId: "owner-1" });

    expect(item.client).toEqual({ id: "client-1", fullName: "María García" });
    expect(item.policyId).toBe("policy-1");
    expect(item.insurer).toEqual({ id: "insurer-1", name: "Seguros Atlas" });
    expect(item.policy?.endDate).toEqual(new Date("2026-07-01T00:00:00.000Z"));
    expect(db.workItem.findMany).toHaveBeenCalledTimes(1);
    expect(db.policy.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([{ id: { in: ["policy-1"] } }]),
        client: { portfolioOwnerId: "owner-1" },
      }),
    }));
  });

  it("does not resolve a policy outside the authorized portfolio", async () => {
    db.workItem.findMany.mockResolvedValue([legacyRenewal()]);
    db.policy.findMany.mockResolvedValue([]);

    const [item] = await getWorkItems({ portfolioOwnerId: "owner-1" });

    expect(item.client).toBeNull();
    expect(item.policy).toBeNull();
    expect(item.policyId).toBeNull();
  });

  it("resolves the current renewal reference shape", async () => {
    db.workItem.findMany.mockResolvedValue([currentRenewal()]);
    db.policy.findMany.mockResolvedValue([{
      id: "policy-1",
      policyNumber: "POL-001",
      policyType: "Auto",
      status: "ACTIVE",
      startDate: new Date("2025-07-01T00:00:00.000Z"),
      endDate: new Date("2026-07-01T00:00:00.000Z"),
      client: { id: "client-1", fullName: "María García" },
      insurer: { id: "insurer-1", name: "Seguros Atlas" },
    }]);

    const [item] = await getWorkItems({ portfolioOwnerId: "owner-1" });

    expect(item.client?.fullName).toBe("María García");
    expect(item.policyId).toBe("policy-1");
    expect(item.insurer?.name).toBe("Seguros Atlas");
    expect(db.policy.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([{ id: { in: ["policy-1"] } }]),
      }),
    }));
  });

  it("resolves task-backed renewals from the policy number in the title", async () => {
    db.workItem.findMany.mockResolvedValue([{
      ...legacyRenewal(),
      sourceType: "Task",
      sourceId: "task-renewal-1",
      taskType: "RENEWAL",
      entityType: "WorkItem",
      entityId: "task-renewal-1",
      policyId: null,
      clientId: null,
      insurerId: null,
      title: "Renovación: POL-001",
    }]);
    db.policy.findMany.mockResolvedValue([{
      id: "policy-1",
      policyNumber: "POL-001",
      policyType: "Auto",
      status: "ACTIVE",
      startDate: new Date("2025-07-01T00:00:00.000Z"),
      endDate: new Date("2026-07-01T00:00:00.000Z"),
      client: { id: "client-1", fullName: "María García" },
      insurer: { id: "insurer-1", name: "Seguros Atlas" },
    }]);

    const [item] = await getWorkItems({ portfolioOwnerId: "owner-1" });

    expect(item.client?.fullName).toBe("María García");
    expect(item.policy?.policyNumber).toBe("POL-001");
    expect(item.insurer?.name).toBe("Seguros Atlas");
    expect(db.policy.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([{ policyNumber: { in: ["POL-001"] } }]),
        client: { portfolioOwnerId: "owner-1" },
      }),
    }));
  });
});
