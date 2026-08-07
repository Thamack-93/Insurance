# Memory Index

- [Replit DATABASE_URL override quirk](replit-database-url-override.md) — Replit injects its own DATABASE_URL (local helium Postgres) into the runtime, silently overriding .env.local; app code must prefer DATABASE_URL_UNPOOLED.
- [PolicyDesk design direction](policydesk-design-direction.md) — the UI is a teal-sidebar analytics dashboard (user-approved reference); do not reintroduce navy/cyan, forest/bronze, white+cobalt, or cream/terracotta editorial looks (all rejected).
- [PolicyDesk radius & type scale](policydesk-design-tokens.md) — four radius steps (4/8/12/full) keyed to nested-item/control/container/pill; body is 15px and `text-sm` belongs on tables, never on container surfaces.
- [Theme-dependent UI must be hydration-guarded](policydesk-theme-hydration.md) — next-themes resolves on the client's first render here, so any theme-derived text mismatches SSR unless gated.
- [Do not run auto-formatters on PolicyDesk](policydesk-formatting.md) — neither prettier nor `prisma format`; both rewrite thousands of unrelated lines. Use targeted edits and eslint.
- [PolicyDesk status vocabulary](policydesk-status-labels.md) — EXPIRED is "Expirado/a", never "Vencida" (that's OVERDUE); status.ts is the only place labels may be defined; enum columns need `::text` in raw SQL.
- [PolicyDesk Replit Setup Quirks](policydesk-replit-setup.md) — Node 22 required (Node 20 ships corrupt @next/swc); lucide-react must be imported via @/components/icons in Server Components; allowedDevOrigins needs *.picard.replit.dev.
- [The UI kit is Base UI, not Radix](policydesk-baseui-primitives.md) — no `asChild` (use `render`), menu labels need a group, and `Select` shows the raw value unless given `items`.
- [PolicyDesk chart conventions](policydesk-chart-primitives.md) — charts use the shared primitives, never encode by hue alone, and keep sr summaries/empty states outside `role="img"`.
- [PolicyDesk table & export architecture](policydesk-table-export-architecture.md) — real screens use the server table stack, not DataTable; pages/exports/bulk share filter builders and resolve portfolio scope server-side.
- [Resolved outcomes are derived, not stored](policydesk-derived-vs-stored-state.md) — a board/list control may write intermediate states only; terminal ones come from the flow that produces them, and their reminders must be reconciled.
- [Verifying authenticated PolicyDesk screens](policydesk-local-auth-verification.md) — mint a pd_session cookie to curl dashboard routes; dev db has no AGENT user, so role-scoping bugs stay invisible by hand.
