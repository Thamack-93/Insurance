import { createHash } from "node:crypto";
import { policyRiskBackfillInputHash } from "@/lib/policy-risk-backfill-manifest";
import { hasPolicyRiskData, policyRiskDetailsSchema } from "@/lib/policy-risk-details";

export type PolicyRiskInventoryInput = {
  policyId: string;
  policyNumber: string;
  policyType: string;
  status: string;
  portfolioOwnerId: string | null;
  riskDetails: unknown;
  riskDetailsReviewRequired: boolean;
  insuredObject: string | null;
  beneficiaryInfo: string | null;
  assets: Array<{ description: string }>;
  insuredParties: Array<{ fullName: string }>;
};

export type PolicyRiskInventoryOutcome = {
  policyId: string;
  inputHash: string;
  outcome: "APPLIED" | "ALREADY_APPLIED" | "DEFERRED" | "EMPTY";
};

export type PolicyRiskInventoryOutcomeReport = {
  organizationId: string;
  candidateSha: string;
  runId: string;
  manifestSha256: string;
  reviewedManifestSha256: string;
  maintenanceRunId: string;
  status: "COMPLETED" | "REVIEW_REQUIRED";
  outcomes: PolicyRiskInventoryOutcome[];
};

export type PolicyRiskInventoryMaintenanceRun = {
  id: string;
  organizationId: string;
  type: string;
  status: string;
  summaryJson: string | null;
};

export function assertPolicyRiskInventoryOutcomeRun(input: {
  report: PolicyRiskInventoryOutcomeReport;
  run: PolicyRiskInventoryMaintenanceRun | null;
  organizationId: string;
  expectedCandidateSha: string;
}) {
  const { report, run, organizationId, expectedCandidateSha } = input;
  if (report.organizationId !== organizationId) throw new Error("POLICY_RISK_INVENTORY_OUTCOME_ORGANIZATION_MISMATCH");
  if (report.candidateSha !== expectedCandidateSha) throw new Error("POLICY_RISK_INVENTORY_OUTCOME_CANDIDATE_SHA_MISMATCH");
  if (!report.runId || !report.maintenanceRunId || !report.reviewedManifestSha256 || !["COMPLETED", "REVIEW_REQUIRED"].includes(report.status)) {
    throw new Error("POLICY_RISK_INVENTORY_OUTCOME_RUN_METADATA_INVALID");
  }
  if (!run || run.id !== report.maintenanceRunId || run.organizationId !== organizationId || run.type !== "POLICY_RISK_BACKFILL" || run.status !== report.status || !run.summaryJson) {
    throw new Error("POLICY_RISK_INVENTORY_OUTCOME_MAINTENANCE_RUN_MISMATCH");
  }
  let summary: unknown;
  try {
    summary = JSON.parse(run.summaryJson);
  } catch {
    throw new Error("POLICY_RISK_INVENTORY_OUTCOME_MAINTENANCE_RUN_MISMATCH");
  }
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) throw new Error("POLICY_RISK_INVENTORY_OUTCOME_MAINTENANCE_RUN_MISMATCH");
  const values = summary as Record<string, unknown>;
  if (values.organizationId !== organizationId || values.candidateSha !== expectedCandidateSha || values.runId !== report.runId || values.manifestSha256 !== report.manifestSha256 || values.reviewedManifestSha256 !== report.reviewedManifestSha256 || values.outcomesSha256 !== policyRiskBackfillInputHash(report.outcomes)) {
    throw new Error("POLICY_RISK_INVENTORY_OUTCOME_MAINTENANCE_RUN_MISMATCH");
  }
}

