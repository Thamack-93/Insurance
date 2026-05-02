import { getDb } from "@/lib/db";

export function safeJson(value: unknown, maxLength = 5000) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? String(value);

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export async function writeActivityLog({
  entityType,
  entityId,
  action,
  oldValue,
  newValue,
  performedBy = "local-ui",
}: {
  entityType: string;
  entityId: string;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
  performedBy?: string;
}) {
  const db = getDb();

  await db.activityLog.create({
    data: {
      entityType,
      entityId,
      action,
      oldValue: oldValue === undefined ? null : safeJson(oldValue),
      newValue: newValue === undefined ? null : safeJson(newValue),
      performedBy,
    },
  });
}