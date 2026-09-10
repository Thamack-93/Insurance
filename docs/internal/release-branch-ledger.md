# Release branch ledger

Updated for the Stage 3 candidate `f2d6299`.

| Branch/ref | Current SHA | Disposition |
|---|---:|---|
| `main` | `bf4edbc` | Operational baseline; WhatsApp and PDF fixes already merged. |
| `codex/release-stage3` | `f2d6299` | Candidate for PR #68; contains the Stage 3 migrations and the operational fixes from `main`. |
| `codex/renewal-whatsapp` | `9f488de` | Historical reference; do not merge wholesale because it would remove newer tenant and WhatsApp behavior. |
| `codex/renewal-whatsapp-fix` | `1909244` | Historical/equivalent fix; no unique merge required. |
| `codex/renewal-whatsapp-mac` | `4f5b540` | Its three UI/status changes are already present in the Stage 3 candidate. |
| `codex/stage-3-certification` | `f4f1e69` | Historical Stage 3 evidence; preserved as a reference. |
| `codex/stage-3-multitenant` | `0e7549a` | Historical Stage 3 evidence; preserved as a reference. |
| `codex/qualitas-assisted-operations-reliability` | `ef45e89` | Divergent; only selectively port unique Qualitas hardening after rebase and tests. |

The backup refs `refs/backup/pre-release-main`,
`refs/backup/pre-release-stage3`, `refs/backup/pre-release-stage3-multitenant`,
and `refs/backup/pre-release-whatsapp-mac` remain preserved. Local `.neon`,
`outputs/`, and files with a `2` suffix are intentionally excluded from commits.
