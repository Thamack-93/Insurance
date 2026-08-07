---
name: PolicyDesk chart conventions
description: Rules every Recharts chart in this app follows — shared primitives, non-color encoding, and what may live inside role="img".
---

# Chart conventions

All Recharts charts go through the shared primitives in `src/components/charts/`
(theme tokens, frame, tooltip, legend, patterns, empty state) instead of being
configured chart by chart.

**Why:** Recharts' defaults are hardcoded greys that read as broken in dark mode,
its tooltips ignore the theme, and fixed pixel heights break on mobile. Fixing
those per chart drifted between screens; the primitives keep light/dark, empty
states and adaptive height identical everywhere.

**How to apply:** when adding or editing a chart, take axis/grid/cursor props and
series colors from the theme module, wrap the chart in the shared frame, and pass
a themed tooltip rather than Recharts' default.

## Never rely on hue alone

Pie/donut slices carry an SVG fill pattern in addition to their color, and the
legend repeats the same pattern in its swatch; multi-series line charts vary the
stroke dash. A chart whose only distinction between series is color is a bug.

## Nothing readable belongs inside `role="img"`

Assistive tech does not expose the children of an element with `role="img"` — only
its `aria-label`. So the sr-only summary tables and the "no hay datos" empty state
must be siblings of the `role="img"` wrapper, never nested inside it. A chart with
no data should not render the image role at all.
