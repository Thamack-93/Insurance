---
name: Verifying authenticated PolicyDesk screens locally
description: How to reach logged-in pages from the shell, and the dev-data gap that hides role-scoping bugs.
---

# Reaching authenticated screens from the shell

Every dashboard route redirects to the login form, and the screenshot tool
cannot carry a cookie — so a bare screenshot of a list page only ever shows
"Acceso a tu centro operativo".

To verify a real screen, mint a session for an existing user with the app's own
token helper (a temporary `tsx` script that reads a user from the db and signs a
payload), then send it as the `pd_session` cookie with `curl`. This is read-only:
do not create users or reset passwords in the dev database just to log in.

Two gotchas: the script runner compiles to CJS, so wrap the script in an
`async main()` rather than using top-level `await`; and delete the temporary
script afterwards so it does not land in `scripts/`.

## The dev database has no AGENT user

Only ADMIN users exist locally, so **portfolio-scoping bugs cannot be reproduced
by hand** — every request sees the whole book of business.

**Why:** scope is enforced per-dataset in server code, and an ADMIN session
exercises the unrestricted branch of every one of those checks.

**How to apply:** when a change touches `portfolioOwnerId` filtering, treat
manual verification as insufficient and cover it with a test that seeds an agent,
or say plainly in the summary that agent scoping was verified by reading the code
rather than by exercising it.
