import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireOrganizationContextOrRedirect = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...actual, requireOrganizationContextOrRedirect };
});

import { requireOrganizationPortfolioReadScopeOrRedirect } from "@/lib/portfolio-access";

describe("portfolio read redirect helper", () => {
  it("delegates tenant failures to the canonical redirect helper", async () => {
    const context = {
      userId: "user-1",
      userEmail: "agent@example.com",
      userName: "Agent",
      userRole: "AGENT",
      platformRole: "NONE",
      organizationId: "org-a",
      organizationName: "Org A",
      organizationSlug: "org-a",
      organizationStatus: "ACTIVE",
      membershipId: "membership-1",
      membershipRole: "AGENT" as const,
    };
    requireOrganizationContextOrRedirect.mockResolvedValue(context);

    await expect(requireOrganizationPortfolioReadScopeOrRedirect()).resolves.toMatchObject({
      id: "user-1",
      role: "AGENT",
      portfolioOwnerId: "user-1",
      organizationId: "org-a",
      context,
    });
    expect(requireOrganizationContextOrRedirect).toHaveBeenCalledOnce();
  });
});
