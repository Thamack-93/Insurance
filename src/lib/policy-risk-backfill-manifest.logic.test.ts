import { describe, expect, it } from "vitest";
import {
  assertReviewedPolicyRiskBackfillManifest,
  POLICY_RISK_BACKFILL_MANIFEST_VERSION,
  POLICY_RISK_BACKFILL_PROCESSOR_VERSION,
  policyRiskBackfillManifestContentHash,
  type PolicyRiskBackfillManifest,
} from "@/lib/policy-risk-backfill-manifest";

function manifest(): PolicyRiskBackfillManifest {
  const result: PolicyRiskBackfillManifest = {
    schemaVersion: POLICY_RISK_BACKFILL_MANIFEST_VERSION,
    processorVersion: POLICY_RISK_BACKFILL_PROCESSOR_VERSION,
    processorSha256: "processor-1",
    runId: "run-1",
    createdAt: "2026-10-05T12:00:00.000Z",
    organizationId: "org-1",
    candidateSha: "abc123",
    scanned: 1,
    candidates: [{
      policyId: "policy-1",
      policyNumber: "P-1",
      policyType: "AUTO",
      inputHash: "hash-1",
      classification: "REVIEW",
      reason: "needs review",
      source: { insuredObject: "old text", beneficiaryInfo: null, assets: [], insuredParties: [] },
      proposed: { riskDetails: { version: 1 }, insuredObject: null, assets: [], insuredParties: [] },
      decision: null,
    }],
    contentSha256: "",
    reviewedBy: "reviewer@example.test",
    reviewedAt: "2026-10-05T12:30:00.000Z",
  };
  result.contentSha256 = policyRiskBackfillManifestContentHash(result);
  return result;
}

describe("policy risk backfill reviewed manifest", () => {
  it("requires an explicit decision for every ambiguous policy", () => {
    const value = manifest();
    expect(() => assertReviewedPolicyRiskBackfillManifest(value, { organizationId: "org-1", candidateSha: "abc123", processorSha256: "processor-1" }))
      .toThrow("POLICY_RISK_BACKFILL_REVIEW_DECISION_REQUIRED:policy-1");
    value.candidates[0].decision = "ACCEPT";
    expect(() => assertReviewedPolicyRiskBackfillManifest(value, { organizationId: "org-1", candidateSha: "abc123", processorSha256: "processor-1" })).not.toThrow();
  });

  it("rejects a changed proposal after the preview digest was issued", () => {
    const value = manifest();
    value.candidates[0].decision = "ACCEPT";
    value.candidates[0].proposed.riskDetails = { version: 1, tampered: true };
    expect(() => assertReviewedPolicyRiskBackfillManifest(value, { organizationId: "org-1", candidateSha: "abc123", processorSha256: "processor-1" }))
      .toThrow("POLICY_RISK_BACKFILL_MANIFEST_CONTENT_HASH_MISMATCH");
  });

  it("rejects another organization or candidate SHA", () => {
    const value = manifest();
    value.candidates[0].decision = "DEFER";
    expect(() => assertReviewedPolicyRiskBackfillManifest(value, { organizationId: "other-org", candidateSha: "abc123", processorSha256: "processor-1" }))
      .toThrow("POLICY_RISK_BACKFILL_ORGANIZATION_MISMATCH");
    expect(() => assertReviewedPolicyRiskBackfillManifest(value, { organizationId: "org-1", candidateSha: "other-sha", processorSha256: "processor-1" }))
      .toThrow("POLICY_RISK_BACKFILL_CANDIDATE_SHA_MISMATCH");
  });
});
