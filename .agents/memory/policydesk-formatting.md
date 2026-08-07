---
name: Do not run prettier on PolicyDesk
description: Prettier is not the formatter for this repo; running it rewrites large amounts of unrelated code.
---

**Do not run `prettier --write` on this repo.**

**Why:** there is no `.prettierrc`, and the project's hand-maintained formatting does not match prettier's
defaults, so a run reformats far more than the lines you intended to change and buries the real edit.

**How to apply:** make formatting changes by hand or with narrowly-scoped transforms, then read the diff
before moving on. `npm run lint` (eslint) is the formatter/quality check this project actually uses, and
`npm run typecheck` must be clean.
