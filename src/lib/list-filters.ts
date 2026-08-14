import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import {
  clientOperationalWhere,
  policyOperationalWhere,
  quoteOperationalWhere,
  receiptOperationalWhere,
  organizationOperationalWhere,
} from "@/lib/portfolio-access";
import { businessAddDays } from "@/lib/business-dates";
import { today } from "@/lib/dates";
import { ENTITY_STATUSES, POLICY_STATUSES, POLICY_TYPES, QUOTE_STATUSES } from "@/lib/domain-values";
import {
  amountMatchWindow,
  parseSearchQuery,
  type ParsedSearchQuery,
} from "@/lib/table-search";
import {
  readAllowedTableParam,
  readTablePage,
  readTableSort,
  readTableParam,
  type TableSearchParams,
  type TableSortDirection,
} from "@/lib/table-query";

/**
 * One source of truth for the filters behind each list screen.
 *
 * The pages and the export endpoint both build their query here, so an export
 * can never widen (or narrow) the result set relative to the table the user is
 * looking at — including the portfolio scope, which is always applied by the
 * caller through `portfolioOwnerId`.
 */

export type ListFilters = {
  query: string;
  parsedQuery: ParsedSearchQuery;
  page: number;
  sortKey: string | null;
  direction: TableSortDirection | null;
};

function readBaseFilters(params: TableSearchParams): ListFilters {
  const query = (readTableParam(params, "q") ?? "").trim().slice(0, 100);
  const { sortKey, direction } = readTableSort(params);

  return {
    query,
    parsedQuery: parseSearchQuery(query),
    page: readTablePage(params),
    sortKey,
    direction,
  };
}

// ---------------------------------------------------------------- clients

export type ClientListFilters = ListFilters & {
  status?: (typeof ENTITY_STATUSES)[number];
  type?: "PERSON" | "COMPANY";
};

export function readClientListFilters(params: TableSearchParams): ClientListFilters {
  const rawStatus = readTableParam(params, "status");
  return {
    ...readBaseFilters(params),
    // The directory is operational by default. `status=ALL` is an explicit
    // opt-in to the historical/inactive records.
    status: rawStatus === "ALL" ? undefined : readAllowedTableParam(params, "status", ENTITY_STATUSES) ?? "ACTIVE",
    type: readAllowedTableParam(params, "type", ["PERSON", "COMPANY"] as const),
  };
}

export function buildClientListWhere(
  filters: ClientListFilters,
  portfolioOwnerId?: string,
  organizationId?: string,
): Prisma.ClientWhereInput {
  const { parsedQuery } = filters;
  const or: Prisma.ClientWhereInput[] = [];

  if (parsedQuery.raw) {
    or.push(
      { fullName: { contains: parsedQuery.raw } },
      { email: { contains: parsedQuery.raw } },
      { phone: { contains: parsedQuery.raw } },
      { rfc: { contains: parsedQuery.raw } },
    );

    if (parsedQuery.date) {
      or.push({ createdAt: { gte: parsedQuery.date.from, lt: parsedQuery.date.to } });
    }
  }

  return {
    ...clientOperationalWhere(portfolioOwnerId),
    ...(organizationId ? organizationOperationalWhere(organizationId) : {}),
    status: filters.status ?? "ACTIVE",
    ...(filters.type ? { type: filters.type } : {}),
    ...(or.length ? { OR: or } : {}),
  };
}

export function buildClientListOrderBy({ sortKey, direction }: ClientListFilters): Prisma.ClientOrderByWithRelationInput[] {
  switch (sortKey) {
    case "fullName":
      return [{ fullName: direction ?? "asc" }, { id: "asc" as const }];
    case "type":
      return [{ type: direction ?? "asc" }, { fullName: "asc" as const }, { id: "asc" as const }];
    case "status":
      return [{ status: direction ?? "asc" }, { fullName: "asc" as const }, { id: "asc" as const }];
    case "createdAt":
      return [{ createdAt: direction ?? "desc" }, { id: "desc" as const }];
    default:
      return [{ fullName: "asc" as const }, { id: "asc" as const }];
  }
}

// --------------------------------------------------------------- policies

export type PolicyListFilters = ListFilters & {
  status?: (typeof POLICY_STATUSES)[number];
  type?: (typeof POLICY_TYPES)[number];
};

export function readPolicyListFilters(params: TableSearchParams): PolicyListFilters {
  return {
    ...readBaseFilters(params),
    status: readAllowedTableParam(params, "status", POLICY_STATUSES),
    type: readAllowedTableParam(params, "type", POLICY_TYPES),
  };
}

