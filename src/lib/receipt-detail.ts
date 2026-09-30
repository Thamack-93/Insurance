import { resolveReceiptAuxiliary } from "@/lib/receipts-page";

export const RECEIPT_DETAIL_AUXILIARY_GROUPS = [
  "agent-contact",
  "organization-kind",
  "payments",
  "commissions",
  "documents",
  "related-receipts",
  "activity",
] as const;

export type ReceiptDetailAuxiliaryGroup = (typeof RECEIPT_DETAIL_AUXILIARY_GROUPS)[number];

export function resolveReceiptDetailAuxiliary<T>(
  group: ReceiptDetailAuxiliaryGroup,
  result: PromiseSettledResult<T>,
  fallback: T,
  onRejected: (group: ReceiptDetailAuxiliaryGroup, reason: unknown) => void,
): T {
  return resolveReceiptAuxiliary(result, fallback, (reason) => onRejected(group, reason));
}

export async function loadRequiredReceiptDetail<T>(
  load: () => Promise<T>,
  onRejected: (reason: unknown) => void,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    onRejected(error);
    throw error;
  }
}
