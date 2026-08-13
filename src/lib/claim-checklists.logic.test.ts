import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const claimOperationalWhere = vi.hoisted(() => vi.fn());
vi.mock("@/lib/portfolio-access", () => ({ claimOperationalWhere }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

import { getClaimChecklistSummary, updateClaimChecklistStatus } from "@/lib/claim-checklists";

describe("claim checklist metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    claimOperationalWhere.mockReturnValue({ ownerId: "agent-1" });
  });

  it("merges the GMM template without creating records during a read", async () => {
    const client = {
      claim: {
        findFirst: vi.fn().mockResolvedValue({
          id: "claim-1",
          folio: "SIN-001",
          status: "OPEN",
          policy: { policyType: "GMM", policyNumber: "GMM-001" },
          checklistItems: [{
            requirementCode: "medical_report_metadata",
            label: "Stored label",
            status: "RECEIVED",
            requestedAt: null,
            receivedAt: new Date("2026-08-12T12:00:00.000Z"),
            waivedAt: null,
            documentId: "document-1",
          }],
        }),
      },
      claimChecklistItem: { upsert: vi.fn() },
    };

    const result = await getClaimChecklistSummary("claim-1", "agent-1", client as never);

    expect(client.claim.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: [{ id: "claim-1" }, { ownerId: "agent-1" }] },
    }));
    expect(result?.items.find((item) => item.code === "medical_report_metadata")).toEqual(expect.objectContaining({
      status: "RECEIVED",
      receivedAt: "2026-08-12T12:00:00.000Z",
      documentLinked: true,
    }));
    expect(result?.counts.RECEIVED).toBe(1);
    expect(client.claimChecklistItem.upsert).not.toHaveBeenCalled();
  });

  it("rejects unknown requirements without writing", async () => {
    const client = {
      claim: { findFirst: vi.fn().mockResolvedValue({ id: "claim-1", policy: { policyType: "AUTO" } }) },
      claimChecklistItem: { upsert: vi.fn() },
    };

    const result = await updateClaimChecklistStatus({
      claimId: "claim-1",
      requirementCode: "invented_by_model",
      status: "RECEIVED",
    }, "agent-1", client as never);

    expect(result).toBeNull();
    expect(client.claimChecklistItem.upsert).not.toHaveBeenCalled();
  });

  it("stores only operational status metadata for a valid requirement", async () => {
    const client = {
      claim: { findFirst: vi.fn().mockResolvedValue({ id: "claim-1", policy: { policyType: "AUTO" } }) },
      claimChecklistItem: { upsert: vi.fn().mockResolvedValue({ id: "item-1" }) },
    };

    await updateClaimChecklistStatus({
      claimId: "claim-1",
      requirementCode: "adjuster_evidence",
      status: "REQUESTED",
    }, "agent-1", client as never);

    expect(client.claimChecklistItem.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        claimId: "claim-1",
        requirementCode: "adjuster_evidence",
        status: "REQUESTED",
        requestedAt: expect.any(Date),
        receivedAt: null,
        waivedAt: null,
      }),
      update: expect.objectContaining({
        status: "REQUESTED",
        requestedAt: expect.any(Date),
      }),
    }));
    const serialized = JSON.stringify(client.claimChecklistItem.upsert.mock.calls[0]);
    expect(serialized).not.toContain("diagnosis");
    expect(serialized).not.toContain("notes");
    expect(serialized).not.toContain("content");
  });
});
