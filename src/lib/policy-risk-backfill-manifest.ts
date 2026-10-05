import { createHash } from "node:crypto";

export const POLICY_RISK_BACKFILL_MANIFEST_VERSION = 1 as const;
export const POLICY_RISK_BACKFILL_PROCESSOR_VERSION = "2026-10-05.1" as const;

export type PolicyRiskBackfillDecision = "ACCEPT" | "DEFER";
export type PolicyRiskBackfillClassification = "CONVERTED" | "REVIEW" | "EMPTY";

export type PolicyRiskBackfillManifestRow = {
  policyId: string;
  policyNumber: string;
  policyType: string;
  inputHash: string;
  classification: PolicyRiskBackfillClassification;
  reason: string | null;
  source: {
    insuredObject: string | null;
    beneficiaryInfo: string | null;
    assets: Array<{ description: string; serialNumber: string | null; isPrimary: boolean }>;
    insuredParties: Array<{ fullName: string }>;
  };
  proposed: {
    riskDetails: unknown;
    insuredObject: string | null;
    assets: Array<{ assetType: string; description: string; serialNumber: string | null; isPrimary: boolean }>;
    insuredParties: Array<{ fullName: string; isPrimary: boolean; sourceLabel: string }>;
  };
  decision: PolicyRiskBackfillDecision | null;
};

export type PolicyRiskBackfillManifest = {
  schemaVersion: typeof POLICY_RISK_BACKFILL_MANIFEST_VERSION;
  processorVersion: typeof POLICY_RISK_BACKFILL_PROCESSOR_VERSION;
  processorSha256: string;
  runId: string;
  createdAt: string;
  organizationId: string;
  candidateSha: string;
  scanned: number;
  candidates: PolicyRiskBackfillManifestRow[];
  contentSha256: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function policyRiskBackfillInputHash(input: unknown): string {
  return createHash("sha256").update(stable(input)).digest("hex");
}

export function policyRiskBackfillManifestContentHash(manifest: PolicyRiskBackfillManifest): string {
  const immutable = {
    schemaVersion: manifest.schemaVersion,
    processorVersion: manifest.processorVersion,
    processorSha256: manifest.processorSha256,
    runId: manifest.runId,
    createdAt: manifest.createdAt,
    organizationId: manifest.organizationId,
    candidateSha: manifest.candidateSha,
    scanned: manifest.scanned,
    candidates: manifest.candidates.map((row) => ({
      policyId: row.policyId,
      policyNumber: row.policyNumber,
      policyType: row.policyType,
      inputHash: row.inputHash,
      classification: row.classification,
      reason: row.reason,
      source: row.source,
      proposed: row.proposed,
    })),
  };
  return createHash("sha256").update(stable(immutable)).digest("hex");
}

export function policyRiskBackfillReviewedHash(manifest: PolicyRiskBackfillManifest): string {
  return createHash("sha256").update(stable({
    contentSha256: manifest.contentSha256,
    reviewedBy: manifest.reviewedBy?.trim() ?? null,
    reviewedAt: manifest.reviewedAt,
    decisions: manifest.candidates.map((row) => ({ policyId: row.policyId, decision: row.decision })),
  })).digest("hex");
}

export function assertReviewedPolicyRiskBackfillManifest(
  manifest: PolicyRiskBackfillManifest,
  expected: { organizationId: string; candidateSha: string; processorSha256: string },
): void {
  if (manifest.schemaVersion !== POLICY_RISK_BACKFILL_MANIFEST_VERSION) throw new Error("POLICY_RISK_BACKFILL_MANIFEST_VERSION_MISMATCH");
  if (manifest.processorVersion !== POLICY_RISK_BACKFILL_PROCESSOR_VERSION) throw new Error("POLICY_RISK_BACKFILL_PROCESSOR_VERSION_MISMATCH");
  if (manifest.processorSha256 !== expected.processorSha256) throw new Error("POLICY_RISK_BACKFILL_PROCESSOR_SHA_MISMATCH");
  if (manifest.organizationId !== expected.organizationId) throw new Error("POLICY_RISK_BACKFILL_ORGANIZATION_MISMATCH");
  if (manifest.candidateSha !== expected.candidateSha) throw new Error("POLICY_RISK_BACKFILL_CANDIDATE_SHA_MISMATCH");
  if (!manifest.runId || !manifest.createdAt || !Array.isArray(manifest.candidates) || manifest.scanned !== manifest.candidates.length) {
    throw new Error("POLICY_RISK_BACKFILL_MANIFEST_INCOMPLETE");
  }
  if (!manifest.contentSha256 || policyRiskBackfillManifestContentHash(manifest) !== manifest.contentSha256) {
    throw new Error("POLICY_RISK_BACKFILL_MANIFEST_CONTENT_HASH_MISMATCH");
  }
  if (new Set(manifest.candidates.map((row) => row.policyId)).size !== manifest.candidates.length) {
    throw new Error("POLICY_RISK_BACKFILL_DUPLICATE_POLICY");
  }
  if (!manifest.reviewedBy?.trim() || !manifest.reviewedAt || Number.isNaN(Date.parse(manifest.reviewedAt))) {
    throw new Error("POLICY_RISK_BACKFILL_REVIEWER_REQUIRED");
  }
  for (const row of manifest.candidates) {
    if (!row.policyId || !row.inputHash || !row.policyNumber || !row.policyType) throw new Error("POLICY_RISK_BACKFILL_MANIFEST_ROW_INCOMPLETE");
    if (row.classification !== "CONVERTED" && row.classification !== "REVIEW" && row.classification !== "EMPTY") {
      throw new Error(`POLICY_RISK_BACKFILL_CLASSIFICATION_INVALID:${row.policyId}`);
    }
    if (row.decision !== null && row.decision !== "ACCEPT" && row.decision !== "DEFER") {
      throw new Error(`POLICY_RISK_BACKFILL_DECISION_INVALID:${row.policyId}`);
    }
    if (row.classification === "REVIEW" && row.decision !== "ACCEPT" && row.decision !== "DEFER") {
      throw new Error(`POLICY_RISK_BACKFILL_REVIEW_DECISION_REQUIRED:${row.policyId}`);
    }
    if (row.classification !== "REVIEW" && row.decision !== null) throw new Error(`POLICY_RISK_BACKFILL_UNEXPECTED_REVIEW_DECISION:${row.policyId}`);
  }
}
