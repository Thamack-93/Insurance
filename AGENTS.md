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

## Deployment database identity

- `DeploymentIdentity` is environment-local and must never be exported from a business backup or overwritten by restore.
- Runtime uses pooled `DATABASE_URL`; Prisma migrations and identity administration require direct `DATABASE_URL_UNPOOLED`.
- Never infer expected identity from `NODE_ENV`. Require explicit environment plus the deterministic Neon project/branch/database fingerprint.
- A cloned Neon branch inherits the source identity and must fail closed until an operator explicitly rebinds it through the guarded CLI.
- Do not initialize or rebind identity from build, `postinstall`, application startup, proxy/middleware or generic Preview automation.
- The deployment-safety Prisma extension is only a mutation guard. It must never be used to implement tenant organization assignment.

## Cycle 1 organization transition

- The temporary singleton barrier lives only in `20260803000000_organization_transition` SQL: normal PostgreSQL triggers, never `ENABLE ALWAYS`, and never a Prisma extension.
- `PROTECTED_TENANT_TABLES`, `OPTIONAL_ORGANIZATION_TABLES`, and `PLATFORM_GLOBAL_TABLES` in `src/lib/tenant-organization-foundation.ts` are the source inventory. Do not add an unclassified model or a protected model without its nullable column, FK, index, trigger, audit coverage, and CI check.
- `NotificationChannel` and `TelegramWebhookUpdate` are platform-global. `SecurityEventAggregate.organizationId` is optional attribution and must not be auto-assigned or backfilled.
- The bootstrap organization is intentionally singleton. Do not remove the singleton index, deletion guard, assignment triggers, or legacy User-to-membership synchronization until the explicit tenant-context rollout and two-organization validation criteria are complete.
- Restore runs with `session_replication_role = replica`, so normal transition triggers preserve backup values. After returning to `origin`, `check:tenant-backfill` must pass, including trigger/index and membership-consistency audit.
