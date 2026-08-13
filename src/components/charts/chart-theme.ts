/**
 * Shared visual tokens for every Recharts surface.
 *
 * Recharts renders raw SVG, so it does not inherit anything from Tailwind: any
 * axis, grid or cursor left at its defaults keeps a hard-coded light-mode grey
 * and turns unreadable in dark mode. Every chart pulls its colours from here so
 * they always resolve through the theme's CSS custom properties.
 */

export const CHART_GRID_STROKE = "var(--border)";

export const CHART_AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 12 } as const;

export const CHART_AXIS_PROPS = {
  tickLine: false,
  axisLine: false,
  stroke: "var(--muted-foreground)",
  tick: CHART_AXIS_TICK,
} as const;

/** Hover backdrop for categorical charts (bars). */
export const CHART_CURSOR_FILL = { fill: "var(--muted)", fillOpacity: 0.55 } as const;

/** Hover guide for continuous charts (lines, areas). */
export const CHART_CURSOR_LINE = { stroke: "var(--muted-foreground)", strokeOpacity: 0.45, strokeWidth: 1 } as const;

export const CHART_SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--muted-foreground)",
] as const;

export function chartSeriesColor(index: number) {
  return CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length];
}
