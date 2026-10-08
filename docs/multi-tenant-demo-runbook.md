# Multi-tenant and DEMO operating runbook

This runbook is the release boundary for PolicyDesk's shared Neon/Vercel
multi-tenant deployment. A second production organization must not be created
until the tenant transaction layer, exact-role RLS tests, backup drill, and
production verifier all pass.

## Database roles and environment

- `DATABASE_URL`: pooled Neon URL for the application runtime, using the
  restricted `TENANT_RLS_APP_ROLE` credential.
- `DATABASE_ADMIN_URL`: direct Neon URL for migrations, cutover, restore, and
  operator backup work. It is never a runtime fallback.
- `PRODUCTION_READONLY_DATABASE_URL`: direct read-only verifier URL.
- `PRODUCTION_READONLY_ROLE`: `current_user` for that verifier connection;
  it must be non-owner, non-superuser, and non-`BYPASSRLS`.
- `TENANT_RLS_APP_ROLE`: expected non-owner, non-superuser, non-`BYPASSRLS`
  runtime login role (default `policydesk_app`; created and hardened by the
  direct operator preflight, with its managed password/credential set outside
  Prisma migrations).
- `TENANT_RLS_PLATFORM_OWNER_ROLE`: non-login owner for the narrowly scoped
  platform aggregate (defaults to `policydesk_platform_owner`).
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: mandatory in
  production; missing or unavailable Redis fails closed for rate limits and
  distributed locks.
- `BLOB_READ_WRITE_TOKEN`: required for customer document uploads; it does not
  enable real uploads for DEMO organizations.
- `PLATFORM_ORG_PROVISIONING_ENABLED=1`: explicit operator switch, enabled only
  after the multi-org cutover evidence is archived.
- `PLATFORM_CUSTOMER_PROVISIONING_ENABLED=0`: remains disabled during Stage 3;
  enabling the DEMO factory must not accidentally expose paid CUSTOMER
  creation before the commercial onboarding release.
- `PLATFORM_EMAIL_ENABLED=0|1`: global email kill switch for the future email
  provider; tenant capabilities can never override an explicit `0`.

## Cutover sequence

`maintenance:enter` and `cutover:multi-org` pin non-test execution to the
allowlisted Production Neon identity in `scripts/cutover-target.mjs`:
project `bitter-frost-67704350`, branch `br-fancy-wildflower-apfbks1o`,
database `neondb`, and direct host
`ep-withered-hall-ap9wt7s5.c-7.us-east-1.aws.neon.tech`. Set
`NEON_PROJECT_ID=bitter-frost-67704350` and
`TENANT_ISOLATION_BRANCH_ID=br-fancy-wildflower-apfbks1o` in the operator
environment when running Production maintenance/cutover. Those values are
checked against the fixed allowlist; the branch ID is also bound to its
expected direct endpoint host. The connection URL itself must match the
expected host and database, and pooler URLs are rejected. Test-mode execution
also requires a loopback host before the strict CI certification guard runs.
CI continues to use the independent
`assertDisposableCertificationTarget` guard for disposable test databases.
Run the local guard regression with `npm run test:cutover-target`.

1. Repair the read-only verifier target and capture a clean singleton audit.
2. Deploy the tenant-aware application while RLS is still disabled.
3. Create a disposable Neon branch from production. Apply the additive
   migration, provision two organizations and multiple users, and run:
   `TENANT_ISOLATION_TEST_DB=1 PLAYWRIGHT_ENFORCE_DISPOSABLE_DB=1 npm run
   test:tenant-rls`.
   Remote certification additionally requires `NODE_ENV=test`,
   `TENANT_ISOLATION_REMOTE_BRANCH=1`, an exact
   `cert-stage3-<sha>` branch name, branch ID, direct endpoint host, database,
   run ID and the SHA-256 fingerprint calculated by
   `tenant-certification-target.mjs`. The guard rejects `main`, Vercel
   Production/Preview, a mismatched endpoint and an app-role URL. The runtime
   exact-role test uses the corresponding pooled host; migrations and
   maintenance use only the direct administrative host.
