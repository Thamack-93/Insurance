---
name: Do not run auto-formatters on PolicyDesk
description: Neither prettier nor `prisma format` is the formatter for this repo; running either rewrites large amounts of unrelated code.
---

**Do not run `prettier --write` on this repo, and do not run `prisma format` on `prisma/schema.prisma`.**

**Why:** there is no `.prettierrc`, and the project's hand-maintained formatting does not match prettier's
defaults, so a run reformats far more than the lines you intended to change and buries the real edit.
`prisma format` has the same failure mode on the schema: it reflows the entire file (every line of a
~1400-line schema) purely on alignment, so a two-field change becomes an unreviewable diff. Both have
already forced a full revert-and-reapply once.

**How to apply:** make formatting changes by hand or with narrowly-scoped transforms, then read the diff
before moving on. Edit `schema.prisma` textually and let `prisma validate` / `npm run db:generate` catch
syntax problems instead of formatting it. `npm run lint` (eslint) is the formatter/quality check this
project actually uses, and `npm run typecheck` must be clean.

Note: `npm run lint` over the whole repo often exceeds the shell timeout while the dev server is running.
Lint the changed files directly (`npx eslint <files>`) for a fast, equivalent check.
