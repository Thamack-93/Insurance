---
name: Verifying authenticated PolicyDesk screens
description: Screens and role behavior cannot be judged from an unauthenticated request, and the dev data hides role-scoping bugs.
---

Every dashboard route redirects to the login form, so an unauthenticated
request — screenshot or fetch — only ever proves that the login screen renders.
Judge a screen by driving it with a session cookie minted from the app's own
token helper for an existing user.

**Why:** there is no middleware bypass and no unauthenticated route that renders
a real screen, so without a cookie you are reviewing the login page.

**How to apply:** fetching with the cookie proves a route renders and lets you
grep the HTML; to judge layout or interaction you have to give the same cookie
to a browser. Never create users or reset passwords in the dev database just to
get in. When measuring horizontal overflow, trust `body`, not
`documentElement` — the dev overlay inflates the latter.

## The dev database has no AGENT user

Only ADMIN users exist locally, so **portfolio-scoping bugs cannot be reproduced
by hand** — every request sees the whole book of business.

**Why:** scope is enforced per-dataset in server code, and an ADMIN session
exercises the unrestricted branch of every one of those checks.

**How to apply:** when a change touches `portfolioOwnerId` filtering, treat
manual verification as insufficient — cover it with a test that seeds an agent,
or say plainly that agent scoping was verified by reading the code rather than
by exercising it.
