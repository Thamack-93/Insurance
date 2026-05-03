# PolicyDesk (PG Insurance) — replit.md

## Overview

PolicyDesk is a **local-first CRM/dashboard** designed for insurance agents to manage their portfolios from a single machine. Branded as "PG Insurance," the application operates without cloud services or AI in its MVP phase.

The core operational flow involves managing:
`Client → Policy → Receipt → Payment → Commission → Task → Document → Activity → Risk`

Key objectives include providing a daily overview of the portfolio, storing all data in a local SQLite database (`data/pg.sqlite`), securing sensitive documents in `data/documents`, sharing business logic between the Next.js app and CLI scripts, and exclusively using Prisma for database interactions.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: Next.js App Router (~16.x) with TypeScript (strict mode).
- **Styling**: Tailwind CSS v4 (`tw-animate-css`) and `shadcn/ui` (style: `base-nova`, base color: `neutral`).
- **Components**: `shadcn/ui`, Radix UI primitives, Lucide icons.
- **State/Forms**: React Hook Form with Zod for validation.
- **Data Display**: TanStack Table v8 for tables, Recharts for charts.
- **Animations**: Framer Motion.
- **Notifications**: Sonner toasts.
- **Theming**: `next-themes` for dark/light mode.

**Layout**: Features a collapsible `AppSidebar` with 6 sections (Operación, Cartera, Finanzas, Operación interna, Calidad, Sistema) whose state is persisted in `localStorage`. An `AppTopbar` includes global search and a ⌘K palette. Dashboard pages reside under `src/app/(dashboard)/`, with the root `page.tsx` redirecting to `/dashboard`.

**Canonical Pages**:
- `/dashboard`: Strategic KPIs, charts, activity timeline, top-3 risk summary.
- `/today`: Actionable inbox with KPI strip, overdue receipts, renewals, overdue tasks, and commissions.
- `/receipts`: Unified financial page with tabs for `cobrar` (open receipts grouped by due date with `QuickPaymentDialog`) and `historico` (payment history).
- `/risks`: Unified quality page with tabs for `hallazgos` (risk detection via `risk-engine`) and `completitud` (data quality scoring via `data-quality.ts`).
Tabs sync with the URL using `UrlTabs` and `router.replace({ scroll: false })`.

**Legacy URL Redirects**: `/payments` redirects to `/receipts?tab=cobrar`, `/payments/new` to `/receipts?tab=cobrar`, and `/data-quality` to `/risks?tab=completitud`.

### Authentication & Audit
- **Login**: `/login` page (server action `loginAction`) authenticates against `User` table. Passwords stored as `scrypt$<salt>$<hash>`. Inactive users and the system user (`SYSTEM_USER_ID`) cannot log in. Successful logins update `User.lastLoginAt` and write a `USER_LOGIN` audit entry.
- **Sessions**: Stateless HMAC-signed token (`SHA-256`, edge-safe Web Crypto in `src/lib/session.ts`) stored in `pd_session` httpOnly cookie (30-day TTL). The session payload includes `role` but is **not trusted** for authorization: the dashboard layout calls `requireUserOrRedirect()` which re-reads the user from the database on every request, so deactivations and role changes apply immediately (no need to wait for the token to expire). Secret comes from `SESSION_SECRET` env var in production (required, ≥32 chars, not the dev fallback — no fallback to `AUTH_SECRET` in production). In development `SESSION_SECRET` or `AUTH_SECRET` are accepted; the dev default is used if neither is set. — `instrumentation.ts` calls `assertSessionSecretAvailable()` so the server fails fast on misconfiguration.
- **Middleware**: `src/middleware.ts` redirects unauthenticated requests on any non-public path to `/login?redirect=...`. Public prefixes: `/login`, `/api/auth`, `/_next`, `/favicon`, `/public`.
- **Logout**: `POST /api/auth/logout` clears the cookie and redirects to `/login`.