4. Run the complete static gates (`check:tenant-read-scope`,
   `check:tenant-write-scope`, route/action inventories, inventory/backfill
   checks), browser E2E, and the encrypted backup restore drill on a temporary
   branch.
5. Stop tenant mutations and scheduled business jobs, drain writes, and set
   `PlatformRuntimeState.writeMode = 'MAINTENANCE'` with the administrative
   connection.
6. Run `ENABLE_TENANT_RLS_CUTOVER=1 npm run cutover:multi-org`. The wrapper
   invokes `npm run prepare:tenant-roles` over `DATABASE_ADMIN_URL` before
   applying the committed `20260831010000_multi_tenant_rls_cutover` migration;
   role DDL is deliberately not embedded in Prisma's transactional migrations.
   The migration refuses to run while the write mode is `OPEN` and leaves the
   platform in maintenance mode.
7. Switch and verify the pooled runtime credential. Run
   `npm run verify:production` with `PRODUCTION_EXPECTED_TENANT_MODE=multi-org`
   and set `ENABLE_TENANT_RLS_CUTOVER=1` in the runtime deployment so platform
   aggregates use the approved SECURITY DEFINER path. Then run application
   smoke, exports/search/Nora checks, Prisma drift, and backup compatibility
   checks.
8. Exit maintenance only after every check is archived against the deployed
   SHA. If anything fails before a second organization exists, keep maintenance
   active and use the tested rollback migration. After multiple organizations
   exist, suspend affected organizations and forward-fix; never deploy the old
   singleton application.

The static read/write inventories are necessary CI gates, not a substitute for
the transaction boundary. The current rollout report still contains legacy
root-`getDb()` call sites; `check:tenant-dal:strict` must be green (with every
protected read inside `withTenantTransaction` or an explicitly enumerated
system tenant transaction) before the final RLS migration is allowed to reach
   production.

### Independent restore certification target

The restore target is a separate temporary Neon branch named exactly
`restore-cert-stage3-<full 40-character candidate SHA>`. It must have its own
branch ID and endpoint, distinct from the SHA-matched `cert-stage3-<SHA>`
source. Do not use `main`, a Vercel database, or a source clone containing
customer tables. The target project's main branch must have zero public tables
before creating this temporary target; the preparation CLI accepts either an
empty target or a same-identity marked target for an interrupted-run resume.

After the root operator has created and independently verified that temporary
target, provide `RESTORE_SOURCE_DATABASE_URL`,
`RESTORE_SOURCE_NEON_BRANCH`, `RESTORE_SOURCE_NEON_BRANCH_ID`,
`RESTORE_SOURCE_NEON_HOST`, and `RESTORE_SOURCE_FINGERPRINT`; provide the
target using `RESTORE_DATABASE_ADMIN_URL`, `RESTORE_NEON_BRANCH`,
`RESTORE_NEON_BRANCH_ID`, `RESTORE_NEON_HOST`, and
`RESTORE_TARGET_FINGERPRINT`. Set `TENANT_ISOLATION_RUN_ID`,
`TENANT_ISOLATION_DB_NAME`, and `TENANT_ISOLATION_REMOTE_BRANCH=1`. These
identities must name distinct source and target endpoints and use matching
SHA-256 fingerprints. The CLI also requires
`NODE_ENV=test`, both disposable-database guards, `ALLOW_TEMPORARY_NEON_RESTORE=true`,
and the exact current `CERTIFICATION_CANDIDATE_SHA`. Run:

```sh
npm run prepare:restore-certification -- --prepare-restore-target
```

Preparation also requires the existing RLS certification inputs: the
administrative target URL, `TENANT_RLS_APP_ROLE`, its password,
`TENANT_RLS_READONLY_PASSWORD`, and the two certification organization IDs.
Keep credentials in the operator's local environment; do not put them in shell
history or reports.

The command validates that the candidate SHA equals `git rev-parse HEAD`,
checks source/target separation and target emptiness/marker identity, then
applies the existing migrations, deterministic tenant fixture, cutover and
RLS certification to the target. It does not create or promote Neon branches.
The target fixture includes `org_pedro_gomez_0001` and deterministic recovery
rows for renewal, cancellation, posted/reversed payment, notifications,
legacy/canonical WorkItems, risk source text, insured object, insured party and
insured asset. Restore certification compares the selected restored values to
the decrypted source backup records as well as validating table counts,
RLS reads, audit and migration drift. The organization backup command remains
source-only and cannot be run against this restore-purpose target.

