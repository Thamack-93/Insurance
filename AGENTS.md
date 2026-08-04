<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Disaster-recovery restore drills

- Restore remains CLI-only and may target only an explicitly authorized temporary Neon branch.
- Never restore to production or create/promote/delete Neon branches from application code.
- A cryptographically valid backup is not recoverable evidence until table counts, foreign keys, PolicyDesk invariants, WorkItem compatibility and application reads pass.
- Keep `RESTORE_DRILL_APP_SMOKE=0` unless an operator explicitly enables the opt-in smoke against a disposable target.
- A restore drill must validate counts, public foreign keys, Payment `POSTED`/`REVERSED` lifecycle, Policy/Receipt cancellation and renewal invariants, Notification user references, WorkItem canonical and legacy references, sequences, application reads and Prisma drift before reporting `PASS`.
- `session_replication_role = replica` is limited to the restore transaction; restore it to `origin` before validation and roll back on every validation failure.

## Cycle 1 organization transition

- The temporary singleton barrier lives only in `20260803000000_organization_transition` SQL: normal PostgreSQL triggers, never `ENABLE ALWAYS`, and never a Prisma extension.
- `PROTECTED_TENANT_TABLES`, `OPTIONAL_ORGANIZATION_TABLES`, and `PLATFORM_GLOBAL_TABLES` in `src/lib/tenant-organization-foundation.ts` are the source inventory. Do not add an unclassified model or a protected model without its nullable column, FK, index, trigger, audit coverage, and CI check.
- `NotificationChannel` and `TelegramWebhookUpdate` are platform-global. `SecurityEventAggregate.organizationId` is optional attribution and must not be auto-assigned or backfilled.
- The bootstrap organization is intentionally singleton. Do not remove the singleton index, deletion guard, assignment triggers, or legacy User-to-membership synchronization until the explicit tenant-context rollout and two-organization validation criteria are complete.
- Restore runs with `session_replication_role = replica`, so normal transition triggers preserve backup values. After returning to `origin`, `check:tenant-backfill` must pass, including trigger/index and membership-consistency audit.

## Global platform administration

- `User.platformRole` is limited to `NONE` or `SUPERADMIN`; it is not a tenant role and does not grant an implicit organization context.
- `/platform` is the only global operator surface. SUPERADMIN actions must use explicit organization IDs, never edit operational tenant records directly, and always write an `ActivityLog` entry.
- SUPERADMIN accounts do not receive legacy tenant memberships. The Cycle 1 User sync trigger must keep this exemption until the singleton barrier is retired.
- `Plan`, `OrganizationSubscription`, and `BillingCharge` are classified platform-billing models with explicit organization scope; amounts are minor units and totals never mix currencies.
- Do not run `provision-platform-admin -- --apply` or `split:pedro-organization -- --apply` without explicit operator authorization. Pedro's organization remains blocked while the singleton index and guards exist.
