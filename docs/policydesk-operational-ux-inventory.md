# PolicyDesk operational UX inventory

Baseline reviewed on 2026-08-26 against the current `main` checkout.

This inventory is the scope baseline for the operational consistency cycle. It
records confirmed code-level findings; runtime counts and visual behavior still
require disposable PostgreSQL/browser validation.

## Canonical route map

| Requested surface | Current implementation | Operational role |
| --- | --- | --- |
| `/today` | `src/app/(dashboard)/today/page.tsx` | Daily inbox plus monthly context |
| `/clients`, `/clients/[id]` | Client list and record detail | Client portfolio and related activity |
| `/policies`, `/policies/[id]` | Policy inventory and record detail | Policy lifecycle and renewal context |
| `/renewals` | Redirects to `/operations?view=renewals` | Legacy renewal entry point |
| `/receipts`, `/receipts/[id]` | Receipt collection, payment history and detail | Insurance collection and reconciliation |
| `/claims` | Redirects to `/operations?view=claims` | Legacy claims entry point |
| `/claims/[id]` | Claim detail | Claim follow-up and evidence |
| `/tasks` | Redirects to `/operations?view=pending` | Legacy work-item entry point |
| `/tasks/[id]` | Work-item detail | Operational follow-up |
| `/operations` | Unified pending, renewal and claim views | Canonical operational queue |
| `/risks` | Risk and completeness overview | Data-quality triage |
| `/data-quality` | Maintenance, review and ledger workflows | Admin data-quality operations |
| `/quotes`, `/portfolio`, `/commissions` | Adjacent linked operational lists | Related workflow context and shared table behavior |

## Route inventory

| Surface | Operator question | Primary action | Required context | Confirmed friction or risk | Planned treatment |
| --- | --- | --- | --- | --- | --- |
| Hoy | ¿Qué requiere atención hoy? | Open the relevant receipt, policy or work item | Client/policy, urgency, due date, destination | The action queue, upcoming collections, renewals and commissions are adjacent; destination/count alignment needs runtime verification. | Keep the inbox concise, verify counts and remove only proven duplicate presentation. |
| Clientes | ¿Qué clientes requieren seguimiento y qué cartera tienen? | Open a client or create one | Client identity, status, policy/receipt/task counts | Search/filter/sort are shared, but the page has separate local navigation and list-specific return handling. Detail claims and quotes are displayed without direct links. | One table contract; add related links and contextual return. |
| Cliente detalle | ¿Cuál es el expediente y la siguiente operación? | Open policies/portfolio context | Client, policies, receipts, tasks, claims, quotes, documents | Header actions are visually similar; related claims/quotes are dead ends; back link always returns to `/clients`. | Promote portfolio context, link related records, preserve safe `returnTo`. |
| Pólizas | ¿Qué pólizas están activas, pendientes o terminadas y cuáles vencen? | Open or renew a policy | Policy, client, insurer, type, dates, premium, renewal state | Inventory and “Atención inmediata” repeat related information; renewal action is elsewhere in Operations; list state must remain coherent across local navigation. | Keep one canonical inventory and explicit renewal destination; preserve renewal semantics. |
| Póliza detalle | ¿Qué debo hacer con esta póliza, sus recibos y su renovación? | Renew when eligible, otherwise work the relevant receipt/context | Client, insurer, successor, receipts, claims, documents, tasks | Many actions and sections have equal visual weight; insurer/claim context and list return are inconsistent; related sections need action-oriented links. | State-aware hierarchy using existing actions and contextual links. |
| Renovaciones | ¿Qué renovaciones están vencidas, próximas o ya resueltas? | Work the renewal or capture successor | Renewal state, due date, client/policy, successor | Alias redirects to Operations; legacy tests and links must continue to reflect canonical behavior. | Keep alias, improve canonical list/board labels and state URL. |
| Recibos | ¿Qué debo cobrar, qué se cobró y qué requiere revisión? | Register payment for an open receipt | Receipt, policy, client, amount, paid/outstanding, due date, reconciliation | Collection list, payment history and review tab use different presentation/control density; pagination also repeats count language. | Keep insurance payment flow separate, standardize collection controls and counts. |
| Recibo detalle | ¿Está pagado, cuánto falta y qué acción procede? | Quick payment for pending/overdue receipt | Receipt, policy, client, payment history, reconciliation | Header has edit/cancel/delete but no prominent quick-payment action; fixed back link loses list state. | Promote existing quick-payment dialog; group destructive actions; add safe return. |
| Siniestros | ¿Qué casos abiertos necesitan seguimiento? | Open claim | Claim, client, policy, insurer, status, incident date | Alias redirects to Operations; canonical list has no search/pagination controls. | Add validated search/pagination without changing claim lifecycle. |
| Siniestro detalle | ¿Cuál es el siguiente seguimiento del caso? | Edit/follow up an open claim | Claim, client, policy, insurer, documents, tasks | Existing edit/delete/back actions have similar prominence; related tasks are not surfaced from the detail. | State-aware action hierarchy and related links where data exists. |
| Pendientes | ¿Qué trabajo está atrasado, vence hoy o está próximo? | Open or update a work item | Due date, priority, type, entity context | Canonical Operations view is card-based and currently lacks the list toolbar used elsewhere. `getWorkItems` supports query/filter inputs, but Operations does not pass them. | Add URL-backed query and existing priority/type filters; retain bucket layout. |
| Pendiente detalle | ¿Qué relación y fecha límite tiene este trabajo? | Edit/resolve through existing flow | Client, policy, receipt, due date, status, priority | Priority is rendered directly in one metric; fixed back link loses queue filters. | Centralize priority label and preserve queue return. |
| Riesgos | ¿Qué hallazgos requieren corrección y dónde? | Open the affected entity or resolve issue | Risk type, severity, entity, issue code | It overlaps with Data Quality; filters are custom and must retain active state. | Clarify ownership/cross-links, map visible codes, avoid deleting a sole entry point. |
| Data Quality | ¿Qué revisión o mantenimiento requiere intervención? | Review/approve/apply the flagged record | Batch, reason, status, source/target policy, receipt | Large page contains repeated review tables/actions; visible English title and raw `payment_after_due_date` were confirmed in source. | Normalize copy and controls incrementally; preserve admin mutations and workflow semantics. |

