import { formatBusinessDateInput } from "@/lib/business-dates";
import { isPaidWithinTolerance } from "@/lib/receipt-reconciliation";

export const OPERATIONAL_INSIGHT_GROUPS = ["renewals", "collections", "claims", "work"] as const;
export type OperationalInsightGroup = (typeof OPERATIONAL_INSIGHT_GROUPS)[number];
export type OperationalInsightGroupFilter = OperationalInsightGroup | "all";

export const OPERATIONAL_INSIGHT_PAGE_SIZE = 25;

export type OperationalInsightSignal = {
  id: string;
  group: OperationalInsightGroup;
  recordKey: string;
  recordTitle: string;
  recordSubtitle: string;
  href: string;
  label: string;
  detail: string;
  date: Date;
};

export type OperationalInsightRecord = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  date: Date;
  groups: OperationalInsightGroup[];
  signals: Array<Omit<OperationalInsightSignal, "recordKey" | "recordTitle" | "recordSubtitle" | "href">>;
};

export function readOperationalInsightGroup(value: string | string[] | undefined): OperationalInsightGroupFilter {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && (OPERATIONAL_INSIGHT_GROUPS as readonly string[]).includes(candidate)
    ? candidate as OperationalInsightGroup
    : "all";
}

export function readOperationalInsightPage(value: string | string[] | undefined): number {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = candidate && /^\d+$/.test(candidate) ? Number(candidate) : 1;
  return Number.isFinite(parsed) ? Math.min(100, Math.max(1, parsed)) : 1;
}

export function parseCollectionMetadata(metadataJson: string | null): Record<string, unknown> {
  if (!metadataJson) return {};
  try {
    const parsed: unknown = JSON.parse(metadataJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function getOutstandingReceiptBalance(amount: number, postedPaymentAmounts: number[]) {
  if (!Number.isFinite(amount) || postedPaymentAmounts.some((payment) => !Number.isFinite(payment))) return 0;
  const paidAmount = postedPaymentAmounts.reduce((sum, payment) => sum + payment, 0);
  if (isPaidWithinTolerance(amount, paidAmount)) return 0;
  return Math.max(0, amount - paidAmount);
}

export function isPromiseSignalDue(input: {
  metadataJson: string | null;
  today: Date;
  postedPaymentDates: Date[];
}) {
  const metadata = parseCollectionMetadata(input.metadataJson);
  if (metadata.outcome !== "PROMISED_PAYMENT" || typeof metadata.promisedPaymentDate !== "string") return null;
  const promisedDate = new Date(metadata.promisedPaymentDate);
  if (!Number.isFinite(promisedDate.getTime())) return null;

  const promisedDay = formatBusinessDateInput(promisedDate);
  if (input.postedPaymentDates.some((paidDate) => paidDate.getTime() <= promisedDate.getTime())) return null;
  const todayKey = formatBusinessDateInput(input.today);
  if (promisedDay > todayKey) return null;

  return promisedDay === todayKey ? "promise-today" as const : "promise-broken" as const;
}

export function groupOperationalInsightSignals(signals: OperationalInsightSignal[]): OperationalInsightRecord[] {
  const records = new Map<string, OperationalInsightRecord>();

  for (const signal of signals) {
    let record = records.get(signal.recordKey);
    if (!record) {
      record = {
        id: signal.recordKey,
        title: signal.recordTitle,
        subtitle: signal.recordSubtitle,
        href: signal.href,
        date: signal.date,
        groups: [],
        signals: [],
      };
      records.set(signal.recordKey, record);
    }

    if (!record.groups.includes(signal.group)) record.groups.push(signal.group);
    if (!record.signals.some((existing) => existing.id === signal.id)) {
      record.signals.push({ id: signal.id, group: signal.group, label: signal.label, detail: signal.detail, date: signal.date });
    }
    if (signal.date < record.date) record.date = signal.date;
  }

  return [...records.values()].sort((left, right) => left.date.getTime() - right.date.getTime() || left.id.localeCompare(right.id));
}

export function paginateOperationalInsightRecords(
  records: OperationalInsightRecord[],
  group: OperationalInsightGroupFilter,
  page: number,
  hasMoreCandidates: boolean,
) {
  const filtered = group === "all" ? records : records.filter((record) => record.groups.includes(group));
  const offset = (page - 1) * OPERATIONAL_INSIGHT_PAGE_SIZE;
  return {
    records: filtered.slice(offset, offset + OPERATIONAL_INSIGHT_PAGE_SIZE),
    hasPrevious: page > 1,
    hasNext: filtered.length > offset + OPERATIONAL_INSIGHT_PAGE_SIZE || hasMoreCandidates,
  };
}
