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

## Running on Replit

```bash
npm install
npm run db:generate   # regenerate Prisma client after schema changes
npm run dev           # starts Next.js dev server on port 5000
```

The workflow **Start application** runs `npm run dev -- -p 5000` and serves the app in the preview pane.

### Environment variables (set as Replit Secrets)

| Secret | Notes |
|---|---|
| `DATABASE_URL_UNPOOLED` | External Postgres connection string. Replit injects its own `DATABASE_URL` so this project uses `DATABASE_URL_UNPOOLED` instead. |
| `SESSION_SECRET` | Already configured. |

All other variables (`CRON_SECRET`, `AI_GATEWAY_*`, `BLOB_READ_WRITE_TOKEN`, etc.) are optional for local dev.

### Known setup notes

- **Node.js 22** is required (`nodejs-22` module). Node 20 shipped a corrupted `@next/swc` binary that causes a Bus error on startup.
- `lucide-react` icons must be imported via `@/components/icons` (a `"use client"` re-export wrapper) in Server Components to avoid a Turbopack SSR `createContext` error.
- `allowedDevOrigins` in `next.config.ts` includes `*.picard.replit.dev` and `127.0.0.1` for the Replit preview proxy.

## Deployment posture

PolicyDesk is deployed toward Vercel with hosted Postgres. The public/demo deployment uses the live database and stays focused on the hosted runtime.

## Operational principles

- Keep `WorkItem` as the source of truth for operational follow-up.
- Avoid introducing parallel task/reminder systems.
- Keep all write actions auditable.
- Preserve live-first architecture.
