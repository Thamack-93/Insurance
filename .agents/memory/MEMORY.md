# Memory Index

- [Replit DATABASE_URL override quirk](replit-database-url-override.md) — Replit injects its own DATABASE_URL (local helium Postgres) into the runtime, silently overriding .env.local; app code must prefer DATABASE_URL_UNPOOLED.
- [PolicyDesk design direction](policydesk-design-direction.md) — the UI is a teal-sidebar analytics dashboard (user-approved reference); do not reintroduce navy/cyan, forest/bronze, white+cobalt, or cream/terracotta editorial looks (all rejected).
- [PolicyDesk Replit Setup Quirks](policydesk-replit-setup.md) — Node 22 required (Node 20 ships corrupt @next/swc); lucide-react must be imported via @/components/icons in Server Components; allowedDevOrigins needs *.picard.replit.dev.