### Roles (Administrador / Agente)
- `User.role` (`UserRole` enum: `ADMIN` / `AGENT`) and `User.active` flag (added in migration `20260503180000_user_roles`). Existing users were promoted to `ADMIN` on migration. Indexed on `role` and `active`.
- `requireUser()` and `requireAdmin()` helpers in `src/lib/auth.ts` throw `AuthError` (401/403). Server actions catch `AuthError` and surface friendly Spanish errors via `errorResult()`.
- **Admin-only**: deletes (`deleteClient`, `deletePolicy`, `deleteReceipt`, `deleteInsurer`), `updateSettings`, backups (`createBackup`, `restoreBackup`, `listBackupsAction`, `GET /api/backups/[filename]/download`), the activity audit page (`/activity`), and user administration (`/settings/users`).
- **Agent-safe UI**: delete buttons on detail pages (`clients/[id]`, `policies/[id]`, `receipts/[id]`, `insurers/[id]`) are hidden for `AGENT`. Sidebar hides `Usuarios` and `Auditoría` entries via the `isAdmin` prop. The user menu renders the role next to the email.
- **User administration** (`/settings/users`): list users, invite (auto-generates a 10-char alphanumeric temp password shown once in a dialog), change role, activate/deactivate, reset password. Guards: cannot remove the last active admin, cannot deactivate yourself, cannot change your own role if you are the last admin. Every change writes to `ActivityLog` with `entityType="User"`.
- **Self-service** (`/settings/account`): change own password (8 chars min, must mix letters and numbers, must differ from current).
- **Seeded users**: `admin@policydesk.local` / `admin1234` (ADMIN), `pedroagl93@gmail.com` / `Peter@123` (ADMIN), `broker@policydesk.local` / `broker1234` (AGENT).
- **Per-user audit**: 8 entities (`Client`, `Policy`, `Receipt`, `Payment`, `Claim`, `Quote`, `Task`, `Document`) have `createdById` + `updatedById` FK columns to `User`. Server actions stamp these via `getCurrentUserId()`. `ActivityLog.userId` is non-null and is set automatically via `getCurrentUserIdOrSystem()` in `src/lib/activity-log.ts`.
- **Detail pages**: render `<AuditByline createdById={...} updatedById={...} />` to show "Creado por X / Última edición por Y".
- **Topbar**: `<UserMenu />` server component shows session name/email + a logout button.
- **System user**: `system-user-0000` ("Sistema") owns all historic/seed/script-imported records.
- **Seeded users** (created by `npm run db:seed`): `admin@policydesk.local` / `admin1234`, `broker@policydesk.local` / `broker1234`.

### Backend
- **Runtime**: Next.js Server Components and Server Actions (`"use server"`).
- **API routes**: Located under `src/app/api/`.
- **Database Access**: Exclusively via `src/lib/db.ts` which provides a singleton `PrismaClient` using the `better-sqlite3` adapter.
- **Business Logic Modules** (`src/lib/`): Include modules for dashboard data (`dashboard-queries.ts`), portfolio metrics (`portfolio-queries.ts`), list queries (`list-queries.ts`), deterministic risk detection (`risk-engine.ts`), data quality scoring (`data-quality.ts`), activity logging (`activity-log.ts`), commission calculations (`commissions.ts`), renewal reminders (`renewals.ts`), database backup (`backup.ts`), global search (`search.ts`), system settings (`settings.ts`), CSV/XLSX export (`export.ts`), Zod schemas (`validations.ts`), and various utility functions.

### Database
- **Engine**: SQLite via `better-sqlite3`.
- **ORM**: Prisma with `@prisma/adapter-better-sqlite3`.
- **Schema**: `prisma/schema.prisma`.
- **Migrations**: `prisma/migrations/`.
- **Database File**: `data/pg.sqlite`.
- **Seed**: `prisma/seed.ts` for realistic demo data.
- **Schema changes flow**: When editing `prisma/schema.prisma`, always create a migration with `npx prisma migrate dev --name <descripcion>` and commit it together with the schema. Never modify only the schema. The post-merge script runs `npm run db:check-drift` (`prisma migrate diff --exit-code`) and the merge fails if `schema.prisma` defines anything that no migration creates.