export function parseVerifiedPolicyRiskInventoryOutcomeReport(bytes: Uint8Array, expectedFileSha256: string) {
  const fileSha256 = createHash("sha256").update(bytes).digest("hex");
  if (!/^[a-f0-9]{64}$/.test(expectedFileSha256) || fileSha256 !== expectedFileSha256) {
    throw new Error("POLICY_RISK_INVENTORY_OUTCOME_FILE_SHA256_MISMATCH");
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("POLICY_RISK_INVENTORY_OUTCOME_REPORT_INVALID");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("POLICY_RISK_INVENTORY_OUTCOME_REPORT_INVALID");
  const report = value as Partial<PolicyRiskInventoryOutcomeReport>;
  if (!Array.isArray(report.outcomes) || typeof report.organizationId !== "string" || typeof report.candidateSha !== "string" || typeof report.runId !== "string" || typeof report.manifestSha256 !== "string" || typeof report.reviewedManifestSha256 !== "string" || typeof report.maintenanceRunId !== "string" || typeof report.status !== "string") {
    throw new Error("POLICY_RISK_INVENTORY_OUTCOME_REPORT_INVALID");
  }
  return { report: report as PolicyRiskInventoryOutcomeReport, fileSha256 };
}

export type PolicyRiskInventoryDisposition = "APPLIED" | "ALREADY_STRUCTURED" | "DEFERRED" | "PENDING";

export type PolicyRiskInventoryRow = Omit<PolicyRiskInventoryInput, "assets" | "insuredParties" | "riskDetails" | "insuredObject" | "beneficiaryInfo"> & {
  disposition: PolicyRiskInventoryDisposition;
  reason: string;
  linkedManifestSha256: string | null;
};

export type PolicyRiskInventoryCount = Record<PolicyRiskInventoryDisposition, number> & { total: number };

function emptyCount(): PolicyRiskInventoryCount {
  return { total: 0, APPLIED: 0, ALREADY_STRUCTURED: 0, DEFERRED: 0, PENDING: 0 };
}

function hasSource(row: PolicyRiskInventoryInput) {
  return Boolean(row.insuredObject?.trim() || row.beneficiaryInfo?.trim() || row.assets.some((asset) => asset.description.trim()) || row.insuredParties.some((party) => party.fullName.trim()));
}

function classify(row: PolicyRiskInventoryInput, outcome?: PolicyRiskInventoryOutcome): Pick<PolicyRiskInventoryRow, "disposition" | "reason"> {
  if (outcome && outcome.outcome !== "APPLIED" && outcome.outcome !== "ALREADY_APPLIED") {
    const existingData = row.riskDetails != null ? "_WITH_EXISTING_RISK_DETAILS" : "";
    return {
      disposition: "DEFERRED",
      reason: `LINKED_APPLY_OUTCOME_${outcome.outcome}${existingData}`,
    };
  }

  if (row.riskDetails != null) {
    const parsed = policyRiskDetailsSchema.safeParse(row.riskDetails);
    if (!parsed.success) return { disposition: "DEFERRED", reason: "EXISTING_RISK_DETAILS_MALFORMED" };
    if (parsed.data.policyType !== row.policyType) return { disposition: "DEFERRED", reason: "EXISTING_RISK_DETAILS_POLICY_TYPE_MISMATCH" };
    if (row.riskDetailsReviewRequired) return { disposition: "DEFERRED", reason: "EXISTING_RISK_DETAILS_REVIEW_REQUIRED" };
    if (!hasPolicyRiskData(parsed.data)) return { disposition: "DEFERRED", reason: "EXISTING_RISK_DETAILS_NO_MEANINGFUL_DATA" };
    if (outcome?.outcome === "APPLIED" || outcome?.outcome === "ALREADY_APPLIED") return { disposition: "APPLIED", reason: `LINKED_APPLY_OUTCOME_${outcome.outcome}` };
    return { disposition: "ALREADY_STRUCTURED", reason: "RECOGNIZED_STRUCTURED_DATA_OPTIONAL_FIELDS_NOT_VERIFIED" };
  }

  if (!hasSource(row)) return { disposition: "DEFERRED", reason: "NO_USABLE_LEGACY_SOURCE" };
  if (!outcome) return { disposition: "PENDING", reason: "NO_LINKED_APPLY_OUTCOME" };
  if (outcome.outcome === "APPLIED" || outcome.outcome === "ALREADY_APPLIED") return { disposition: "DEFERRED", reason: "APPLY_OUTCOME_CONFLICTS_WITH_NULL_RISK_DETAILS" };
  if (outcome.outcome === "DEFERRED") return { disposition: "DEFERRED", reason: "LINKED_APPLY_OUTCOME_DEFERRED" };
  return { disposition: "DEFERRED", reason: "LINKED_APPLY_OUTCOME_EMPTY" };
}

export function reconcilePolicyRiskInventory(input: {
  organizationId: string;
  policies: PolicyRiskInventoryInput[];
  outcomeReport?: PolicyRiskInventoryOutcomeReport;
  expectedManifestSha256?: string;
  expectedCandidateSha?: string;
  expectedInputHashes?: Record<string, string>;
}) {
  const { organizationId, policies, outcomeReport, expectedManifestSha256, expectedCandidateSha, expectedInputHashes } = input;
  if (new Set(policies.map((row) => row.policyId)).size !== policies.length) throw new Error("POLICY_RISK_INVENTORY_DUPLICATE_POLICY_ID");
  if (outcomeReport && outcomeReport.organizationId !== organizationId) throw new Error("POLICY_RISK_INVENTORY_OUTCOME_ORGANIZATION_MISMATCH");
  if (outcomeReport && (!expectedManifestSha256 || outcomeReport.manifestSha256 !== expectedManifestSha256)) throw new Error("POLICY_RISK_INVENTORY_OUTCOME_MANIFEST_MISMATCH");
  if (outcomeReport && (!expectedCandidateSha || outcomeReport.candidateSha !== expectedCandidateSha)) throw new Error("POLICY_RISK_INVENTORY_OUTCOME_CANDIDATE_SHA_MISMATCH");
  if (outcomeReport && !expectedInputHashes) throw new Error("POLICY_RISK_INVENTORY_OUTCOME_MANIFEST_INPUT_HASHES_REQUIRED");
  const outcomes = outcomeReport?.outcomes ?? [];
  if (outcomes.some((row) => !row.policyId || !/^[a-f0-9]{64}$/.test(row.inputHash) || !["APPLIED", "ALREADY_APPLIED", "DEFERRED", "EMPTY"].includes(row.outcome))) {
    throw new Error("POLICY_RISK_INVENTORY_OUTCOME_INVALID");
  }
  if (new Set(outcomes.map((row) => row.policyId)).size !== outcomes.length) throw new Error("POLICY_RISK_INVENTORY_DUPLICATE_OUTCOME_POLICY_ID");
  if (outcomeReport && outcomes.length !== Object.keys(expectedInputHashes!).length) throw new Error("POLICY_RISK_INVENTORY_OUTCOME_MANIFEST_CANDIDATE_MISMATCH");
  if (outcomeReport && outcomes.some((row) => expectedInputHashes![row.policyId] !== row.inputHash)) throw new Error("POLICY_RISK_INVENTORY_OUTCOME_INPUT_HASH_MISMATCH");
  const outcomeById = new Map(outcomes.map((row) => [row.policyId, row]));
  if (outcomes.some((row) => !policies.some((policy) => policy.policyId === row.policyId))) throw new Error("POLICY_RISK_INVENTORY_OUTCOME_POLICY_NOT_IN_ORGANIZATION");

  const rows = policies.map((policy): PolicyRiskInventoryRow => {
    const outcome = outcomeById.get(policy.policyId);
    const classification = classify(policy, outcome);
    return {
      policyId: policy.policyId,
      policyNumber: policy.policyNumber,
      policyType: policy.policyType,
      status: policy.status,
      portfolioOwnerId: policy.portfolioOwnerId,
      riskDetailsReviewRequired: policy.riskDetailsReviewRequired,
      disposition: classification.disposition,
      reason: classification.reason,
      linkedManifestSha256: outcomeReport && outcome ? outcomeReport.manifestSha256 : null,
    };
  });

  const totals = emptyCount();
  const byPolicyType: Record<string, PolicyRiskInventoryCount> = {};
  const byStatus: Record<string, PolicyRiskInventoryCount> = {};
  const byPortfolioOwnerId: Record<string, PolicyRiskInventoryCount> = {};
  const add = (count: PolicyRiskInventoryCount, disposition: PolicyRiskInventoryDisposition) => {
    count.total += 1;
    count[disposition] += 1;
  };
  for (const row of rows) {
    add(totals, row.disposition);
    add(byPolicyType[row.policyType] ??= emptyCount(), row.disposition);
    add(byStatus[row.status] ??= emptyCount(), row.disposition);
    add(byPortfolioOwnerId[row.portfolioOwnerId ?? "UNASSIGNED"] ??= emptyCount(), row.disposition);
  }
  const groupedTotals = [byPolicyType, byStatus, byPortfolioOwnerId];
  if (totals.total !== rows.length || groupedTotals.some((grouping) =>
    Object.values(grouping).reduce((sum, group) => sum + group.total, 0) !== rows.length ||
    Object.values(grouping).some((group) => group.total !== group.APPLIED + group.ALREADY_STRUCTURED + group.DEFERRED + group.PENDING)
  )) {
    throw new Error("POLICY_RISK_INVENTORY_TOTAL_RECONCILIATION_FAILED");
  }
  return { organizationId, totalPolicies: rows.length, totals, byPolicyType, byStatus, byPortfolioOwnerId, policies: rows };
}
