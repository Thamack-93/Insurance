import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AuthError } from "@/lib/auth";
import { assertSameOrganization, organizationClientWhere, portfolioOwnerIdForContext, type OrganizationContext } from "@/lib/organization-context";

const context = (role: "OWNER" | "ADMIN" | "AGENT"): OrganizationContext => ({
  userId: "user-a", userEmail: "a@example.com", userName: "A", userRole: role === "AGENT" ? "AGENT" : "ADMIN", platformRole: "NONE",
  organizationId: "org-a", organizationName: "Org A", organizationSlug: "org-a", organizationStatus: "ACTIVE", membershipId: "membership-a", membershipRole: role,
});

describe("organization context helpers", () => {
  it("always returns a direct organization predicate", () => {
    expect(organizationClientWhere(context("ADMIN"))).toEqual({ organizationId: "org-a" });
  });
  it("restricts agents to their portfolio owner", () => {
    expect(portfolioOwnerIdForContext(context("AGENT"))).toBe("user-a");
    expect(portfolioOwnerIdForContext(context("OWNER"))).toBeUndefined();
  });
  it("fails closed for a cross-organization relationship", () => {
    expect(() => assertSameOrganization("org-b", context("ADMIN"))).toThrowError(AuthError);
    expect(() => assertSameOrganization("org-a", context("ADMIN"))).not.toThrow();
  });
});
