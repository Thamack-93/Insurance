export type CommissionReviewStatus = "ACTIONABLE" | "PENDING_UNPAID" | "CANCELLED_UNPAID";

export type CommissionReviewCandidateInput = {
  receiptId: string;
  receiptNumber: string;
  policyId: string;
  policyNumber: string;
  clientName: string;
  insurerName: string;
  amount: number;
  currency: string;
  reason: string | null;
  calculationStatus: string;
  receiptStatus: string;
  postedPaymentCount: number;
  updatedAt: Date;
};

export type CommissionReviewPolicyGroup = {
  policyId: string;
  policyNumber: string;
  clientName: string;
  insurerName: string;
  receipts: CommissionReviewCandidateInput[];
};

export function classifyCommissionReviewCandidate(candidate: Pick<CommissionReviewCandidateInput, "receiptStatus" | "postedPaymentCount">): CommissionReviewStatus | null {
  if (candidate.postedPaymentCount > 0) return "ACTIONABLE";
  if (candidate.receiptStatus === "CANCELLED") return "CANCELLED_UNPAID";
  if (candidate.receiptStatus === "PENDING") return "PENDING_UNPAID";
  return null;
}

export function groupCommissionReviewsByPolicy(candidates: CommissionReviewCandidateInput[]): CommissionReviewPolicyGroup[] {
  const groups = new Map<string, CommissionReviewPolicyGroup>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.policyId) ?? {
      policyId: candidate.policyId,
      policyNumber: candidate.policyNumber,
      clientName: candidate.clientName,
      insurerName: candidate.insurerName,
      receipts: [],
    };
    group.receipts.push(candidate);
    groups.set(candidate.policyId, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      receipts: [...group.receipts].sort((left, right) => left.receiptNumber.localeCompare(right.receiptNumber)),
    }))
    .sort((left, right) => left.policyNumber.localeCompare(right.policyNumber));
}

export function isMissingCommissionPremiumInformation(reason: string | null | undefined) {
  if (!reason) return false;
  return /prima total|prima neta|componentes para derivar la prima|desglose de prima|desglose por riesgo|prima por unidad/i.test(reason);
}
