import { createHash } from "node:crypto";
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
  outcome: "APPLIED" | "ALREADY_APPLIED" | "DEFERRED" | "EMPTY";
};

export type PolicyRiskInventoryOutcomeReport = {
  organizationId: string;
  manifestSha256: string;
  outcomes: PolicyRiskInventoryOutcome[];
};

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
  if (!Array.isArray(report.outcomes) || typeof report.organizationId !== "string" || typeof report.manifestSha256 !== "string") {
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
}) {
  const { organizationId, policies, outcomeReport, expectedManifestSha256 } = input;
  if (new Set(policies.map((row) => row.policyId)).size !== policies.length) throw new Error("POLICY_RISK_INVENTORY_DUPLICATE_POLICY_ID");
  if (outcomeReport && outcomeReport.organizationId !== organizationId) throw new Error("POLICY_RISK_INVENTORY_OUTCOME_ORGANIZATION_MISMATCH");
  if (outcomeReport && (!expectedManifestSha256 || outcomeReport.manifestSha256 !== expectedManifestSha256)) throw new Error("POLICY_RISK_INVENTORY_OUTCOME_MANIFEST_MISMATCH");
  const outcomes = outcomeReport?.outcomes ?? [];
  if (outcomes.some((row) => !row.policyId || !["APPLIED", "ALREADY_APPLIED", "DEFERRED", "EMPTY"].includes(row.outcome))) {
    throw new Error("POLICY_RISK_INVENTORY_OUTCOME_INVALID");
  }
  if (new Set(outcomes.map((row) => row.policyId)).size !== outcomes.length) throw new Error("POLICY_RISK_INVENTORY_DUPLICATE_OUTCOME_POLICY_ID");
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
