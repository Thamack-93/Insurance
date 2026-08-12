---
name: PolicyDesk radius & type scale
description: The agreed border-radius steps and body type size for PolicyDesk's shared components, and why legacy radius aliases still exist.
---

# Radius scale (four steps only)

- `sm` (4px) — items nested inside a surface: menu/select items, checkbox, kbd, highlight marks.
- `md` (8px) — **controls**: buttons (every size), inputs, textareas, select triggers, tabs, input groups, small icon actions.
- `xl` (12px) — **containers**: cards, dialogs, sheets, popovers, dropdown content, panels.
- `full` — **pills only**: badges, status chips, dots, avatars, progress bars.

`lg`, `2xl`, `3xl`, `4xl` are still defined in `@theme inline` but only as **aliases** of the four steps
(`lg`→8px, `2xl`/`3xl`→12px, `4xl`→999px). They exist so a stray legacy class name cannot reintroduce a
fifth radius; do not give them distinct values.

**Why:** the UI previously mixed five radii at the same visual level (notably pill-shaped buttons next to
8px inputs). Pills are now reserved for badge-like elements, so "is it a control or a container?" fully
determines the radius.

**How to apply:** when adding a component, pick the step from the role above rather than copying a
neighbouring class. Never introduce arbitrary radii (`rounded-[3px]`, `rounded-[1.5rem]`,
`rounded-[calc(var(--radius)-3px)]`) — map to the nearest step.

# Type scale

Body is **15px / 1.5** (set on `body` in `globals.css`, `--radius: 8px` alongside it). The hierarchy is
h1 32/36 → h2 20 → card title 16 semibold → body 15 → table cells 14 (`text-sm`) → meta 12 (`text-xs`).

`text-sm` on **table cells, `CardDescription`, and secondary text is intentional** — it is what keeps
those a step below body. What is *not* allowed is a blanket `text-sm` on a container (Card, Dialog
content, Sheet content, Popover popup), because it stops body copy from inheriting 15px and flattens the
hierarchy. Those blanket classes were removed; do not add them back.
