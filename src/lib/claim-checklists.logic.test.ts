import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const claimOperationalWhere = vi.hoisted(() => vi.fn());
vi.mock("@/lib/portfolio-access", () => ({ claimOperationalWhere }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));

import { getClaimChecklistSummary, updateClaimChecklistStatus, checklistTimestamps, createCustomClaimRequirementCode } from "@/lib/claim-checklists";
import { isClaimChecklistPending, CLAIM_CHECKLIST_STATUS_LABELS } from "@/lib/claim-checklist-values";

describe("claim checklist metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    claimOperationalWhere.mockReturnValue({ ownerId: "agent-1" });
  });

  it("defines pending states and Spanish presentation labels", () => {
    expect(isClaimChecklistPending("MISSING")).toBe(true);
    expect(isClaimChecklistPending("REQUESTED")).toBe(true);
    expect(isClaimChecklistPending("RECEIVED")).toBe(false);
    expect(CLAIM_CHECKLIST_STATUS_LABELS.WAIVED).toBe("No aplica");
  });

  it("keeps only the timestamp represented by the new state", () => {
    const now = new Date("2026-09-08T12:00:00.000Z");
    expect(checklistTimestamps("REQUESTED", now)).toEqual({ requestedAt: now, receivedAt: null, waivedAt: null });
    expect(checklistTimestamps("RECEIVED", now)).toEqual({ requestedAt: null, receivedAt: now, waivedAt: null });
    expect(checklistTimestamps("MISSING", now)).toEqual({ requestedAt: null, receivedAt: null, waivedAt: null });
  });

  it("generates an internal custom code", () => {
    expect(createCustomClaimRequirementCode()).toMatch(/^CUSTOM:[0-9a-f-]{36}$/);
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

    const result = await getClaimChecklistSummary("claim-1", "org-a", "agent-1", client as never);

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
    }, "org-a", "agent-1", client as never);

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
    }, "org-a", "agent-1", client as never);

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

  it("does not rewrite or audit a repeated status", async () => {
    const client = {
      claim: { findFirst: vi.fn().mockResolvedValue({ id: "claim-1", status: "OPEN", policy: { policyType: "AUTO" } }) },
      claimChecklistItem: {
        findUnique: vi.fn().mockResolvedValue({ id: "item-1", status: "RECEIVED", updatedAt: new Date() }),
        upsert: vi.fn(),
      },
    };
    const result = await updateClaimChecklistStatus({ claimId: "claim-1", requirementCode: "adjuster_evidence", status: "RECEIVED" }, "org-a", "agent-1", client as never);
    expect(result?.id).toBe("item-1");
    expect(client.claimChecklistItem.upsert).not.toHaveBeenCalled();
  });
});
