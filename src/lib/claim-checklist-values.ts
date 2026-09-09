export const CLAIM_CHECKLIST_STATUSES = ["MISSING", "REQUESTED", "RECEIVED", "WAIVED"] as const;
export type ClaimChecklistStatusValue = (typeof CLAIM_CHECKLIST_STATUSES)[number];
export const CLAIM_CHECKLIST_STATUS_LABELS: Record<ClaimChecklistStatusValue, string> = {
  MISSING: "Faltante",
  REQUESTED: "Solicitado",
  RECEIVED: "Recibido",
  WAIVED: "No aplica",
};
export function isClaimChecklistPending(status: ClaimChecklistStatusValue | string) {
  return status === "MISSING" || status === "REQUESTED";
}
