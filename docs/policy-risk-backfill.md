# Policy risk backfill runbook

The backfill preview contains policy and insured-person data. Keep its JSON
manifest outside the repository with mode `0600`; do not attach it to an issue,
commit it, or paste it into chat.

## Disposable rehearsal

Run the preview against a disposable PostgreSQL database only:

```sh
NODE_ENV=test TENANT_ISOLATION_TEST_DB=1 PLAYWRIGHT_ENFORCE_DISPOSABLE_DB=1 \
  npm run backfill:policy-risk-details -- \
  --organization-id=ORG_ID \
  --report-file=/private/tmp/policy-risk-backfill-preview.json
```

The tool reports the manifest path, candidate SHA, processor digest, and counts.
The manifest includes every policy in that organization whose `riskDetails` is
empty, including every ambiguous case and its source text. Review every row
classified `REVIEW`; set its `decision` to `ACCEPT` only when the proposed
structured value is correct, otherwise set it to `DEFER`. Fill `reviewedBy`
and `reviewedAt` after review. Do not change source or proposal fields: the
preview digest and input hashes make the apply fail closed if source or
proposals drift. After decisions and reviewer attribution are complete, print a
second digest that binds those decisions and review metadata:

```sh
npm run backfill:policy-risk-details -- \
  --organization-id=ORG_ID --print-reviewed-digest \
  --reviewed-report=/private/tmp/policy-risk-backfill-preview.json \
  --reviewed-by=REVIEWER --preview-sha256=SHA_FROM_PREVIEW
```

If any decision, reviewer name, or review timestamp changes, print the reviewed
digest again.

Apply the reviewed report to the same disposable database and exact candidate
revision:

```sh
NODE_ENV=test TENANT_ISOLATION_TEST_DB=1 PLAYWRIGHT_ENFORCE_DISPOSABLE_DB=1 \
  npm run backfill:policy-risk-details -- \
  --organization-id=ORG_ID --apply \
  --reviewed-report=/private/tmp/policy-risk-backfill-preview.json \
  --reviewed-by=REVIEWER --manifest-sha256=REVIEWED_SHA \
  --confirm-apply=APPLY_POLICY_RISK_BACKFILL --batch-size=50
```

The apply is organization-scoped, checks current source hashes again while
locking each policy and its source relations, uses bounded transactions, is
safe to resume from the same reviewed manifest, and writes a private per-policy
outcome report alongside the manifest. It also records run counts and the
manifest digest in `MaintenanceRun`. A changed candidate, processor,
organization, or source row stops before writes. Batches commit independently;
there is no global rollback after earlier batches commit. Recovery is to rerun
the exact reviewed manifest, which validates already-applied rows and resumes
without duplicating relations. Each production batch transaction has a 10 second
connection wait limit and a 30 second execution timeout.

## Optional read-only Production preview

The Production preview is a separate, read-only mode. Supply a dedicated
`policydesk_readonly` connection through `POLICY_RISK_BACKFILL_READONLY_DATABASE_URL`
and set `POLICY_RISK_BACKFILL_READONLY_ROLE=policydesk_readonly`. Do not reuse
`DATABASE_URL` or an owner/application credential. Keep the manifest path
private and outside the repository.

```sh
npm run backfill:policy-risk-details -- \
  --production-preview --organization-id=ORG_ID \
  --report-file=/private/tmp/policy-risk-backfill-preview.json
```

Set these environment variables for the preview process so it can validate
and bind the target identity into the immutable manifest digest:
`POLICY_RISK_BACKFILL_PRODUCTION_HOST` (canonical database host),
`POLICY_RISK_BACKFILL_PRODUCTION_DATABASE` (database name),
`POLICY_RISK_BACKFILL_READONLY_DATABASE_URL`, and
`POLICY_RISK_BACKFILL_READONLY_ROLE=policydesk_readonly`. The apply process
must target the exact same host and database recorded in that reviewed
manifest.

The mode starts one `REPEATABLE READ, READ ONLY` transaction, checks the actual
PostgreSQL role, verifies it has no write privileges on the organization and
policy tables it reads, and scopes every query to the explicit organization ID.
It fails if the organization is not visible through the configured role. The
mode rejects `--apply`; it does not create a Production conversion run or
change any row. The manifest is marked
`PRODUCTION_READ_ONLY_PREVIEW` and cannot be used by the disposable apply path.

## Production apply capability status

The CLI has a separate `--production-apply` path, but it is blocked by default
unless `POLICY_RISK_BACKFILL_PRODUCTION_APPLY_ENABLED=1` is explicitly set.
This switch is a final operational gate, not evidence that the procedure is
certified. Production apply requires a manifest produced by the matching
Production read-only preview, its reviewed digest, the ordinary apply
confirmation, a second Production-specific confirmation, a fixed
`policydesk_backfill` login role, exact expected host and database bindings,
and batches no larger than 50. `--reviewed-by` must be the email of an active
`OWNER` or `ADMIN` member of the selected organization. Every write transaction
locks and revalidates that user, membership, and organization. It rejects Vercel execution, non-Production
environments, non-`verify-full` TLS, role memberships, object ownership,
table-level grants, excess column/sequence/schema privileges, and RLS policies
that differ from the exact tenant `USING` and `WITH CHECK` predicates.

Do not set the feature gate or run Production apply until the disposable
PostgreSQL integration suite has exercised writer-role acceptance and rejection,
RLS isolation, rollback, and exact-manifest resume on this candidate SHA, and a
separate reviewer has approved the final security diff. No Production apply has
been run as part of this implementation.

The writer role uses these exact column privileges; keep its database grants
and the CLI allowlist aligned. `UPDATE(updatedAt)` on the locked tenant rows
permits `SELECT ... FOR UPDATE` while the data columns remain read-only. The
timestamps on `MaintenanceRun` are required by Prisma inserts.

| Table | SELECT | INSERT | UPDATE |
| --- | --- | --- | --- |
| `Organization` | `id, status` | — | `updatedAt` |
| `OrganizationMembership` | `id, organizationId, userId, role, active` | — | `updatedAt` |
| `User` | `id, email, active` | — | `updatedAt` |
| `Policy` | `id, organizationId, policyNumber, policyType, insuredObject, beneficiaryInfo, riskDetails` | — | `riskDetails, insuredObject, riskDetailsReviewRequired, updatedAt` |
| `PolicyInsuredAsset` | `id, organizationId, policyId, assetType, description, serialNumber, isPrimary, createdAt, updatedAt` | same as SELECT | `updatedAt` |
| `PolicyInsuredParty` | `id, organizationId, policyId, fullName, isPrimary, sourceLabel, createdAt, updatedAt` | same as SELECT | `updatedAt` |
| `MaintenanceRun` | `id, organizationId` | `id, organizationId, type, status, summaryJson, createdAt, startedAt, updatedAt` | `status, completedAt, summaryJson, updatedAt` |
