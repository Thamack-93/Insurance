# PolicyDesk (PG Insurance) — replit.md

## Overview

PolicyDesk is a **local-first CRM/dashboard** for managing an insurance portfolio from a single machine. It is branded as "PG Insurance" (initials for Pedro Gomez). The application is designed to operate entirely without cloud services or AI in its MVP phase.

The core operational chain is:

`Client → Policy → Receipt → Payment → Commission → Task → Document → Activity → Risk`

Key goals:
- Give an insurance agent a daily cockpit to understand their portfolio at a glance.
- All data lives in a local SQLite database (`data/pg.sqlite`).
- Sensitive documents are stored in `data/documents`, never in `public/`.
- Business logic is shared between the Next.js app and standalone CLI scripts in `scripts/`.
- Prisma is the **only** accepted way to read or write the database.

---

## User Preferences

Preferred communication style: Simple, everyday language.

---

## System Architecture

### Frontend

- **Framework**: Next.js App Router (version ~16.x — note: this version may have breaking changes from older Next.js; always read `node_modules/next/dist/docs/` before writing code).
- **Language**: TypeScript with strict mode.
- **Styling**: Tailwind CSS v4 with `tw-animate-css` and `shadcn/ui` (style: `base-nova`, base color: `neutral`).
- **Component library**: shadcn/ui + Radix UI primitives + Lucide icons.
- **State / forms**: React Hook Form + Zod for validation.
- **Tables**: TanStack Table v8.
- **Charts**: Recharts.
- **Animations**: Framer Motion.
- **Notifications**: Sonner toasts.
- **Theming**: `next-themes` for dark/light mode support.

**Layout pattern**: Sidebar (`AppSidebar`) with 6 collapsible sections (Operación, Cartera, Finanzas, Operación interna, Calidad, Sistema) — open/closed state persisted in `localStorage` (`pg.sidebar.openSections`); active route auto-opens its parent. Topbar (`AppTopbar`) with global search and ⌘K palette. Dashboard pages live under `src/app/(dashboard)/`. The root `page.tsx` redirects to `/dashboard`.

