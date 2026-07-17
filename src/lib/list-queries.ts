import { getDb } from "@/lib/db";
import { businessAddDays, businessEndOfDay, businessStartOfDay } from "@/lib/business-dates";
import { daysUntil, today } from "@/lib/dates";
import { toNumber } from "@/lib/money";
import { OPEN_WORK_ITEM_STATUSES, getWorkItems } from "@/lib/work-queue";

type ReceiptStatus = "PENDING" | "PAID" | "OVERDUE" | "CANCELLED";
type PolicyStatus = "ACTIVE" | "EXPIRED" | "CANCELLED" | "RENEWED" | "PENDING";
type WorkItemStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "WAITING_CLIENT"
  | "WAITING_INSURER"
  | "WAITING_DOCUMENT"
  | "SENT"
  | "RESOLVED"
  | "CANCELLED"
  | "ARCHIVED";

export type DateRange = {
  from: Date;
  to: Date;
};

export type DuePaymentsOptions = {
  from?: Date;
  to?: Date;
  limit?: number;
  skip?: number;
  statuses?: ReceiptStatus[];
};

export type RenewalOptions = {
  from?: Date;
  to?: Date;
  limit?: number;
  skip?: number;
  statuses?: PolicyStatus[];
};

export type OpenWorkItemsOptions = {
  from?: Date;
  to?: Date;
  limit?: number;
  skip?: number;
  statuses?: WorkItemStatus[];
  portfolioOwnerId?: string;
};

export type DuePaymentItem = {
  id: string;
  receiptNumber: string;
  dueDate: Date;
  status: ReceiptStatus;
  amount: number;
  currency: string;
  daysUntilDue: number;
  client: {
    id: string;
    fullName: string;
  };
  policy: {
    id: string;
    policyNumber: string;
    policyType: string;
  };
  insurer: {
    id: string;
    name: string;
  };
};

export type RenewalItem = {
  id: string;
  policyNumber: string;
  policyType: string;
  status: PolicyStatus;
  endDate: Date;
  premiumAmount: number;
  currency: string;
  daysUntilRenewal: number | null;
  client: {
    id: string;
    fullName: string;
  };
  insurer: {
    id: string;
    name: string;
  };
};

export type OpenWorkItemItem = {
  id: string;
  folio: string;
  title: string;
  description: string | null;
  status: WorkItemStatus;
  priority: string;
  startDate: Date;
  dueDate: Date | null;
  daysUntilDue: number | null;
  client: {
    id: string;
    fullName: string;
  } | null;
  policy: {
    id: string;
    policyNumber: string;
    policyType: string;
  } | null;
  insurer: {
    id: string;
    name: string;
  } | null;
  receipt: {
    id: string;
    receiptNumber: string;
  } | null;
};

export async function getDuePayments(options: DuePaymentsOptions = {}) {
  const db = getDb();
  const range = resolveRange(options.from, options.to, 60);
  const statuses = options.statuses ?? ["PENDING", "OVERDUE"];

  const rows = await db.receipt.findMany({
    where: {
      dueDate: { gte: range.from, lte: range.to },
      status: { in: statuses },
    },
    include: {
      client: { select: { id: true, fullName: true } },
      policy: { select: { id: true, policyNumber: true, policyType: true } },
      insurer: { select: { id: true, name: true } },
    },
    orderBy: [{ dueDate: "asc" }, { receiptNumber: "asc" }],
    take: options.limit,
    skip: options.skip,
  });

  return rows.map<DuePaymentItem>((row) => ({
    id: row.id,
    receiptNumber: row.receiptNumber,
    dueDate: row.dueDate,
    status: row.status as ReceiptStatus,
    amount: toNumber(row.amount),
    currency: row.currency,
    daysUntilDue: daysUntil(row.dueDate),
    client: row.client,
    policy: row.policy,
    insurer: row.insurer,
  }));
}

export async function getRenewals(options: RenewalOptions = {}) {
  const db = getDb();
  const range = resolveRange(options.from, options.to, 60);
  const statuses = options.statuses ?? ["ACTIVE"];

  const rows = await db.policy.findMany({
    where: {
      endDate: { gte: range.from, lte: range.to },
      status: { in: statuses },
    },
    include: {
      client: { select: { id: true, fullName: true } },
      insurer: { select: { id: true, name: true } },
    },
    orderBy: [{ endDate: "asc" }, { policyNumber: "asc" }],
    take: options.limit,
    skip: options.skip,
  });

  return rows.map<RenewalItem>((row) => ({
    id: row.id,
    policyNumber: row.policyNumber,
    policyType: row.policyType,
    status: row.status as PolicyStatus,
    endDate: row.endDate,
    premiumAmount: toNumber(row.premiumAmount),
    currency: row.currency,
    daysUntilRenewal: daysUntil(row.endDate),
    client: row.client,
    insurer: row.insurer,
  }));
}

export async function getOpenWorkItems(options: OpenWorkItemsOptions = {}) {
  const range = options.from || options.to ? resolveRange(options.from, options.to, 0) : null;
  const statuses = options.statuses ?? OPEN_WORK_ITEM_STATUSES;

  const rows = await getWorkItems({
    workItemTypes: ["TASK"],
    statuses,
    from: range?.from,
    to: range?.to,
    limit: options.limit,
    skip: options.skip,
    portfolioOwnerId: options.portfolioOwnerId,
  });

  return rows.map<OpenWorkItemItem>((row) => ({
    id: row.sourceId ?? row.id,
    folio: row.folio ?? row.sourceId ?? row.id,
    title: row.title,
    description: row.description,
    status: row.status as WorkItemStatus,
    priority: row.priority,
    startDate: row.startDate,
    dueDate: row.dueDate,
    daysUntilDue: row.dueDate ? daysUntil(row.dueDate) : null,
    client: row.client,
    policy: row.policy,
    insurer: row.insurer,
    receipt: row.receipt,
  }));
}

function resolveRange(from?: Date, to?: Date, fallbackDays = 60): DateRange {
  const start = from ? businessStartOfDay(from) : today();
  const end = to ? businessEndOfDay(to) : businessEndOfDay(businessAddDays(start, fallbackDays));

  if (end < start) {
    throw new Error("El rango de fechas es inválido.");
  }

  return { from: start, to: end };
}
