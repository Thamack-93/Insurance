export type DocumentFollowUpRelations = {
  clientId: string | null;
  policyId: string | null;
  policyClientId: string | null;
  endorsementPolicyId: string | null;
  endorsementClientId: string | null;
  receiptClientId: string | null;
  receiptPolicyId: string | null;
  claimClientId: string | null;
  claimPolicyId: string | null;
};

export function mapDocumentFollowUpContext(document: DocumentFollowUpRelations) {
  const policyId = document.policyId ?? document.endorsementPolicyId ?? document.receiptPolicyId ?? document.claimPolicyId;
  const relatedClientId = document.policyClientId ?? document.endorsementClientId ?? document.receiptClientId ?? document.claimClientId;
  const clientId = document.clientId ?? relatedClientId;

  return { clientId, policyId };
}

export function documentFollowUpHref(taskId: string) {
  return `/tasks/${encodeURIComponent(taskId)}`;
}