**Canonical pages (post Task #2 consolidation)**:
- `/dashboard` — strategic KPIs + charts + activity timeline + top-3 risk summary. NO duplicate "urgent payments" or "critical pending" cards (those belong to `/today`).
- `/today` — actionable inbox: KPI strip + Por cobrar groups + Renovar + Pendientes atrasados + Comisiones. NO timeline, NO documents-missing card.
- `/receipts` — unified Finanzas page with `?tab=cobrar|historico` (default `cobrar`). Cobrar tab groups open receipts by overdue/7d/later with `QuickPaymentDialog`. Histórico tab shows `Payment` records + paid-this-month receipts.
- `/risks` — unified Calidad page with `?tab=hallazgos|completitud` (default `hallazgos`). Hallazgos tab uses `risk-engine`. Completitud tab uses `data-quality.ts` scores.
- Tabs sync the URL via `UrlTabs` (`src/components/ui/url-tabs.tsx`) using `router.replace` with `scroll: false`.

**Legacy URL redirects** (in `next.config.ts`):
- `/payments` → `/receipts?tab=cobrar`
- `/payments/new` → `/receipts?tab=cobrar` (semántica de pago rápido, no creación de recibo)
- `/data-quality` → `/risks?tab=completitud`

`src/app/(dashboard)/payments/actions.ts` is retained (no page route) because `src/app/api/payments/quick/route.ts` imports `createPayment` from it.

**Component organization** (under `src/components/`):
- `layout/` — sidebar, topbar
- `cards/` — KpiCard, RiskAlertCard, StatGrid
- `charts/` — Recharts wrappers (DuePaymentsChart, RenewalsChart, etc.)
- `badges/` — StatusBadge, PriorityBadge, SeverityBadge
- `command/` — Command palette (⌘K)
- `drawers/` — ConfirmDialog
- `documents/` — DocumentCard, UploadForm
- `bulk-actions/` — BulkActionsProvider (context), toolbar, selectable rows
- `branding/` — PGLogo, PGIcon components
- `ui/` — shadcn primitives

### Backend

- **Runtime**: Next.js Server Components + Server Actions (`"use server"` files).
- **API routes**: Under `src/app/api/` (file upload endpoint, etc.).
- **Database access**: Only through `src/lib/db.ts` which exports `getDb()` — a singleton `PrismaClient` using the `better-sqlite3` adapter.
- **Business logic modules** in `src/lib/`:
  - `dashboard-queries.ts` — aggregated dashboard data
  - `portfolio-queries.ts` — portfolio metrics
  - `list-queries.ts` — due payments, renewals, open tasks
  - `risk-engine.ts` — deterministic risk detection (no AI)
  - `data-quality.ts` — client/policy completeness scoring
  - `activity-log.ts` — audit trail writes
  - `commissions.ts` — commission calculations
  - `renewals.ts` — renewal reminders
  - `backup.ts` — database file copy
  - `search.ts` — global search across all entities
  - `settings.ts` — system settings via `SystemSetting` table
  - `export.ts` — CSV/XLSX export helpers (using `xlsx`)
  - `validations.ts` — Zod schemas for all forms
  - `dates.ts`, `money.ts`, `status.ts`, `files.ts` — domain utilities

### Database

- **Engine**: SQLite via `better-sqlite3`.
- **ORM**: Prisma with `@prisma/adapter-better-sqlite3`.
- **Schema location**: `prisma/schema.prisma`.
- **Migrations**: `prisma/migrations/`.
- **Database file**: `data/pg.sqlite` (path defined in `prisma.config.ts` and `src/lib/files.ts`).
- **Seed**: `prisma/seed.ts` — generates realistic demo data.

**Core entities** (from data model docs):
- `Client` — individuals or companies
- `Insurer` — insurance companies
- `Policy` — insurance contracts (types: AUTO, GMM, VIDA, DANOS, FIANZAS, HOGAR, RESPONSABILIDAD_CIVIL, EMPRESARIAL, ACCIDENTES, OTRO)
- `Receipt` — payment obligations (financial obligation layer)
- `Payment` — actual payment events
- `Commission` — agent income (expected or real)
- `Task` — operational to-dos (with priority, status, relations to other entities)
- `Claim` — insurance claims
- `Quote` — insurance quotations
- `Document` — file references (stored outside `public/`)
- `ActivityLog` — audit trail
- `SystemSetting` — key/value app settings
- `Alert` — system-generated alerts

**File storage**: Local filesystem under `data/documents/`. Path safety enforced via `assertSafeDocumentPath()` in `src/lib/files.ts`.

### CLI Scripts

All scripts live in `scripts/` and use `tsx` to run directly. They share utilities via `scripts/_shared.ts`.

Key scripts:
- `backup-db.ts` — copy database to `data/backups/`
- `list-next-payments.ts` — upcoming/overdue receipts
- `list-renewals.ts` — upcoming/overdue policy renewals
- `list-open-tasks.ts` — open tasks sorted by priority
- `export-due-payments.ts` — CSV/XLSX export of due payments
- `export-commissions.ts` — CSV/XLSX export of commissions
- `validate-data-quality.ts` — runs risk engine + data quality checks
- `import-client.ts` / `import-policy.ts` — CSV/XLSX import with Zod validation, dry-run support, backup before write
- `import-pdfs.ts` — PDF ingestion with Mexican insurer detection
- `seed-demo-data.ts` — realistic demo seeding

**Rules for scripts**:
1. Never edit the database directly — use Prisma client.
2. Always run `npm run backup` before mass writes.
3. Imports must validate with Zod, support `--dry-run`, print a change report, and write `ActivityLog`.
4. Exports go to `data/exports/`.

### Key Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Database | SQLite (local file) | Local-first, no cloud dependency, simple ops |
| ORM | Prisma only | Single source of truth, migrations, type safety |
| Rendering | Server Components + Server Actions | Minimal client JS, data fetched server-side |
| Validation | Zod everywhere | Consistent schemas shared between forms and scripts |
| Document storage | `data/documents/` (not `public/`) | Security — sensitive insurance docs must not be publicly served |
| No AI in MVP | Deterministic rules only | Risk engine and data quality use hard-coded rules; AI is future roadmap |
| Backup strategy | File copy before destructive ops | Safety net for local-only database |

---

## External Dependencies

### npm Packages (key ones)

| Package | Purpose |
|---|---|
| `next` ~16.x | App framework (App Router) |
| `@prisma/client` + `@prisma/adapter-better-sqlite3` | ORM + SQLite adapter |
| `better-sqlite3` | SQLite driver |
| `tailwindcss` v4 + `tw-animate-css` | Styling |
| `shadcn` + Radix UI | UI component system |
| `@tanstack/react-table` | Data tables |
| `react-hook-form` + `@hookform/resolvers` | Form management |
| `zod` v4 | Schema validation |
| `recharts` | Charts |
| `framer-motion` | Animations |
| `date-fns` v4 | Date utilities (locale: `es`) |
| `lucide-react` | Icons |
| `sonner` | Toast notifications |
| `xlsx` | Excel/CSV export |
| `next-themes` | Theme switching |
| `cmdk` | Command menu primitive |

### No External Services in MVP

- **No cloud database** — SQLite only.
- **No authentication service** — local single-user app.
- **No AI/LLM APIs** — all logic is deterministic.
- **No email/SMS services active** — settings exist but not wired in MVP.
- **No payment processors** — payment tracking only.

### Future Integrations (Roadmap, not implemented)

- PDF text extraction and document search.
- AI suggestions (always requiring user approval, never source of truth).
- Email/SMS notifications.

### Development Tooling

- `tsx` — runs TypeScript scripts directly without compilation.
- `prisma` CLI — migrations and code generation.
- `eslint` — linting.
- `@tailwindcss/postcss` — Tailwind PostCSS integration.

---

## Known Bugs Fixed (Session Log)

### Bug Fixes Applied

1. **Duplicate key in tasks page** — `urgentTasks + overdueTasks` merged via Map to deduplicate by task ID.
2. **Decimal serialization in reports** — `premiumAmount`/`amount` (Prisma Decimal) wrapped with `Number()` before passing to Client Components.
3. **Nested `<button>` in `ExportButtons`** — `DropdownMenuTrigger` from base-ui renders as `<button>`; fixed with `render` prop pattern instead of a child `<Button>`.
4. **Nested `<button>` in `QuickPaymentDialog`** — Same `render` prop fix for `DialogTrigger`.
5. **Receipts page title** — Was "Receipts" in English; changed to "Recibos".
6. **Edit pages `submitAction` inline functions** — Next.js 16 cannot pass inline `async` functions to Client Components. Fixed all 7 edit pages (`clients`, `policies`, `receipts`, `tasks`, `claims`, `insurers`, `quotes`) to use `serverAction.bind(null, id)` pattern.
7. **Select labels showing raw enum values** — `Select.Value` from base-ui doesn't resolve `ItemText` from portaled items on initial render. Fixed by creating `ControlledSelect` component in `form-primitives.tsx` that looks up the Spanish label from the options array and passes it as children to `SelectValue`. Updated all 8 form files to use `ControlledSelect` instead of inline `Select`+`Controller` blocks. Also converted `claim-form`, `insurer-form`, and `quote-form` from broken `{...register()}` spread on `Select` (base-ui doesn't support it) to proper `Controller` pattern.

### Component Patterns (Critical)

- **base-ui `Select`**: Does NOT support `{...register()}` spread from React Hook Form. Always use `Controller` + `onValueChange`.
- **base-ui `DropdownMenuTrigger` / `DialogTrigger`**: These render as `<button>` themselves. Use `render={<YourButton />}` prop — do NOT nest a `<Button>` as child.
- **Server Actions to Client Components**: Never pass inline `async (values) => action(id, values)` — use `action.bind(null, id)` instead.
- **`ControlledSelect`**: Reusable component in `src/components/forms/form-primitives.tsx`. Accepts `value`, `onValueChange`, `options: SelectOption[]`, `placeholder`. Always shows correct Spanish label for pre-loaded enum values.