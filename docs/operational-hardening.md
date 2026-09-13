# Operational hardening

This document is the release gate for the completion work. It records the operational decisions that are easy to lose when a feature is rolled back or a new worker is added.

## Retention, deletion, and legal hold

- Financial statements, statement rows, reconciliation decisions, correction chains, ActivityLog entries, and payment records are retained for the organization’s accounting retention period. They are append-only after approval.
- Quote source files and extraction evidence follow the document retention policy. A delete or export request removes or exports the tenant reference and metadata only when no legal hold, financial evidence, or audit dependency blocks it.
- Legal hold is represented by an administrative retention flag before a destructive request is executed. Held documents and evidence remain downloadable only to authorized internal roles.
- Logs and monitoring payloads use IDs, status, counts, durations, and redacted error classes. They must not include tokens, document contents, customer phone numbers, or raw extracted financial data.

## Contracts and compatibility

- New Route Handlers are versioned under `/api/v1/`; compatibility aliases may remain during a phased rollout.
- Every upload, monitoring, and job handler validates a Zod request contract and returns a documented error code. Server Actions use the same result codes for authorization, validation, version conflict, and unavailable capability.
- Contract tests are required for `{ items, totalCount, nextCursor }`, optimistic-conflict responses, currency-grouped totals, and upload extraction results before a route is enabled for the internal organization.

## Recovery targets and ownership

- Target RPO: 24 hours for database records and 24 hours for attached evidence. Target RTO: 4 hours for an internal restore to a disposable target.
- The owner of a restore drill is the administrator running the CLI command; the reviewer verifies counts, foreign keys, lifecycle invariants, WorkItem references, evidence hashes, application reads, and Prisma drift.
- Restore drills never target production and never enable application smoke unless `RESTORE_DRILL_APP_SMOKE=1` is explicitly set for the disposable target.

## Jobs and incidents

- Jobs are best effort. Each organization run is isolated, bounded to three concurrent workers, recorded in `MaintenanceRun`, and retried by the next scheduled run. Duplicate notifications are prevented by entity, deadline, stage, and recipient keys.
- A failed or missed run is an incident when it remains unresolved after the two-hour threshold. The external GitHub Actions monitor is an independent signal and sends the configured failure webhook without relying on application logging.
- Incident notes must record the deployment SHA, organization scope, job run IDs, observed impact, retry or rollback decision, and recovery evidence.

## CI and release evidence

Each release report separates static checks, disposable PostgreSQL results, browser acceptance, provider extraction evidence, recovery evidence, and production observations. Mocked extraction tests are never presented as provider acceptance. CI must run dependency vulnerability and secret scanning before a release is enabled.
