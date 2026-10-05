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
manifest digest and input hashes make the apply fail closed if they drift.

Apply the reviewed report to the same disposable database and exact candidate
revision:

```sh
NODE_ENV=test TENANT_ISOLATION_TEST_DB=1 PLAYWRIGHT_ENFORCE_DISPOSABLE_DB=1 \
  npm run backfill:policy-risk-details -- \
  --organization-id=ORG_ID --apply \
  --reviewed-report=/private/tmp/policy-risk-backfill-preview.json \
  --reviewed-by=REVIEWER --manifest-sha256=SHA_FROM_PREVIEW \
  --confirm-apply=APPLY_POLICY_RISK_BACKFILL --batch-size=50
```

The apply is organization-scoped, checks current source hashes before writing,
uses bounded transactions, is safe to resume from the same reviewed manifest,
and writes a private per-policy outcome report alongside the manifest. It also
records run counts and the manifest digest in `MaintenanceRun`. A changed
candidate, processor, organization, or source row stops before writes.

This command intentionally refuses Production and Vercel environments. A
Production conversion still needs its own authorized operator path, reviewed
per-organization preview, batch plan, and recovery checkpoint; the rehearsal
does not authorize or perform that operation.
