import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  clientOperationalWhere,
  claimOperationalWhere,
  documentOperationalWhere,
  getPortfolioOwnerIdForRead,
  policyOperationalWhere,
  quoteOperationalWhere,
  receiptOperationalWhere,
  workItemOperationalWhere,
} from "@/lib/portfolio-access";

describe("portfolio access helpers", () => {
  it("maps non-admin users to their own portfolio and leaves admin global", () => {
    expect(getPortfolioOwnerIdForRead({ id: "agent-1", role: "AGENT" })).toBe("agent-1");
    expect(getPortfolioOwnerIdForRead({ id: "admin-1", role: "ADMIN" })).toBeUndefined();
  });

  it("builds tenant-scoped predicates for the common entity types", () => {
    expect(clientOperationalWhere("agent-1")).toEqual({ portfolioOwnerId: "agent-1" });
    expect(policyOperationalWhere("agent-1")).toEqual({ client: { portfolioOwnerId: "agent-1" } });
    expect(receiptOperationalWhere("agent-1")).toEqual({ client: { portfolioOwnerId: "agent-1" } });
    expect(claimOperationalWhere("agent-1")).toEqual({ client: { portfolioOwnerId: "agent-1" } });
    expect(quoteOperationalWhere("agent-1")).toEqual({ client: { portfolioOwnerId: "agent-1" } });
    expect(workItemOperationalWhere("agent-1")).toEqual({
      OR: [{ client: { portfolioOwnerId: "agent-1" } }, { clientId: null, assignedToId: "agent-1" }],
    });
    expect(documentOperationalWhere("agent-1")).toEqual({
      OR: [
        { client: { portfolioOwnerId: "agent-1" } },
        { policy: { client: { portfolioOwnerId: "agent-1" } } },
        { endorsement: { policy: { client: { portfolioOwnerId: "agent-1" } } } },
        { receipt: { client: { portfolioOwnerId: "agent-1" } } },
        { claim: { client: { portfolioOwnerId: "agent-1" } } },
        { quote: { client: { portfolioOwnerId: "agent-1" } } },
        {
          AND: [
            { createdById: "agent-1" },
            { clientId: null },
            { policyId: null },
            { endorsementId: null },
            { receiptId: null },
            { taskId: null },
            { claimId: null },
            { quoteId: null },
          ],
        },
      ],
    });
  });

  it("returns an empty predicate for admins", () => {
    expect(clientOperationalWhere()).toEqual({});
    expect(policyOperationalWhere()).toEqual({});
    expect(receiptOperationalWhere()).toEqual({});
    expect(claimOperationalWhere()).toEqual({});
    expect(quoteOperationalWhere()).toEqual({});
    expect(documentOperationalWhere()).toEqual({});
    expect(workItemOperationalWhere()).toEqual({});
  });
});
