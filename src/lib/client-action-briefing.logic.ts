import { OPEN_WORK_ITEM_STATUSES, type WorkQueueItem } from "@/lib/work-queue";
import type { ActivityEntry } from "@/lib/activity-log";
import { businessAddDays, businessEndOfDay, daysBetweenBusinessDates } from "@/lib/business-dates";
import { getWorkItemHref } from "@/lib/work-item-navigation";

export const CLIENT_ACTION_BRIEFING_LIMIT = 6;
export const CLIENT_ACTION_OVERVIEW_LIMIT = 8;
const UPCOMING_RECEIPT_DAYS = 7;
const RECENT_ACTIVITY_DAYS = 7;

export type ClientActionKind = "receipt" | "renewal" | "task" | "claim" | "activity";
export type ClientActionPriority = "OVERDUE" | "TODAY" | "UPCOMING" | "OPEN" | "ACTIVITY";

export type ClientAction = {
  id: string;
  recordKey: string;
  clientId: string;
  clientName: string;
  kind: ClientActionKind;
  priority: ClientActionPriority;
  title: string;
  detail: string;
  dueDate: Date | null;
  href: string;
  amount?: string;
  currency?: string;
};

export type ClientActionReceipt = {
  id: string;
  clientId: string;
  client: { fullName: string };
  receiptNumber: string;
  dueDate: Date;
  amount: { toString(): string } | string | number;
  currency: string;
  status: string;
  policyId: string;
  policy: { policyNumber: string };
};

export type ClientActionRenewal = {
  policyId: string;
  clientId: string;
  clientName: string;
  policyNumber: string;
  endDate: Date;
};

export type ClientActionClaim = {
  id: string;
  clientId: string;
  client: { fullName: string };
  folio: string;
  claimType: string;
  status: string;
  dueDate: Date | null;
};

export type ClientActionData = {
  today: Date;
  receipts: ClientActionReceipt[];
  renewals: ClientActionRenewal[];
  workItems: WorkQueueItem[];
  claims: ClientActionClaim[];
  activity: ActivityEntry[];
};

const PRIORITY_ORDER: Record<ClientActionPriority, number> = {
  OVERDUE: 0,
  TODAY: 1,
  UPCOMING: 2,
  OPEN: 3,
  ACTIVITY: 4,
};

function duePriority(date: Date | null, today: Date, upcomingWindow = UPCOMING_RECEIPT_DAYS): ClientActionPriority {
  if (!date) return "OPEN";
  const days = daysBetweenBusinessDates(date, today);
  if (days < 0) return "OVERDUE";
  if (days === 0) return "TODAY";
  return days <= upcomingWindow ? "UPCOMING" : "OPEN";
}

function activityPriority(entry: ActivityEntry, today: Date) {
  const daysAgo = daysBetweenBusinessDates(today, entry.createdAt);
  return daysAgo >= 0 && daysAgo <= RECENT_ACTIVITY_DAYS ? "ACTIVITY" as const : null;
}

function activityLabel(action: string) {
  const upper = action.toUpperCase();
  if (upper.startsWith("CREATE")) return "Se creó el registro del cliente";
  if (upper.startsWith("UPDATE")) return "Se actualizó el registro del cliente";
  if (upper.startsWith("DELETE")) return "Se eliminó información del cliente";
  if (upper.startsWith("RENEWAL")) return "Se registró un avance de renovación";
  if (upper.startsWith("PAY")) return "Se registró un pago";
  return "Actividad reciente registrada";
}

function isOpenWorkItem(status: string) {
  return (OPEN_WORK_ITEM_STATUSES as readonly string[]).includes(status);
}

function isActionableReceipt(status: string) {
  return status === "PENDING" || status === "OVERDUE";
}

function isActiveClaim(status: string) {
  return status !== "RESOLVED" && status !== "CANCELLED";
}

function compareActions(a: ClientAction, b: ClientAction) {
  const priority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  if (priority !== 0) return priority;
  if (a.priority === "ACTIVITY" && b.priority === "ACTIVITY") {
    return (b.dueDate?.getTime() ?? 0) - (a.dueDate?.getTime() ?? 0)
      || a.clientName.localeCompare(b.clientName)
      || a.id.localeCompare(b.id);
  }
  return (a.dueDate?.getTime() ?? Number.POSITIVE_INFINITY) - (b.dueDate?.getTime() ?? Number.POSITIVE_INFINITY)
    || a.clientName.localeCompare(b.clientName)
    || a.id.localeCompare(b.id);
}

function workItemRecordKey(item: WorkQueueItem) {
  if (item.receiptId) return `receipt:${item.receiptId}`;
  const renewal = item.sourceType?.toLowerCase() === "renewal"
    || item.taskType?.toLowerCase() === "renewal"
    || item.entityType.toLowerCase() === "policy";
  const policyId = item.policyId ?? (renewal ? item.entityId : null);
  if (renewal && policyId) return `policy:${policyId}`;
  if (item.entityType.toLowerCase() === "claim") return `claim:${item.entityId}`;
  return `work-item:${item.id}`;
}

