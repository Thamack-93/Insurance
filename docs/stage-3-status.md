# Stage 3 release status

Stage 3 closes the production-readiness implementation for multi-tenant
isolation, DEMO lifecycle safety, and the operator cutover workflow. Production
is intentionally still singleton until the disposable Neon certification and
the production maintenance window are completed.

## Implemented in this stage

- Versioned DEMO upload hardening migration with validation metadata, terminal
  purge states, deterministic DEMO plan protection, and active-organization kind
  immutability.
- PDF-only validation before Blob persistence or OCR/AI processing for every
  tenant: `%PDF-`/`%%EOF` signature checks, 15 MB and 100-page limits, MIME
  validation, SHA-256 recording, and rejection of active/encrypted/embedded
  PDF features. DEMO uploads additionally enter the purge/reset ledger.
- Opaque tenant-prefixed private Blob paths, no overwrite, `private, no-store`
  downloads, short-lived upload tokens, immediate rejection cleanup, and
  consent text covering authorization, approved AI processing, retention, and
  residual antivirus risk.
- Reset fencing with request IDs, Redis ownership tokens/renewal, data-version
  checks (advanced at reset start and verified again before reactivation),
  non-extendable deadlines, trial/reset race handling, sanitized failure codes,
  and purge attempts that continue for suspended or failed DEMOs.
- Dynamic capability kill switches and synthetic outbound-contact guards for
  email, phone, WhatsApp, and Quálitas destinations. The global email switch is
  present for provider wiring even though PolicyDesk has no email sender in
  this release.
- Telegram linked-webhook execution on one explicit system tenant transaction;
  transaction-bound search, work-item, digest, and notification delivery. The
  notification settings reader no longer masks tenant database failures as a
  fake disconnected channel.
- Cutover wrapper with direct-admin preflight/advisory lock and versioned
  migration as the only schema DDL executor; audited singleton-only break-glass
  rollback; maintenance-entry helper; and exact-role RLS certification with
  pooled-session contamination and concurrent tenant alternation checks.
- Production verifier checks for restricted runtime role, forced RLS, grants,
  privileged functions, DEMO backup exclusion, and platform runtime-state write
  protection.

## Local gates completed

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run test:unit` (including DEMO upload validation)
- Prisma validation and tenant/API/Server Action/activity inventories
- `check:tenant-dal:strict`, `check:tenant-read-scope`, and
  `check:tenant-write-scope`
- `git diff --check`

## Environment-gated evidence still required

The following cannot be honestly marked PASS from this workspace because no
disposable PostgreSQL/Neon branch or production credentials are available:

- `certify:tenant-rls`, including a real `policydesk_app` connection, exact-role
  RLS, pooled concurrency, two-organization browser E2E, and migration drift.
- Encrypted pre-cutover backup, CLI-only restore validation, and DEMO exclusion
  manifest/count verification.
- Production read-only verifier, Vercel runtime credential switch, maintenance
  cutover, rollback/forward-cutover evidence, and first production DEMO.

Paid CUSTOMER provisioning is explicitly gated by
`PLATFORM_CUSTOMER_PROVISIONING_ENABLED=0` during this stage; enabling the DEMO
factory does not create a second CUSTOMER by accident.

The local exact-role/drift commands fail closed when PostgreSQL is unavailable
(`127.0.0.1:5432`); they must run only with
`TENANT_ISOLATION_TEST_DB=1` and `PLAYWRIGHT_ENFORCE_DISPOSABLE_DB=1`.

## Required operator sequence

1. Create a temporary Neon branch from Production and record sanitized
   fingerprints.
2. Apply singleton/additive migrations, create two organizations and users,
   enter maintenance, apply the versioned RLS migration, and run
   `npm run certify:tenant-rls` plus browser certification as the restricted
   app role.
3. Create and restore-verify the encrypted backup on a second temporary branch;
   retain both branches until reports are reviewed.
4. Certify an immutable SHA and Vercel prebuilt deployment, repair the
   read-only target, then perform the production maintenance cutover with
   `DATABASE_ADMIN_URL` only for the direct operational steps.
5. Require `verify:production` to return `PASS` in `multi-org` mode, switch the
   pooled runtime to `policydesk_app`, set `ENABLE_TENANT_RLS_CUTOVER=1` so
   platform aggregates use the approved SECURITY DEFINER path, and archive all
   evidence before enabling `PLATFORM_ORG_PROVISIONING_ENABLED`.
6. Provision exactly one DEMO from `/platform`, display temporary credentials
   once, validate seed/capabilities/backups/retention, rerun the verifier, and
   observe the deployment for at least 24 hours.

After the first production DEMO exists, never deploy the singleton application
again. A DEMO is immutable in kind; commercial conversion creates a clean
CUSTOMER organization and imports only explicitly approved data.