## Cross-cutting findings

### Terminology

- `statusLabel` and `ui-labels.ts` already provide canonical label sources, but
  direct values remain in operational details and Operations claims/work-item
  presentation.
- `policyType` is already translated in most policy surfaces but must remain
  translated in client and related-record sections.
- `claimType` and contact preferences are user-entered text and must not be
  mechanically translated.
- `payment_after_due_date`, raw quality reasons, and visible priority/type
  values require domain labels or a safe fallback.

### Tables and URL state

- `TableToolbar`, `ColumnFilter`, `SortableTableHead`, `Pagination` and
  `TableResultCount` are the existing shared architecture.
- List pages generally reset `page` on search/filter/sort, but adjacent pages
  pass different subsets of state to empty links and pagination.
- The shared “Todos” sentinel is internal and must remain absent from visible
  triggers and URL state when cleared.
- `Pagination` and `TableResultCount` can both describe the result set; the
  final presentation should make one count primary and avoid redundant copy.

### Navigation and dead ends

- Detail headers use fixed list destinations in several routes.
- Client detail renders claim and quote rows without links.
- Related policy, receipt, claim, document and work-item links should carry
  enough context to continue the operational flow without a history engine.
- Any `returnTo` value must be restricted to known internal paths.

### Performance evidence to collect

- Hoy invokes three independent data/session loaders in parallel; inspect their
  query overlap before changing them.
- Operations requests up to 100 work items and then buckets them in memory;
  inspect actual result volume and query plan before optimizing.
- Renewal loading and Data Quality assemble multiple review datasets; measure
  before changing query shape or adding indexes.

### Safety boundaries

- Receipt/Payment code must not import Platform Billing helpers or components.
- Tenant predicates, organization context checks, renewal inclusion rules,
  payment lifecycle rules and backup behavior are out of scope for behavior
  changes.
- The untracked `src/app/(dashboard)/platform/` directory belongs to existing
  user work and is excluded from edits; canonical platform behavior is verified
  through `src/app/(platform)/` and current guards.

## Priorities

1. P0: prevent visible technical labels and preserve tenant/platform/payment
   boundaries.
2. P1: make collection, renewal and work-item actions reachable with context.
3. P1: standardize URL-backed list controls and reset behavior.
4. P2: simplify duplicated presentation and improve narrow-screen/accessibility
   behavior after functional paths are stable.

