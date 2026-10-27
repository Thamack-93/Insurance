export type BonusApprovalBlockReason = "APPROVED" | "EMPTY" | "NOT_READY";

export function bonusApprovalBlockReason(status: string, itemStatuses: readonly string[]): BonusApprovalBlockReason | null {
  if (status === "APPROVED") return "APPROVED";
  if (itemStatuses.length === 0) return "EMPTY";
  if (status !== "READY" || itemStatuses.includes("REVIEW")) return "NOT_READY";
  return null;
}

export type BonusRunActionState = { code: "STALE_VERSION" } | null;

export const STALE_BONUS_RUN_ACTION_STATE: BonusRunActionState = { code: "STALE_VERSION" };