This preparation is not evidence that a restore passed. A separately
authorized operator must still select the verified source artifact and run the
existing CLI-only restore drill against this target; archive its exact-SHA
report and certificate. No Production restore is permitted.

## DEMO provisioning and reset

For the current external-demo acceptance, provision one organization and one
user, using the existing URL and versioned synthetic seed. This is an
operational delivery choice, not a global one-user cap: the platform factory
supports multiple users. Temporary passwords expire in 24 hours and require a
first-login change; alias users have no email recovery.

DEMO documents are synthetic downloads only. Real document uploads and imports
are blocked. Nora, email, Telegram, WhatsApp, Quálitas and other provider
actions remain disabled for DEMO even if a capability row or environment
setting is permissive. The WhatsApp preview is local text only; it does not
open an application or send anything. Do not describe uploads, Nora, or
provider actions as available DEMO workflows.

Reset marks the organization `RESETTING`, denies sessions and jobs, purges any
tenant-prefixed private objects, clears protected rows, reseeds the synthetic
baseline, increments `dataVersion`, verifies invariants, and reactivates. User
and membership records survive; active sessions are revoked. A failed
verification leaves the organization suspended for remediation. The CLI
requires an explicit reason of 8–500 characters for both preview and apply:

```sh
npm run demo:reset -- --organization-id org_demo_x --request-id ticket-123 --reason "preview for acceptance" --dry-run
npm run demo:reset -- --organization-id org_demo_x --request-id ticket-124 --reason "reset after acceptance review"
```

At 30 days the organization is suspended unless a superadmin explicitly
extends the trial. Suspension/revocation and reactivation must be verified as
part of acceptance. Hard deletion is a separate audited operator action.

### Common DEMO acceptance checklist

- [ ] Confirm target is the existing DEMO URL and the sole provisioned
      organization/user for this delivery; confirm `kind=DEMO`, active
      membership, 30-day trial, and current seed version.
- [ ] Sign in with the issued temporary password; confirm forced password
      change. On the disposable acceptance fixture, advance its expiry and
      confirm login rejects the expired temporary credential.
- [ ] Verify seeded clients, policies, receipts, and synthetic documents load;
      edit a seeded customer/policy and confirm the change persists.
- [ ] Verify a synthetic document can be downloaded; upload a real file and
      attempt Nora/provider actions. Confirm rejection and no Blob/provider
      side effect even with permissive capability/environment configuration.
- [ ] Confirm a DEMO user cannot read or mutate a CUSTOMER record or document
      by search, direct ID, export, or API request.
- [ ] Run reset preview with a documented reason and confirm no writes or
      object deletion. Apply reset with a new request ID/reason; verify seed,
      edit removal, session revocation, and audit event. Verify suspension
      denies access and authorized reactivation restores access.
- [ ] Record the deployed commit and the observed browser/API evidence. Local
      tests do not establish Production configuration, real provider/Blob
      behavior, database RLS, or user acceptance.

## Backups and privacy

Platform logical backups include `CUSTOMER`/`LEGACY` organizations and exclude
DEMO organizations, their users/memberships, tenant records, optional control
rows, channels, and settings. Manifests record the exclusion policy and counts;
tenant backup actions are unavailable to DEMO. Restore validation reruns expired
DEMO purging before reopening the environment. Neon point-in-time history is
limited by the configured encrypted retention window and must be disclosed in
the demo privacy notice.

CUSTOMER integrations may use real providers subject to their separate
capability and confirmation controls. DEMO provider actions remain blocked as
described above; a permissive global provider setting cannot enable them.

## Commercial handoff

Customer onboarding remains sales-assisted with manual invoicing. Before a
paying customer is activated, complete email invitations/verification,
password-reset tokens, session/device review and revoke-all-sessions, suspicious
login notifications, privacy/DPA/terms, retention and incident runbooks,
access-review evidence, Mexico-focused legal review, and the documented
residual no-MFA risk acceptance.
