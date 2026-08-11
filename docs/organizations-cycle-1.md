# Organizations — Cycle 1 transition barrier

Cycle 1 adds `Organization` and `OrganizationMembership` without changing the
current `User.role` session or portfolio authorization model. The SQL migration
creates the deterministic bootstrap row `org_legacy_singleton_0001` in
`BOOTSTRAP` status, a unique expression index that permits exactly one
organization, row/truncate guards for that bootstrap row, and normal PostgreSQL
triggers that assign that organization to new tenant rows.

This cycle deliberately does not use a Prisma extension, session organization
context, per-write application changes, tenant selection, or a second
organization.

The triggers and functions are intentionally not represented in Prisma Schema.
They live in `prisma/migrations/20260803000000_organization_transition/migration.sql`.
Inspect them with `pg_proc`, `pg_trigger`, and `pg_indexes`, or run
`npm run check:tenant-guards` and `npm run check:tenant-backfill`.

The protected-table inventory is explicit in
`src/lib/tenant-organization-foundation.ts` and has three classifications:
protected tenant tables (nullable `organizationId` plus assignment trigger),
platform-global tables (`NotificationChannel` and `TelegramWebhookUpdate` among
them), and `SecurityEventAggregate`, which keeps optional organization
attribution but is never backfilled or auto-tagged. Every new model must be
classified; CI rejects an unclassified model or a protected table without its
column, index, FK and named trigger. Concrete tenant FKs are audited in Cycle
1; polymorphic references (for example WorkItem entity payloads and serialized
import targets) are documented debt and are not enforced until tenant context
is explicit.

Run a read-only preview first:

```bash
LEGACY_ORGANIZATION_NAME='...' \
LEGACY_ORGANIZATION_SLUG='...' \
LEGACY_ORGANIZATION_TIME_ZONE='...' \
LEGACY_ORGANIZATION_DEFAULT_CURRENCY='MXN' \
LEGACY_ORGANIZATION_OWNER_EMAIL='owner@example.com' \
npm run backfill:organizations -- --json
```

Apply requires a direct administrative `DATABASE_URL_UNPOOLED` connection and
an explicit production override. Inputs are validated before the transaction:
non-empty name up to 120 characters, kebab-case slug of 3–63 characters,
uppercase ISO currency, an IANA timezone, and an active legacy ADMIN Owner.
Preview uses `REPEATABLE READ READ ONLY` without locks. Apply uses a 30-second
advisory-lock timeout and five-minute statement timeout, then takes row locks,
updates historical nulls, creates idempotent memberships, validates the
bootstrap state, and changes `BOOTSTRAP` to `ACTIVE` last. Any failure rolls
back all writes; new writes remain protected by the triggers.

Restore uses `session_replication_role = replica` only inside its restore
transaction. Normal triggers therefore do not generate memberships or rewrite
backup rows; after returning to `origin`, the restore runs the tenant audit.
`DeploymentIdentity` is a separate environment-local safety control. It is
excluded from business backups, validated independently before restore writes,
and never assigns or filters `organizationId`.
Older backups without the organization tables/columns remain
`BACKUP_SCHEMA_INCOMPATIBLE` and must be restored with their compatible schema,
then migrated, backfilled, audited, re-backed-up, and drilled again.

Do not remove the singleton index, bootstrap deletion guard, assignment
triggers, or User/membership synchronization until explicit tenant context is
deployed for all writes and reads, `check:tenant-write-scope` and the two-
organization isolation suite pass, and a two-organization restore drill passes.
The removal migration must drop the temporary guards before allowing a second
organization.
