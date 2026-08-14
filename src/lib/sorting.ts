export const PRIORITY_RANK: Record<string, number> = {
  LOW: 10,
  MEDIUM: 20,
  HIGH: 30,
  URGENT: 40,
};

export const POLICY_STATUS_RANK: Record<string, number> = {
  ACTIVE: 40,
  PENDING: 30,
  EXPIRED: 20,
  RENEWED: 10,
  CANCELLED: 0,
};

export const COMMISSION_STATUS_RANK: Record<string, number> = {
  OVERDUE: 40,
  EXPECTED: 30,
  PENDING: 20,
  PAID: 10,
  CANCELLED: 0,
};

const naturalCollator = new Intl.Collator("es-MX", {
  numeric: true,
  sensitivity: "base",
  ignorePunctuation: false,
});

export function compareNaturalText(left: string | null | undefined, right: string | null | undefined) {
  return naturalCollator.compare(left ?? "", right ?? "");
}

export function compareDateAsc(left: Date | null | undefined, right: Date | null | undefined) {
  const leftTime = left instanceof Date ? left.getTime() : Number.POSITIVE_INFINITY;
  const rightTime = right instanceof Date ? right.getTime() : Number.POSITIVE_INFINITY;
  return leftTime - rightTime;
}

export function receiptSequenceForNumber(value: string | null | undefined) {
  const match = value?.trim().match(/(\d+)$/);
  if (!match) return null;
  const sequence = Number(match[1]);
  return Number.isSafeInteger(sequence) && sequence <= 2_147_483_647 ? sequence : null;
}

export function comparePriorityDesc(left: string | null | undefined, right: string | null | undefined) {
  return (PRIORITY_RANK[right ?? ""] ?? -1) - (PRIORITY_RANK[left ?? ""] ?? -1);
}

export function comparePolicyStatusDesc(left: string | null | undefined, right: string | null | undefined) {
  return (POLICY_STATUS_RANK[right ?? ""] ?? -1) - (POLICY_STATUS_RANK[left ?? ""] ?? -1);
}

export function compareCommissionStatusDesc(left: string | null | undefined, right: string | null | undefined) {
  return (COMMISSION_STATUS_RANK[right ?? ""] ?? -1) - (COMMISSION_STATUS_RANK[left ?? ""] ?? -1);
}
