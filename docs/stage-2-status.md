# Stage 2 release status

This commit ships the shared tenant-context foundation, additive schema/RLS
cutover migrations, exact-role certification workflow, and the platform-only
DEMO operator console. Production remains in singleton mode.

## Verified locally

- `npm run build`
- `npm run typecheck`
- `npm run lint`
- `npm run test:unit` (529 passed, 11 skipped)
- `npm run check:tenant-read-scope`
- `npm run check:tenant-write-scope`
- `npm run check:api-security`
- `npm run check:server-actions`
- `npm run check:tenant-dal` and `npm run check:tenant-dal:strict` (98 protected modules classified; 0 direct root `getDb()` callers)
- `npx prisma validate`
- `git diff --check`

## Blocking certification evidence

- `npm run test:tenant-rls`, browser isolation E2E, migration drift, and the
  database backup/restore drill require the disposable PostgreSQL CI environment
  and were not run against local or production credentials. The exact-role test
  now starts cleanly and fails closed when no disposable PostgreSQL target is
  configured (`connect EPERM 127.0.0.1:5432`); the local drift command reports
  the same unavailable-target condition. No production database was contacted.
- Telegram's linked webhook path now resolves global channel metadata first and
  runs the protected helper graph inside one explicit system-tenant
  transaction. Unlinked `/link` and help handling remains platform-global.

Do not enable `PLATFORM_ORG_PROVISIONING_ENABLED` or create a second production
organization until the strict DAL check, exact-role RLS suite, browser suite,
backup drill, and production verifier all pass and their evidence is archived
against the deployed commit SHA.
