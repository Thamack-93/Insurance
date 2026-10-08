import { describe, expect, it } from "vitest";
import { reconcilePolicyRiskInventory, type PolicyRiskInventoryInput, type PolicyRiskInventoryOutcomeReport } from "@/lib/policy-risk-inventory-reconciliation";

function policy(overrides: Partial<PolicyRiskInventoryInput> = {}): PolicyRiskInventoryInput {
  return {
    policyId: "p1",
    policyNumber: "P-1",
    policyType: "AUTO",
    status: "ACTIVE",
    portfolioOwnerId: "owner-1",
    riskDetails: null,
    riskDetailsReviewRequired: false,
    insuredObject: "Toyota Corolla 2020",
    beneficiaryInfo: null,
    assets: [],
    insuredParties: [],
    ...overrides,
  };
}

function report(outcomes: PolicyRiskInventoryOutcomeReport["outcomes"], overrides: Partial<PolicyRiskInventoryOutcomeReport> = {}): PolicyRiskInventoryOutcomeReport {
  return { organizationId: "org-1", manifestSha256: "manifest-1", outcomes, ...overrides };
}

describe("whole policy risk inventory reconciliation", () => {
  it("accounts for recognized structured data, pending source rows, and missing-source rows", () => {
    const result = reconcilePolicyRiskInventory({
      organizationId: "org-1",
      policies: [
        policy({ policyId: "structured", riskDetails: { version: 1, policyType: "AUTO", data: { vehicles: [{ make: "Toyota", model: "Corolla", year: "2020", version: "", vin: "", plates: "" }] } } }),
        policy({ policyId: "pending" }),
        policy({ policyId: "no-source", insuredObject: null }),
      ],
    });
    expect(result.totals).toEqual({ total: 3, APPLIED: 0, ALREADY_STRUCTURED: 1, DEFERRED: 1, PENDING: 1 });
    expect(result.policies.map(({ policyId, disposition, reason }) => ({ policyId, disposition, reason }))).toEqual([
      { policyId: "structured", disposition: "ALREADY_STRUCTURED", reason: "RECOGNIZED_STRUCTURED_DATA_OPTIONAL_FIELDS_NOT_VERIFIED" },
      { policyId: "pending", disposition: "PENDING", reason: "NO_LINKED_APPLY_OUTCOME" },
      { policyId: "no-source", disposition: "DEFERRED", reason: "NO_USABLE_LEGACY_SOURCE" },
    ]);
  });

  it("defers malformed, mismatched, empty, and review-required structured values", () => {
    const base = { version: 1, policyType: "AUTO", data: { vehicles: [{ make: "Mazda", model: "3", year: "2022", version: "", vin: "", plates: "" }] } };
    const result = reconcilePolicyRiskInventory({ organizationId: "org-1", policies: [
      policy({ policyId: "malformed", riskDetails: { version: 1 } }),
      policy({ policyId: "mismatch", riskDetails: base, policyType: "HOGAR" }),
      policy({ policyId: "review", riskDetails: base, riskDetailsReviewRequired: true }),
      policy({ policyId: "empty", riskDetails: { version: 1, policyType: "AUTO", data: { vehicles: [] } } }),
    ] });
    expect(result.policies.map((row) => row.reason)).toEqual([
      "EXISTING_RISK_DETAILS_MALFORMED",
      "EXISTING_RISK_DETAILS_POLICY_TYPE_MISMATCH",
      "EXISTING_RISK_DETAILS_REVIEW_REQUIRED",
      "EXISTING_RISK_DETAILS_NO_MEANINGFUL_DATA",
    ]);
    expect(result.totals.DEFERRED).toBe(4);
  });

  it("links apply outcomes by policy id and manifest hash, and flags stale null rows", () => {
    const structured = policy({ policyId: "applied", riskDetails: { version: 1, policyType: "AUTO", data: { vehicles: [{ make: "Mazda", model: "3", year: "2022", version: "", vin: "", plates: "" }] } } });
    const deferred = policy({ policyId: "deferred" });
    const result = reconcilePolicyRiskInventory({
      organizationId: "org-1",
      policies: [structured, deferred],
      outcomeReport: report([{ policyId: "applied", outcome: "APPLIED" }, { policyId: "deferred", outcome: "APPLIED" }]),
      expectedManifestSha256: "manifest-1",
    });
    expect(result.policies.map((row) => [row.disposition, row.reason, row.linkedManifestSha256])).toEqual([
      ["APPLIED", "LINKED_APPLY_OUTCOME_APPLIED", "manifest-1"],
      ["DEFERRED", "APPLY_OUTCOME_CONFLICTS_WITH_NULL_RISK_DETAILS", "manifest-1"],
    ]);
  });

  it("keeps linked deferred and empty outcomes visible when risk details are already present", () => {
    const structuredRiskDetails = { version: 1, policyType: "AUTO", data: { vehicles: [{ make: "Mazda", model: "3", year: "2022", version: "", vin: "", plates: "" }] } };
    const result = reconcilePolicyRiskInventory({
      organizationId: "org-1",
      policies: [
        policy({ policyId: "deferred", riskDetails: structuredRiskDetails }),
        policy({ policyId: "empty", riskDetails: structuredRiskDetails }),
      ],
      outcomeReport: report([
        { policyId: "deferred", outcome: "DEFERRED" },
        { policyId: "empty", outcome: "EMPTY" },
      ]),
      expectedManifestSha256: "manifest-1",
    });

    expect(result.policies.map(({ disposition, reason }) => [disposition, reason])).toEqual([
      ["DEFERRED", "LINKED_APPLY_OUTCOME_DEFERRED_WITH_EXISTING_RISK_DETAILS"],
      ["DEFERRED", "LINKED_APPLY_OUTCOME_EMPTY_WITH_EXISTING_RISK_DETAILS"],
    ]);
    expect(result.totals).toEqual({ total: 2, APPLIED: 0, ALREADY_STRUCTURED: 0, DEFERRED: 2, PENDING: 0 });
  });

  it("rejects cross-organization, unlinked, duplicate, and wrong-manifest outcomes", () => {
    const policies = [policy({ policyId: "p1" })];
    expect(() => reconcilePolicyRiskInventory({ organizationId: "org-1", policies, outcomeReport: report([], { organizationId: "org-2" }), expectedManifestSha256: "manifest-1" })).toThrow("POLICY_RISK_INVENTORY_OUTCOME_ORGANIZATION_MISMATCH");
    expect(() => reconcilePolicyRiskInventory({ organizationId: "org-1", policies, outcomeReport: report([{ policyId: "other", outcome: "APPLIED" }]), expectedManifestSha256: "manifest-1" })).toThrow("POLICY_RISK_INVENTORY_OUTCOME_POLICY_NOT_IN_ORGANIZATION");
    expect(() => reconcilePolicyRiskInventory({ organizationId: "org-1", policies, outcomeReport: report([], { manifestSha256: "wrong" }), expectedManifestSha256: "manifest-1" })).toThrow("POLICY_RISK_INVENTORY_OUTCOME_MANIFEST_MISMATCH");
    expect(() => reconcilePolicyRiskInventory({ organizationId: "org-1", policies: [policies[0], policies[0]] })).toThrow("POLICY_RISK_INVENTORY_DUPLICATE_POLICY_ID");
    expect(() => reconcilePolicyRiskInventory({ organizationId: "org-1", policies, outcomeReport: report([{ policyId: "p1", outcome: "UNKNOWN" } as never]), expectedManifestSha256: "manifest-1" })).toThrow("POLICY_RISK_INVENTORY_OUTCOME_INVALID");
    expect(() => reconcilePolicyRiskInventory({ organizationId: "org-1", policies, outcomeReport: report([{ policyId: "p1", outcome: "EMPTY" }, { policyId: "p1", outcome: "DEFERRED" }]) as never, expectedManifestSha256: "manifest-1" })).toThrow("POLICY_RISK_INVENTORY_DUPLICATE_OUTCOME_POLICY_ID");
  });

  it("reconciles totals independently by policy type, status, and portfolio owner", () => {
    const result = reconcilePolicyRiskInventory({ organizationId: "org-1", policies: [
      policy({ policyId: "p1", policyType: "AUTO", status: "ACTIVE", portfolioOwnerId: "owner-1" }),
      policy({ policyId: "p2", policyType: "HOGAR", status: "CANCELLED", portfolioOwnerId: null, insuredObject: null }),
    ] });
    expect(result.totalPolicies).toBe(2);
    expect(result.byPolicyType.AUTO.total + result.byPolicyType.HOGAR.total).toBe(2);
    expect(result.byStatus.ACTIVE.total + result.byStatus.CANCELLED.total).toBe(2);
    expect(result.byPortfolioOwnerId["owner-1"].total + result.byPortfolioOwnerId.UNASSIGNED.total).toBe(2);
  });
});
