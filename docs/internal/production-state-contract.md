# PolicyDesk Production State Contract

This document describes the state that the read-only `verify:production` command
expects today. It is an operational contract, not a product feature flag.

## Current state

- Tenant mode is `single-org`.
- Production contains exactly one active organization.
- The Cycle 1 singleton barrier remains present.
- Multi-org cutover has not been executed.
- RLS is not activated; `DISABLED` is reported as an informational warning.
- Protected tenant attribution and tenant relationship audits must pass.
- All repository Prisma migrations must be finished and present in
  `_prisma_migrations`.
- At least one `GENERAL ACTIVE` Nora knowledge source is required. Its chunks,
  manifest integrity and effective dates must be valid.
- INTERNAL knowledge is counted by organization without exposing content.
- Platform billing tables may be empty. Billing mutations remain disabled unless
  an explicitly guarded operational action enables them.
- Backup metadata is checked through the catalog only. Normal verification never
  downloads, decrypts or restores a backup.
- Nora agent activation is explicit; repository capability does not prove
  Production activation.

The verifier uses `PRODUCTION_EXPECTED_TENANT_MODE=single-org` by default. The
value `multi-org` is reserved for a separately authorized cutover state. In that
mode, at least two organizations, removal of the singleton barrier, complete RLS
coverage and the multi-organization audit are required.

## Result contract

`npm run verify:production` returns one of:

- `PASS`: no warnings or blockers.
- `WARN`: verification completed, but an informational condition remains. The
  command exits zero.
- `BLOCKED`: Production cannot be certified. The command exits non-zero.

Typical singleton warnings are RLS `DISABLED` and an empty backup catalog. An
empty GENERAL knowledge set, failed or pending migration, tenant inconsistency,
knowledge corruption, unsafe billing record or unreadable database is
`BLOCKED`.

## Read-only and sanitized evidence

The verifier uses one PostgreSQL `REPEATABLE READ READ ONLY` transaction and
rolls it back. It never runs `prisma migrate deploy`, seed commands, restore
commands or application mutations. JSON output contains counts, statuses and
sanitized issue codes only; it does not contain credentials, customer data,
policy numbers, backup URLs, encryption keys or Nora content.

The manually invoked Release Certification workflow keeps code certification,
disposable PostgreSQL evidence and Production state verification as separate
sections. Production verification requires an explicitly authorized GitHub
Environment and a read-only database credential. That environment should
provide `NORA_AGENT_MODE` and `PLATFORM_BILLING_MUTATIONS_ENABLED` as variables
copied from the authorized Production configuration. If either is absent, the
report must say that the configuration was not explicitly evidenced; it must
not infer deployed state from repository defaults.
