---
name: Theme-dependent UI must be hydration-guarded
description: Why anything rendered from next-themes' resolvedTheme mismatches SSR in this app, and the pattern that fixes it.
---

Anything whose **rendered output** depends on the active theme (labels, `aria-label`, `title`, conditional
markup — not Tailwind `dark:` classes, which are fine) must not read `resolvedTheme` directly during the
first render.

**Why:** the root layout reads the theme cookie and passes it as `defaultTheme` with `enableSystem={false}`.
That means next-themes has a resolved theme on the client's *very first* render, while a server render that
tests `resolvedTheme === undefined` produces the other branch. The result is a hydration mismatch that React
reports but does **not** patch up, so the wrong text can stay in the DOM permanently.

**How to apply:** two things together.

1. Pass the server-known theme down as a prop. The cookie is already read in the root layout; the dashboard
   layout reads it the same way and threads it to the client component that needs it.
2. Gate the switch to `resolvedTheme` behind a hydration flag:
   `useSyncExternalStore(subscribe, () => true, () => false)` — `false` on the server and during hydration,
   `true` afterwards. Use the server-provided theme until it flips.

Do **not** use the `useState(false)` + `useEffect(() => setMounted(true))` variant: this repo's eslint config
enables `react-hooks/set-state-in-effect` and rejects it. Do not reach for `suppressHydrationWarning` either —
it hides the warning without correcting the attribute, which is worse for the screen-reader labels this
pattern usually guards.
