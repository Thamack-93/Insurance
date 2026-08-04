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
`src/lib/tenant-organization-foundation.ts`. `User`,
`OrganizationMembership`, and global `SystemSetting` are classified separately;
every other current model is protected and must have both `organizationId` and
its named transition trigger.

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
an explicit production override. The transaction takes one advisory lock,
updates historical nulls, creates idempotent memberships, validates the
bootstrap state, and changes `BOOTSTRAP` to `ACTIVE` last. Any failure rolls
back all writes; new writes remain protected by the triggers.

Restore uses `session_replication_role = replica` only inside its restore
transaction. Normal triggers therefore do not generate memberships or rewrite
backup rows; after returning to `origin`, the restore runs the tenant audit.
Older backups without the organization tables/columns remain
`BACKUP_SCHEMA_INCOMPATIBLE` and must be restored with their compatible schema,
then migrated, backfilled, audited, re-backed-up, and drilled again.

Do not remove the singleton index, bootstrap deletion guard, assignment
triggers, or User/membership synchronization until explicit tenant context is
deployed for all writes and reads, `check:tenant-write-scope` and the two-
organization isolation suite pass, and a two-organization restore drill passes.
The removal migration must drop the temporary guards before allowing a second
organization.
