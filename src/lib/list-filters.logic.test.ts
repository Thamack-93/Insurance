import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildClientListOrderBy,
  buildQuoteListWhere,
  readPolicyListFilters,
  readQuoteListFilters,
  buildReceiptListOrderBy,
  readClientListFilters,
} from "@/lib/list-filters";
import { parseSearchQuery } from "@/lib/table-search";

describe("list filter defaults", () => {
  it("shows active clients by default and makes archived/all explicit", () => {
    expect(readClientListFilters({}).status).toBe("ACTIVE");
    expect(readClientListFilters({ status: "ARCHIVED" }).status).toBe("ARCHIVED");
    expect(readClientListFilters({ status: "ALL" }).status).toBeUndefined();
    expect(buildClientListOrderBy(readClientListFilters({}))).toEqual([{ fullName: "asc" }, { id: "asc" }]);
  });

  it("shows active policies by default and makes all explicit", () => {
    expect(readPolicyListFilters({}).status).toBe("ACTIVE");
    expect(readPolicyListFilters({ status: "ALL" }).status).toBeUndefined();
    expect(readPolicyListFilters({ status: "EXPIRED" }).status).toBe("EXPIRED");
  });

  it("shows operational quotes by default and makes terminal history explicit", () => {
    expect(readQuoteListFilters({}).allStatuses).toBe(false);
    expect(readQuoteListFilters({ status: "ALL" }).allStatuses).toBe(true);
    expect(buildQuoteListWhere(readQuoteListFilters({}), undefined, "org-a").status).toEqual({
      notIn: ["EXPIRED", "CANCELLED", "REJECTED"],
    });
    expect(buildQuoteListWhere(readQuoteListFilters({ status: "ALL" }), undefined, "org-a").status).toBeUndefined();
  });

  it("uses the numeric receipt sequence before the visible number", () => {
    expect(buildReceiptListOrderBy({
      query: "",
      parsedQuery: parseSearchQuery(""),
      page: 1,
      sortKey: null,
      direction: null,
      status: undefined,
    })).toEqual([
      { dueDate: "asc" },
      { receiptSequence: { sort: "asc", nulls: "last" } },
      { receiptNumber: "asc" },
      { id: "asc" },
    ]);
  });
});
