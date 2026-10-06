export type QualitasMonitorReceipt = { id: string; dueDate: Date | string; status: string };

export type QualitasMonitorComparison =
  | { status: "PENDING"; targetReceiptId: string; localDueDate: string; portalDueDate: string }
  | { status: "LIKELY_ADVANCED"; targetReceiptId: string; localDueDate: string; portalDueDate: string; nextLocalDueDate: string }
  | { status: "INCONCLUSIVE"; targetReceiptId?: string; localDueDate?: string; portalDueDate: string | null };

function dateKey(value: Date | string) {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

export function compareQualitasNextReceipt(
  portalDueDate: string | null,
  receipts: QualitasMonitorReceipt[],
): QualitasMonitorComparison {
  const open = receipts
    .filter((receipt) => !["PAID", "CANCELLED"].includes(receipt.status))
    .map((receipt) => ({ ...receipt, dueDateKey: dateKey(receipt.dueDate) }))
    .sort((left, right) => left.dueDateKey.localeCompare(right.dueDateKey) || left.id.localeCompare(right.id));
  const current = open[0];
  if (!portalDueDate || !current) return { status: "INCONCLUSIVE", targetReceiptId: current?.id, localDueDate: current?.dueDateKey, portalDueDate };
  if (portalDueDate === current.dueDateKey) {
    return { status: "PENDING", targetReceiptId: current.id, localDueDate: current.dueDateKey, portalDueDate };
  }
  const next = open[1];
  if (next && portalDueDate === next.dueDateKey && current.dueDateKey < next.dueDateKey) {
    return {
      status: "LIKELY_ADVANCED",
      targetReceiptId: current.id,
      localDueDate: current.dueDateKey,
      portalDueDate,
      nextLocalDueDate: next.dueDateKey,
    };
  }
  return { status: "INCONCLUSIVE", targetReceiptId: current.id, localDueDate: current.dueDateKey, portalDueDate };
}