**Core Entities**: Client, Insurer, Policy (various types), Receipt, Payment, Commission, Task, Claim, Quote, Document, ActivityLog, SystemSetting, Alert.

**File Storage**: Local filesystem under `data/documents/`, with path safety enforced by `assertSafeDocumentPath()` in `src/lib/files.ts`.

### Testing (Playwright)
Playwright specs viven en `tests/` (`tests/api/`, `tests/e2e/`, helpers compartidos en `tests/helpers/`). Para que el loader de Playwright cargue el cliente Prisma generado (que usa `import.meta.url` y export ESM), dos archivos `package.json` marcan ámbitos como ES modules sin convertir todo el proyecto a ESM:
- `tests/package.json` con `{"type":"module"}` → los specs y helpers se transpilan como ESM.
- `src/generated/prisma/package.json` con `{"type":"module"}` → el cliente generado se carga como ESM (Next.js sigue usándolo igual). Aunque `src/generated/prisma/` está en `.gitignore`, este archivo se trackea vía la excepción `!/src/generated/prisma/package.json`. Además `npm run db:generate` y `scripts/post-merge.sh` lo recrean automáticamente tras `prisma generate`, por si el generador lo sobrescribe.
Comandos: `npm test` (todos), `npm run test:api`, `npm run test:e2e`. Los specs requieren que el dev server esté disponible en `PORT` (default 5000); `playwright.config.ts` lo levanta con `webServer.reuseExistingServer: true`.

### CLI Scripts
Scripts located in `scripts/` are run directly with `tsx` and share utilities via `scripts/_shared.ts`. Key scripts include `backup-db.ts`, `list-next-payments.ts`, `list-renewals.ts`, `list-open-tasks.ts`, various export scripts (`export-due-payments.ts`, `export-commissions.ts`), `validate-data-quality.ts`, import scripts (`import-client.ts`, `import-policy.ts`, `import-pdfs.ts`), and `seed-demo-data.ts`.
**Script Rules**: All database interactions must use Prisma, mass writes require prior backup, imports need Zod validation, dry-run support, change reports, and `ActivityLog` entries, and exports go to `data/exports/`.

### Key Architectural Decisions
- **Database**: Local SQLite for a local-first, no-cloud approach.
- **ORM**: Prisma for type safety and unified database interaction.
- **Rendering**: Server Components + Server Actions for minimal client-side JavaScript.
- **Validation**: Zod for consistent schema validation across forms and scripts.
- **Document Storage**: `data/documents/` for security of sensitive data.
- **No AI in MVP**: All logic is deterministic rules-based.
- **Backup**: File copy before destructive operations for data safety.

## External Dependencies

### npm Packages
- `next` (~16.x): Application framework.
- `@prisma/client`, `@prisma/adapter-better-sqlite3`, `better-sqlite3`: ORM and SQLite driver.
- `tailwindcss` v4, `tw-animate-css`, `shadcn`, Radix UI: Styling and UI components.
- `@tanstack/react-table`: Data tables.
- `react-hook-form`, `@hookform/resolvers`, `zod` v4: Form management and validation.
- `recharts`: Charting library.
- `framer-motion`: Animations.
- `date-fns` v4: Date utilities.
- `lucide-react`: Icons.
- `sonner`: Toast notifications.
- `xlsx`: Excel/CSV export functionality.
- `next-themes`: Theme switching.
- `cmdk`: Command menu primitive.

### No External Services in MVP
The MVP explicitly avoids cloud databases, authentication services, AI/LLM APIs, email/SMS services, and payment processors.

### Development Tooling
- `tsx`: For running TypeScript scripts.
- `prisma` CLI: For migrations and code generation.
- `eslint`: For linting.
- `@tailwindcss/postcss`: Tailwind PostCSS integration.