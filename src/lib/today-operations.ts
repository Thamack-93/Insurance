import type { getTodayData } from "@/lib/dashboard-queries";
import { daysSince, formatDate, formatRelativeDate } from "@/lib/dates";
import { getWorkItemHref } from "@/lib/work-item-navigation";

type TodayDataResult = Awaited<ReturnType<typeof getTodayData>>;
export type TodayData = Omit<TodayDataResult, "dueTodayWorkItems"> & {
  /** Optional for compatibility with callers that provide pre-split fixtures. */
  dueTodayWorkItems?: TodayDataResult["dueTodayWorkItems"];
};

export type SemanticTone = "critical" | "warning" | "success" | "information" | "ai" | "neutral";

export type OperationalMetricModel = {
  id: string;
  label: string;
  description?: string;
  value: number | string;
  accessibleValue: string;
  tone: SemanticTone;
  href?: string;
};

export type FocusItemModel = {
  id: string;
  kind: "overdue-receipt" | "due-today-receipt" | "overdue-work-item" | "due-today-work-item" | "renewal";
  tone: SemanticTone;
  category: string;
  title: string;
  context: string;
  dueText: string;
  amount?: unknown;
  currency?: string;
  href: string;
  actionLabel: string;
  detailsHref?: string;
  detailsLabel?: string;
};

export type TodayOperationsModel = {
  greeting: string;
  dateLabel: string;
  dateTime: string;
  summary: string;
  summaryMetrics: OperationalMetricModel[];
  focusItems: FocusItemModel[];
};

export function getTimeGreeting(hour: number, name?: string | null) {
  const prefix = hour >= 5 && hour < 12 ? "Buen día" : hour < 19 ? "Buenas tardes" : "Buenas noches";
  return name?.trim() ? `${prefix}, ${name.trim()}` : prefix;
}

export function formatCount(count: number, cappedAt?: number) {
  if (cappedAt !== undefined && count >= cappedAt) {
    return { value: `${cappedAt}+`, accessibleValue: `${cappedAt} o más` };
  }
  return { value: count, accessibleValue: String(count) };
}

function dateTime(date: Date | null | undefined) {
  return date instanceof Date ? date.getTime() : Number.POSITIVE_INFINITY;
}

function compareByDateAndId(a: { dueDate?: Date | null; endDate?: Date | null; id: string }, b: typeof a) {
  const aDate = a.dueDate ?? a.endDate;
  const bDate = b.dueDate ?? b.endDate;
  return dateTime(aDate) - dateTime(bDate) || a.id.localeCompare(b.id);
}

export function buildFocusItems(data: TodayData): FocusItemModel[] {
  const workItemReceiptIds = new Set([
    ...(data.overdueWorkItems ?? []).map((item) => item.receiptId),
    ...(data.dueTodayWorkItems ?? []).map((item) => item.receiptId),
  ].filter((id): id is string => Boolean(id)));
  const workItemPolicyIds = new Set([
    ...(data.overdueWorkItems ?? []).map((item) => item.policyId),
    ...(data.dueTodayWorkItems ?? []).map((item) => item.policyId),
  ].filter((id): id is string => Boolean(id)));
  const overdueReceipts = [...data.overduePayments].filter((receipt) => !workItemReceiptIds.has(receipt.id)).sort(compareByDateAndId).map((receipt) => ({
    id: `receipt-overdue-${receipt.id}`,
    kind: "overdue-receipt" as const,
    tone: "critical" as const,
    category: "Recibo vencido",
    title: receipt.client.fullName,
    context: `${receipt.policy.policyNumber} · ${receipt.receiptNumber}`,
    dueText: `Vencimiento: ${formatDate(receipt.dueDate)} · Vencido ${formatRelativeDate(receipt.dueDate)}`,
    amount: receipt.amount,
    currency: receipt.currency,
    href: `/receipts/${receipt.id}?quickPayment=1`,
    actionLabel: "Registrar pago",
    detailsHref: `/receipts/${receipt.id}`,
    detailsLabel: "Ver recibo",
  }));

  const dueTodayReceipts = [...data.paymentsDueToday].filter((receipt) => !workItemReceiptIds.has(receipt.id)).sort(compareByDateAndId).map((receipt) => ({
    id: `receipt-today-${receipt.id}`,
    kind: "due-today-receipt" as const,
    tone: "warning" as const,
    category: "Recibo vence hoy",
    title: receipt.client.fullName,
    context: `${receipt.policy.policyNumber} · ${receipt.receiptNumber}`,
    dueText: `Vencimiento: ${formatDate(receipt.dueDate)} · Vence hoy`,
    amount: receipt.amount,
    currency: receipt.currency,
    href: `/receipts/${receipt.id}?quickPayment=1`,
    actionLabel: "Registrar pago",
    detailsHref: `/receipts/${receipt.id}`,
    detailsLabel: "Ver recibo",
  }));

  const overdueWorkItems = [...data.overdueWorkItems].sort(compareByDateAndId).map((workItem) => ({
    id: `work-item-${workItem.id}`,
    kind: "overdue-work-item" as const,
    tone: "critical" as const,
    category: workItem.sourceType === "Claim" ? "Seguimiento de siniestro" : "Pendiente atrasado",
    title: workItem.title,
    context: workItem.client?.fullName ?? workItem.folio ?? "Sin relación",
    dueText: workItem.dueDate
      ? `Fecha límite: ${formatDate(workItem.dueDate)} · Vencido ${formatRelativeDate(workItem.dueDate)}`
      : `Inició hace ${daysSince(workItem.startDate)} días`,
    href: getWorkItemHref(workItem),
    actionLabel: workItem.sourceType === "Renewal" ? "Ver póliza" : "Abrir pendiente",
  }));

  const dueTodayWorkItems = [...(data.dueTodayWorkItems ?? [])].sort(compareByDateAndId).map((workItem) => ({
    id: `work-item-today-${workItem.id}`,
    kind: "due-today-work-item" as const,
    tone: "warning" as const,
    category: workItem.sourceType === "Claim" ? "Seguimiento de siniestro" : "Pendiente para hoy",
    title: workItem.title,
    context: workItem.client?.fullName ?? workItem.folio ?? "Sin relación",
    dueText: workItem.dueDate ? `Fecha límite: ${formatDate(workItem.dueDate)} · Vence hoy` : "Vence hoy",
    href: getWorkItemHref(workItem),
    actionLabel: workItem.sourceType === "Renewal" ? "Ver póliza" : "Abrir pendiente",
  }));

  const renewals = [...data.urgentRenewals].filter((policy) => !workItemPolicyIds.has(policy.id)).sort(compareByDateAndId).map((policy) => ({
    id: `renewal-${policy.id}`,
    kind: "renewal" as const,
    tone: "success" as const,
    category: "Renovación próxima",
    title: policy.client.fullName,
    context: `${policy.policyNumber} · ${policy.insurer.name}`,
    dueText: `Renueva ${formatDate(policy.endDate)}`,
    href: `/policies/${policy.id}`,
    actionLabel: "Ver póliza",
  }));

  const groups: Array<{ key: "receipts" | "tasks" | "renewals" | "claims"; items: FocusItemModel[] }> = [
    { key: "receipts", items: [...overdueReceipts, ...dueTodayReceipts] },
    { key: "tasks", items: [...overdueWorkItems, ...dueTodayWorkItems].filter((item) => !/claim/i.test(item.category)) },
    { key: "renewals", items: renewals },
    { key: "claims", items: [...overdueWorkItems, ...dueTodayWorkItems].filter((item) => /claim/i.test(item.category)) },
  ];
  const leaders = groups.flatMap((group) => group.items.slice(0, 1));
  const remainder = groups.flatMap((group) => group.items.slice(1)).sort((a, b) => {
    const aCritical = a.tone === "critical" ? 0 : a.tone === "warning" ? 1 : 2;
    const bCritical = b.tone === "critical" ? 0 : b.tone === "warning" ? 1 : 2;
    return aCritical - bCritical || a.id.localeCompare(b.id);
  });
  return [...leaders, ...remainder].slice(0, 5);
}

