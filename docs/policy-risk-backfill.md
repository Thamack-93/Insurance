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
safe to resume from the same reviewed manifest,
and writes a private per-policy outcome report alongside the manifest. It also
records run counts and the manifest digest in `MaintenanceRun`. A changed
candidate, processor, organization, or source row stops before writes.

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

The mode starts one `REPEATABLE READ, READ ONLY` transaction, checks the actual
PostgreSQL role, verifies it has no write privileges on the organization and
policy tables it reads, and scopes every query to the explicit organization ID.
It fails if the organization is not visible through the configured role. The
mode rejects `--apply`; apply remains restricted to the disposable rehearsal
guards above. It does not create a Production conversion run or change any
row. Review the manifest and its source text privately before planning any
separate, approved Production apply and recovery checkpoint.
