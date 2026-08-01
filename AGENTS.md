<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Disaster-recovery restore drills

- Restore remains CLI-only and may target only an explicitly authorized temporary Neon branch.
- Never restore to production or create/promote/delete Neon branches from application code.
- A cryptographically valid backup is not recoverable evidence until table counts, foreign keys, PolicyDesk invariants, WorkItem compatibility and application reads pass.
- Keep `RESTORE_DRILL_APP_SMOKE=0` unless an operator explicitly enables the opt-in smoke against a disposable target.
- A restore drill must validate counts, public foreign keys, Payment `POSTED`/`REVERSED` lifecycle, Policy/Receipt cancellation and renewal invariants, Notification user references, WorkItem canonical and legacy references, sequences, application reads and Prisma drift before reporting `PASS`.
- `session_replication_role = replica` is limited to the restore transaction; restore it to `origin` before validation and roll back on every validation failure.
