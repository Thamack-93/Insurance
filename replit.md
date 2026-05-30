# PolicyDesk

PolicyDesk is a live-first CRM/dashboard for insurance operations. The app runs on Next.js App Router with Prisma and Postgres hosted in production.

## Overview

The core operational flow is:
`Client → Policy → Receipt → Payment → Commission → WorkItem → Document → ActivityLog → Risk`

The system is designed for agents to manage portfolio activity, renewals, payments, risks, and auditability from one interface.

## Product focus

- Strategic dashboard and daily agenda
- Client and policy management
- Receipts, payments, and commissions
- WorkItem-based operational follow-up
- Deterministic risk and data-quality checks
- Audit trail through ActivityLog
- Documents as metadata in this phase

## Architecture

### Frontend
- Next.js App Router with TypeScript.
- Tailwind CSS v4 and shadcn/ui.
- React Hook Form + Zod for forms and validation.
- TanStack Table, Recharts, Lucide, Sonner, Framer Motion.

### Auth and roles
- Custom signed-cookie auth.
- Server-side validation on every request.
- Roles: `ADMIN` and `AGENT`.
- Layout and route guards re-read the user from the database to keep access current.

### Backend
- Server Components and Server Actions.
- API routes under `src/app/api/`.
- Prisma as the only data access layer.
- Shared business logic modules under `src/lib/`.

### Data model
- Core models: `User`, `Client`, `Insurer`, `Policy`, `Receipt`, `Payment`, `Commission`, `Claim`, `Quote`, `Document`, `ActivityLog`, `SystemSetting`, `WorkItem`.
- Legacy compatibility models: `Task`, `Alert`.
- `Reminder` is no longer part of the operational flow.
- `Policy.endDate` is the canonical renewal date; renewal status is derived from it plus open WorkItems.

## File storage

Document storage is handled by the application layer for this phase and is not part of the public product narrative.

## Scripts

Scripts in `scripts/` use Prisma and shared helpers. Mass writes require prior backup, validation, and an audit trail.

Key scripts include backups, data validation, renewals, open work item listings, and exports.

## Testing

Playwright specs live in `tests/`. They cover API and end-to-end flows for the live app.

## Deployment posture

PolicyDesk is deployed toward Vercel with hosted Postgres. The public/demo deployment uses the live database and stays focused on the hosted runtime.

## Operational principles

- Keep `WorkItem` as the source of truth for operational follow-up.
- Avoid introducing parallel task/reminder systems.
- Keep all write actions auditable.
- Preserve live-first architecture.
