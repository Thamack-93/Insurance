import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  clientOperationalWhere,
  claimOperationalWhere,
  documentOperationalWhere,
  policyOperationalWhere,
  quoteOperationalWhere,
  receiptOperationalWhere,
  workItemOperationalWhere,
} from "@/lib/portfolio-access";

describe("portfolio access helpers", () => {
  it("builds tenant-scoped predicates for the common entity types", () => {
    expect(clientOperationalWhere("agent-1", "org-a")).toEqual({ organizationId: "org-a", portfolioOwnerId: "agent-1" });
    const relatedScope = {
      organizationId: "org-a",
      client: { organizationId: "org-a", portfolioOwnerId: "agent-1" },
    };
    expect(policyOperationalWhere("agent-1", "org-a")).toEqual(relatedScope);
    expect(receiptOperationalWhere("agent-1", "org-a")).toEqual(relatedScope);
    expect(claimOperationalWhere("agent-1", "org-a")).toEqual(relatedScope);
    expect(quoteOperationalWhere("agent-1", "org-a")).toEqual(relatedScope);
    expect(workItemOperationalWhere("agent-1", "org-a")).toEqual({
      organizationId: "org-a",
      OR: [{ client: { portfolioOwnerId: "agent-1" } }, { clientId: null, assignedToId: "agent-1" }],
    });
    expect(documentOperationalWhere("agent-1", "org-a")).toEqual({
      organizationId: "org-a",
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

  it("keeps administrators scoped to their organization", () => {
    expect(clientOperationalWhere(undefined, "org-a")).toEqual({ organizationId: "org-a" });
    const relatedScope = { organizationId: "org-a", client: { organizationId: "org-a" } };
    expect(policyOperationalWhere(undefined, "org-a")).toEqual(relatedScope);
    expect(receiptOperationalWhere(undefined, "org-a")).toEqual(relatedScope);
    expect(claimOperationalWhere(undefined, "org-a")).toEqual(relatedScope);
    expect(quoteOperationalWhere(undefined, "org-a")).toEqual(relatedScope);
    expect(documentOperationalWhere(undefined, "org-a")).toEqual({ organizationId: "org-a" });
    expect(workItemOperationalWhere(undefined, "org-a")).toEqual({ organizationId: "org-a" });
  });
});
