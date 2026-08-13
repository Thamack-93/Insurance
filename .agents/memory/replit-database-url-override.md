---
name: Replit DATABASE_URL override quirk
description: Replit injects its own DATABASE_URL into the runtime, silently overriding .env.local and pointing apps at the platform's local Postgres instead of the intended hosted DB.
---

In this Replit environment, `process.env.DATABASE_URL` is pre-populated by the platform with a local managed Postgres. The app's `.env.local` loader skips keys already present in `process.env`, so an external database URL placed in `.env.local` under the `DATABASE_URL` key is silently ignored — the app talks to the empty local Postgres instead. The failure mode looks exactly like bad credentials or a broken app, with no error pointing at the real cause.

**Why:** Cost a full debugging session; queries and auth "fail" while the external database itself is perfectly fine.

**How to apply:** When the app must use an external database, store its URL under a platform-unmanaged key (this project uses `DATABASE_URL_UNPOOLED`) and read that key before `DATABASE_URL` in both Prisma config and the runtime DB module. If auth or queries mysteriously fail while the data looks correct, check the effective `DATABASE_URL` in the running process first.
