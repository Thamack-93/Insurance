# PolicyDesk supervised autonomous development

PolicyDesk contains a real, actively used insurance portfolio. Treat it as production data even before commercial launch.

## Source of truth and continuity
- GitHub main, PR checks, issues, and deploy status are authoritative. This file is a runbook, not proof of runtime health.
- Each scheduled run first reads this file, open PRs, recent commits, CI and outstanding issues.
- CI security manifest route is present on main as of 2026-11-12; PR #233 was validated with four successful CI jobs. Continue the existing runbook PR #234; do not duplicate work. Confirm merge history before reporting PR #233 as merged.
- Max one active feature PR and one review-blocked PR. Reuse an existing PR; do not duplicate work.
- After each run, update the NOW/NEXT/LATER roadmap below through a PR when appropriate. Never overwrite concurrent work.
- Every report must be readable in 30 seconds: status, shipped/PR, tests, portfolio impact, backup/restore evidence, next action, and approval needed.

## Risk classification and merge policy
- LOW: copy, styling, read-only UI, isolated pure helpers without security, data or external side effects.
- REVIEW: changes to clients, policies, claims, receipts, payments, commissions, renewals, bonuses, documents, auth, permissions, tenancy, DB schema/migrations, storage, backups, integrations, outgoing communications, CI, infrastructure or deployment.
- UNKNOWN = REVIEW.
- No automatic merge until required GitHub branch protections/rulesets, exact-head required CI success, safe deployment behavior, and relevant regression tests are verified. Never bypass protection, skip checks, or auto-deploy intentionally.
- Never write to, delete from, restore into, or use destructive fixtures against the live portfolio.

## Database recovery and backtracking
- Git revert only reverts application code; it does NOT undo schema migrations or database writes.
- Before risky schema/data changes: require verified recent encrypted backup, key availability, restore target and an approved rollback/forward-fix plan.
- Perform recovery drills ONLY on isolated disposable Neon branches/databases with explicit allowlist, never on source/live DB. Confirm records, relationships, document/blob recovery, application smoke and schema drift; preserve sanitized evidence and timestamp.
- Existing commands: `npm run drill:backup:temp-neon` (isolated restore drill) and `npm run test:unit -- src/lib/backup-restore.integration.logic.test.ts` (synthetic CI integration). Verify configuration before running. A passing synthetic test does not certify the latest real backup.
- Recovery objective must be evidenced: record latest verified backup time, latest isolated restore PASS, restore duration and data-loss window. If missing, status YELLOW/RED; do not claim recoverability.
- Prefer additive/backward-compatible migrations and expand/contract deployment. Require human approval for schema or data recovery changes.
- Never expose real portfolio records, credentials or backup payloads in logs or CI artifacts.

## Restore certification checklist (must be evidenced, not assumed)
1. Confirm the latest stored encrypted backup and manifest were produced successfully; record creation UTC time, encrypted payload checksum, and key version only (never the key or payload).
2. Identify an isolated, disposable Neon restore branch with explicit authorization and prove its database endpoint differs from every production/source/pooler endpoint before running any restore.
3. Run the existing isolated restore drill using the verified stored backup, then inspect its sanitized report for a PASS across manifest validation, decryption, schema/migrations, data and relational integrity, document/blob recovery, and application smoke. Do not substitute a synthetic CI restore for this check.
4. Record evidence: sanitized report location, backup UTC time, drill UTC time, duration (RTO observed), age of last recoverable backup (RPO observed), and any omitted verification stages. If any required stage is absent, status remains NOT VERIFIED.
5. For a failed drill: preserve the sanitized failure stage, stop automatic data/schema changes, and fix the cause without touching production. Never execute the drill using production DATABASE_URL as the restore target.
6. For code backtrack: prepare a Git revert with validated CI and deployment behavior; for data backtrack: require a separately approved recovery plan that explicitly covers writes after the backup and documents/attachments.

## Automated quality gates
- Required for every PR: production dependency audit, quality checks (lint, typecheck, unit, security manifest, secrets, auth guards), disposable PostgreSQL application build/API/E2E, and tenant-isolation where applicable. Check exact commit SHA.
- Add targeted synthetic tests for clients, policies, renewals, receipts/payments, claims, documents and Nora/Telegram side effects when touched.
- Visual changes: verify primary desktop/mobile workflows with Playwright where appropriate.
- CI failures: stop new feature work; repair same PR. After three failed attempts with no progress, report blocker and request guidance.

## Roadmap (update after each completed implementation)
### NOW
1. Complete runbook PR #234 and establish verified branch protection/rulesets for required checks.
2. Confirm whether main triggers automatic deployment; keep auto-merge disabled until confirmed.
3. Verify isolated restore drill against a recent real encrypted backup, with safe temporary target and sanitized evidence; no production restore.

### NEXT
1. Focused synthetic regression fixtures for daily portfolio workflows.
2. Claims: editable preview/copy/manual WhatsApp link for outstanding document requests, no automatic sending.
3. Visual desktop/mobile smoke coverage for critical workflows.

### LATER
1. Claims follow-up reminders and assisted document association.
2. Renewals/collections workflow improvements based on real usage.

## 30-second run report (Spanish, strict)
**PolicyDesk [local time] — GREEN/YELLOW/RED**
**Hecho:** [one concrete result + PR link, or 'sin cambios']
**Checks:** [CI exact SHA, PASS/FAIL/PENDING]
**Cartera:** [untouched / validated / risk, no unsupported assurances]
**Recuperación:** [last backup verified + isolated restore PASS date, or NOT VERIFIED]
**Siguiente:** [one task]
**Necesito de ti:** [none / exact approval]
Keep the main report <= 110 Spanish words; details only as links or optional appendix.