function deduplicateActions(actions: ClientAction[]) {
  const preferred = new Map<string, ClientAction>();
  for (const action of actions.sort(compareActions)) {
    const current = preferred.get(action.recordKey);
    if (!current) {
      preferred.set(action.recordKey, action);
      continue;
    }
    const selected = compareActions(action, current) < 0 ? action : current;
    preferred.set(action.recordKey, {
      ...selected,
      amount: selected.amount ?? current.amount ?? action.amount,
      currency: selected.currency ?? current.currency ?? action.currency,
    });
  }
  return [...preferred.values()].sort(compareActions);
}

export function buildClientActions(data: ClientActionData): ClientAction[] {
  const today = data.today;
  const inSevenDays = businessEndOfDay(businessAddDays(today, UPCOMING_RECEIPT_DAYS));
  const actions: ClientAction[] = [];

  for (const receipt of data.receipts) {
    if (!isActionableReceipt(receipt.status) || receipt.dueDate > inSevenDays) continue;
    actions.push({
      id: `receipt:${receipt.id}`,
      recordKey: `receipt:${receipt.id}`,
      clientId: receipt.clientId,
      clientName: receipt.client.fullName,
      kind: "receipt",
      priority: duePriority(receipt.dueDate, today),
      title: `Recibo ${receipt.receiptNumber}`,
      detail: receipt.policy.policyNumber,
      dueDate: receipt.dueDate,
      href: `/receipts/${receipt.id}`,
      amount: String(receipt.amount),
      currency: receipt.currency,
    });
  }

  for (const renewal of data.renewals) {
    actions.push({
      id: `renewal:${renewal.policyId}`,
      recordKey: `policy:${renewal.policyId}`,
      clientId: renewal.clientId,
      clientName: renewal.clientName,
      kind: "renewal",
      priority: duePriority(renewal.endDate, today, 60),
      title: `Renovación · ${renewal.policyNumber}`,
      detail: "Póliza activa sin renovación registrada",
      dueDate: renewal.endDate,
      href: `/policies/${renewal.policyId}`,
    });
  }

  for (const item of data.workItems) {
    if (!isOpenWorkItem(item.status) || item.workItemType !== "TASK") continue;
    actions.push({
      id: `work-item:${item.id}`,
      recordKey: workItemRecordKey(item),
      clientId: item.clientId ?? item.client?.id ?? "",
      clientName: item.client?.fullName ?? "Cliente",
      kind: "task",
      priority: duePriority(item.dueDate, today),
      title: item.title,
      detail: item.folio ?? "Pendiente abierto",
      dueDate: item.dueDate,
      href: getWorkItemHref(item),
    });
  }

  for (const claim of data.claims) {
    if (!isActiveClaim(claim.status)) continue;
    actions.push({
      id: `claim:${claim.id}`,
      recordKey: `claim:${claim.id}`,
      clientId: claim.clientId,
      clientName: claim.client.fullName,
      kind: "claim",
      priority: duePriority(claim.dueDate, today),
      title: `Siniestro ${claim.folio}`,
      detail: claim.claimType,
      dueDate: claim.dueDate,
      href: `/claims/${claim.id}`,
    });
  }

  for (const entry of data.activity) {
    const priority = activityPriority(entry, today);
    if (!priority) continue;
    actions.push({
      id: `activity:${entry.id}`,
      recordKey: `activity:${entry.id}`,
      clientId: entry.entityId,
      clientName: "",
      kind: "activity",
      priority,
      title: activityLabel(entry.action),
      detail: "Ver historial",
      dueDate: entry.createdAt,
      href: `/activity?entity=Client&id=${encodeURIComponent(entry.entityId)}`,
    });
  }

  return deduplicateActions(actions);
}

export type ClientActionOverviewItem = {
  clientId: string;
  clientName: string;
  actions: ClientAction[];
  totalActions: number;
};

export function buildClientActionOverview(actions: ClientAction[], limit = CLIENT_ACTION_OVERVIEW_LIMIT): ClientActionOverviewItem[] {
  const byClient = new Map<string, ClientAction[]>();
  for (const action of actions) {
    if (action.priority === "ACTIVITY" || !action.clientId) continue;
    const group = byClient.get(action.clientId) ?? [];
    group.push(action);
    byClient.set(action.clientId, group);
  }

  return [...byClient.entries()]
    .map(([clientId, clientActions]) => ({
      clientId,
      clientName: clientActions[0]?.clientName ?? "Cliente",
      actions: clientActions.sort(compareActions),
      totalActions: clientActions.length,
    }))
    .sort((a, b) => compareActions(a.actions[0]!, b.actions[0]!)
      || b.totalActions - a.totalActions
      || a.clientName.localeCompare(b.clientName)
      || a.clientId.localeCompare(b.clientId))
    .slice(0, Math.max(1, limit));
}

export function hasMeaningfulClientAttention(actions: ClientAction[]) {
  return actions.some((action) => action.priority !== "ACTIVITY");
}
