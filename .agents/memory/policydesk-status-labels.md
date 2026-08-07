---
name: PolicyDesk status vocabulary and label source of truth
description: Which Spanish word each domain status gets, why EXPIRED is not "Vencida", and the one place labels may be defined.
---

## "Vencido/Vencida" belongs to OVERDUE only

`EXPIRED` renders as **"Expirado"/"Expirada"** (gender-agreed per entity), never "Vencida".

**Why:** `OVERDUE` (receipts past their due date) already renders "Vencido". Before this was settled the same
value `EXPIRED` appeared as "Expirado" on the Hoy donut, "Vencida" in the policy filter, and "Expirada" in
quotes — and the "Vencida" spelling additionally collided with a genuinely different state. Two distinct
statuses sharing a word is worse than an awkward word, so "Vencido/Vencida" is reserved for `OVERDUE`.

**How to apply:** if a new screen needs to say a policy has lapsed, it is "Expirada". Reach for "Vencido"
only when the underlying value is `OVERDUE`.

## Labels live in exactly one place

`src/lib/status.ts` is the only file allowed to define a Spanish status label.

- `BASE_STATUS_LABELS` — the canonical masculine/neutral term for each status value.
- `ENTITY_STATUS_LABELS` — gender overrides only, for entities whose noun is feminine (policy, quote,
  commission, alert). WorkItem/Task deliberately use the masculine base.
- `statusLabel(status, entity?)` — the single accessor. Dropdown option lists in `domain-options.ts` are
  *derived* from it via `statusOptions(...)`, so a filter and a badge cannot drift apart.

**Why:** the divergence above happened because option lists and badge maps were maintained separately, and
several pages carried their own inline label objects. Deriving the options removes the ability to disagree.

**How to apply:** never add a local `const somethingStatusLabels = {...}` in a page or component — add the
term to `status.ts` and pass the `entity` prop to `StatusBadge`. Action labels ("Marcar resuelto") are not
status labels and correctly live with their buttons.

## Status columns are database enums

The domain status columns are Postgres enums, not free text. Two consequences that are easy to trip over:

- Raw SQL cannot apply text functions to them. `LOWER("status")` fails with
  `function lower("EntityStatus") does not exist`; an explicit `::text` cast is required. The global search
  builds its LIKE predicates this way.
- Infra/log tables (maintenance runs, ledger imports, assistant runs, notification events, organizations)
  were intentionally left as free text — they are not domain statuses and their value sets churn.