export function buildTodayOperationsModel(
  data: TodayData,
  options: { name?: string | null; now?: Date } = {},
): TodayOperationsModel {
  const now = options.now ?? new Date();
  const businessHour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Etc/GMT+6" })
      .formatToParts(now)
      .find((part) => part.type === "hour")?.value ?? 0,
  );
  const count = (items: unknown[], cappedAt?: number) => formatCount(items.length, cappedAt);
  const overdue = count(data.overduePayments, 8);
  const dueToday = count(data.paymentsDueToday);
  const due7 = count(data.paymentsDue7, 8);
  const renewals = count(data.urgentRenewals);
  const overdueWork = count(data.overdueWorkItems, 8);
  const commissions = count(data.commissionsToReview, 8);
  const dueTodayWorkItems = data.dueTodayWorkItems ?? [];
  const actionCount = data.overduePayments.length + data.paymentsDueToday.length + data.overdueWorkItems.length + dueTodayWorkItems.length + data.urgentRenewals.length;
  const actionLabel = data.overduePayments.length >= 8 || data.overdueWorkItems.length >= 8 || dueTodayWorkItems.length >= 8 ? `al menos ${actionCount}` : actionCount;

  return {
    greeting: getTimeGreeting(businessHour, options.name),
    dateTime: now.toISOString(),
    dateLabel: new Intl.DateTimeFormat("es-MX", {
      dateStyle: "full",
      timeZone: "Etc/GMT+6",
    }).format(now),
    summary: `Tienes ${actionLabel} ${actionCount === 1 ? "acción" : "acciones"} que requieren atención. ${data.paymentsDueToday.length} ${data.paymentsDueToday.length === 1 ? "recibo vence" : "recibos vencen"} hoy.`,
    summaryMetrics: [
      { id: "overdue", label: "Vencidos", description: "Recibos atrasados", ...overdue, tone: "critical", href: "/receipts?tab=cobrar&status=overdue" },
      { id: "due-today", label: "Vencen hoy", description: "Recibos del día", ...dueToday, tone: "warning", href: "/receipts?tab=cobrar&status=today" },
      { id: "due-7", label: "Próx. 7 días", description: "Recibos por cobrar", ...due7, tone: "success", href: "/receipts?tab=cobrar&status=upcoming" },
      { id: "renewals", label: "Renovaciones", description: "Pólizas en 30 días", ...renewals, tone: "information", href: "/operations?view=renewals" },
      { id: "overdue-work", label: "Pendientes atrasados", description: "Trabajo fuera de fecha", ...overdueWork, tone: "critical", href: "/operations?view=pending" },
      { id: "commissions", label: "Comisiones", description: "Por revisar pronto", ...commissions, tone: "success", href: "/commissions" },
    ],
    focusItems: buildFocusItems(data),
  };
}