export function buildPolicyListWhere(
  filters: PolicyListFilters,
  portfolioOwnerId?: string,
  organizationId?: string,
): Prisma.PolicyWhereInput {
  const { parsedQuery } = filters;
  const base: Prisma.PolicyWhereInput = {
    ...policyOperationalWhere(portfolioOwnerId),
    ...(organizationId ? organizationOperationalWhere(organizationId) : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.type ? { policyType: filters.type } : {}),
  };

  if (!parsedQuery.raw) return base;

  const or: Prisma.PolicyWhereInput[] = [
    { policyNumber: { contains: parsedQuery.raw } },
    { client: { fullName: { contains: parsedQuery.raw } } },
    { insurer: { name: { contains: parsedQuery.raw } } },
  ];

  if (parsedQuery.amount !== null) {
    or.push({ premiumAmount: amountMatchWindow(parsedQuery.amount) });
  }

  if (parsedQuery.date) {
    or.push({ endDate: { gte: parsedQuery.date.from, lt: parsedQuery.date.to } });
    or.push({ startDate: { gte: parsedQuery.date.from, lt: parsedQuery.date.to } });
  }

  return { AND: [base, { OR: or }] };
}

export function buildPolicyListOrderBy({ sortKey, direction }: PolicyListFilters): Prisma.PolicyOrderByWithRelationInput[] {
  const tail = [{ endDate: "asc" as const }, { updatedAt: "desc" as const }, { id: "asc" as const }];

  switch (sortKey) {
    case "policyNumber":
      return [{ policyNumber: direction ?? "asc" }, ...tail];
    case "client":
      return [{ client: { fullName: direction ?? "asc" } }, ...tail];
    case "insurer":
      return [{ insurer: { name: direction ?? "asc" } }, ...tail];
    case "type":
      return [{ policyType: direction ?? "asc" }, ...tail];
    case "endDate":
      return [{ endDate: direction ?? "asc" }, { updatedAt: "desc" as const }, { id: "asc" as const }];
    case "premiumAmount":
      return [{ premiumAmount: direction ?? "desc" }, { endDate: "asc" as const }, { id: "asc" as const }];
    default:
      return [{ endDate: "asc" as const }, { startDate: "asc" as const }, { updatedAt: "desc" as const }, { id: "asc" as const }];
  }
}

// ---------------------------------------------------------------- quotes

export type QuoteListFilters = ListFilters & {
  status?: (typeof QUOTE_STATUSES)[number];
};

export function readQuoteListFilters(params: TableSearchParams): QuoteListFilters {
  return {
    ...readBaseFilters(params),
    status: readAllowedTableParam(params, "status", QUOTE_STATUSES),
  };
}

