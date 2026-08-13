---
name: PolicyDesk table & export architecture
description: Why list pages, exports and bulk actions all share one set of filter builders, and where portfolio scope must be enforced.
---

# Two table systems, one filter source

PolicyDesk has two independent table stacks. The TanStack-based `DataTable` is
exported from the tables barrel but **no real list screen uses it** — clients,
policies, quotes and receipts all use the server stack (toolbar + sortable heads
+ URL-driven pagination). Improving only `DataTable` therefore changes nothing a
user can see.

**Why:** acceptance criteria on this project are written against the real
screens. Verify a table change by curling the actual route, not by reasoning
about the shared component.

## Rule: filters, exports and bulk actions read the same builders

Every list surface derives its Prisma `where`/`orderBy` from the shared
`read*ListFilters` / `build*ListWhere` / `build*ListOrderBy` helpers. A page and
its export must never build their own predicates.

**Why:** the previous export scraped the rendered DOM, so it silently shipped
only the visible page and drifted from the filters the user had applied. Sharing
the builders makes drift structurally impossible.

**How to apply:** when adding a new list screen or a new filter, extend the
shared builder and let the page, the export route and any bulk action consume
it. If you find yourself writing an inline `where` in a page component, stop.

## Rule: portfolio scope is resolved server-side, never accepted from the client

The export route passes only the *user-supplied filters* to each dataset loader;
the loader itself calls `requirePortfolioReadScope()` and folds
`scope.portfolioOwnerId` into the `where`. Bulk actions do the same, then drop
out-of-scope ids from the batch instead of failing it, and report them in the
summary.

**Why:** an export or bulk mutation that trusted a client-supplied scope would
let an agent read or edit another agent's portfolio. The generic bulk helper in
the lib layer has no auth of its own, so enforcement has to live in the
server action / route loader.

**How to apply:** any new export dataset or bulk action resolves scope itself.
Never add a `scope`, `ownerId` or `portfolioOwnerId` query parameter.