export function buildQuoteListWhere(
  filters: QuoteListFilters,
  portfolioOwnerId?: string,
  organizationId?: string,
): Prisma.QuoteWhereInput {
  const { parsedQuery } = filters;
  const base: Prisma.QuoteWhereInput = {
    ...quoteOperationalWhere(portfolioOwnerId),
    ...(organizationId ? organizationOperationalWhere(organizationId) : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };

  if (!parsedQuery.raw) return base;

  const or: Prisma.QuoteWhereInput[] = [
    { client: { fullName: { contains: parsedQuery.raw } } },
    { insurer: { name: { contains: parsedQuery.raw } } },
    { policyType: { contains: parsedQuery.raw } },
  ];

  if (parsedQuery.amount !== null) {
    or.push({ quotedAmount: amountMatchWindow(parsedQuery.amount) });
  }

  if (parsedQuery.date) {
    or.push({ createdAt: { gte: parsedQuery.date.from, lt: parsedQuery.date.to } });
    or.push({ validUntil: { gte: parsedQuery.date.from, lt: parsedQuery.date.to } });
  }

  return { AND: [base, { OR: or }] };
}

export function buildQuoteListOrderBy({ sortKey, direction }: QuoteListFilters): Prisma.QuoteOrderByWithRelationInput[] {
  switch (sortKey) {
    case "folio":
      return [{ id: direction ?? "asc" }, { createdAt: "desc" as const }];
    case "client":
      return [{ client: { fullName: direction ?? "asc" } }, { createdAt: "desc" as const }];
    case "type":
      return [{ policyType: direction ?? "asc" }, { createdAt: "desc" as const }];
    case "insurer":
      return [{ insurer: { name: direction ?? "asc" } }, { createdAt: "desc" as const }];
    case "status":
      return [{ status: direction ?? "asc" }, { createdAt: "desc" as const }];
    case "createdAt":
      return [{ createdAt: direction ?? "desc" }, { id: "desc" as const }];
    case "value":
      return [{ quotedAmount: direction ?? "desc" }, { createdAt: "desc" as const }];
    default:
      return [{ createdAt: "desc" as const }, { id: "desc" as const }];
  }
}

// -------------------------------------------------------------- receipts

export const RECEIPT_DUE_FILTERS = ["overdue", "today", "upcoming"] as const;
export type ReceiptDueFilter = (typeof RECEIPT_DUE_FILTERS)[number];

export type ReceiptListFilters = ListFilters & {
  status?: ReceiptDueFilter;
};

export function readReceiptListFilters(params: TableSearchParams): ReceiptListFilters {
  return {
    ...readBaseFilters(params),
    status: readAllowedTableParam(params, "status", RECEIPT_DUE_FILTERS),
  };
}

function receiptDueDateWhere(status?: ReceiptDueFilter): Prisma.ReceiptWhereInput {
  if (!status) return {};

  const now = today();
  const tomorrow = businessAddDays(now, 1);

  if (status === "overdue") return { dueDate: { lt: now } };
  if (status === "today") return { dueDate: { gte: now, lt: tomorrow } };
  return { dueDate: { gte: tomorrow, lte: businessAddDays(now, 7) } };
}

/** Open receipts only: the "Por cobrar" tab never shows paid or cancelled ones. */
export function buildOpenReceiptBaseWhere(portfolioOwnerId?: string, organizationId?: string): Prisma.ReceiptWhereInput {
  return {
    ...receiptOperationalWhere(portfolioOwnerId),
    ...(organizationId ? organizationOperationalWhere(organizationId) : {}),
    status: { notIn: ["PAID", "CANCELLED"] },
  };
}

export function buildReceiptListWhere(
  filters: ReceiptListFilters,
  portfolioOwnerId?: string,
  organizationId?: string,
): Prisma.ReceiptWhereInput {
  const { parsedQuery } = filters;
  const or: Prisma.ReceiptWhereInput[] = [];

  if (parsedQuery.raw) {
    or.push(
      { receiptNumber: { contains: parsedQuery.raw } },
      { client: { fullName: { contains: parsedQuery.raw } } },
      { policy: { policyNumber: { contains: parsedQuery.raw } } },
      { insurer: { name: { contains: parsedQuery.raw } } },
    );

    if (parsedQuery.amount !== null) {
      or.push({ amount: amountMatchWindow(parsedQuery.amount) });
    }

    if (parsedQuery.date) {
      or.push({ dueDate: { gte: parsedQuery.date.from, lt: parsedQuery.date.to } });
    }
  }

  return {
    AND: [
      buildOpenReceiptBaseWhere(portfolioOwnerId, organizationId),
      receiptDueDateWhere(filters.status),
      ...(or.length ? [{ OR: or }] : []),
    ],
  };
}

export function buildReceiptListOrderBy({ sortKey, direction }: ReceiptListFilters): Prisma.ReceiptOrderByWithRelationInput[] {
  switch (sortKey) {
    case "receiptNumber":
      return [
        { receiptSequence: { sort: direction ?? "asc", nulls: "last" as const } },
        { receiptNumber: direction ?? "asc" },
        { dueDate: "asc" as const },
        { id: "asc" as const },
      ];
    case "client":
      return [{ client: { fullName: direction ?? "asc" } }, { dueDate: "asc" as const }, { id: "asc" as const }];
    case "policy":
      return [{ policy: { policyNumber: direction ?? "asc" } }, { dueDate: "asc" as const }, { id: "asc" as const }];
    case "insurer":
      return [{ insurer: { name: direction ?? "asc" } }, { dueDate: "asc" as const }, { id: "asc" as const }];
    case "dueDate":
      return [{ dueDate: direction ?? "asc" }, { receiptSequence: { sort: "asc", nulls: "last" as const } }, { receiptNumber: "asc" as const }, { id: "asc" as const }];
    case "amount":
      return [{ amount: direction ?? "desc" }, { dueDate: "asc" as const }, { id: "asc" as const }];
    default:
      return [{ dueDate: "asc" as const }, { receiptSequence: { sort: "asc", nulls: "last" as const } }, { receiptNumber: "asc" as const }, { id: "asc" as const }];
  }
}
