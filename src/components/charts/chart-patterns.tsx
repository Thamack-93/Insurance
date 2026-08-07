"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Second identification channel for categorical charts.
 *
 * Slices and legends must be tellable apart without perceiving hue, so every
 * category also gets a fill texture. The first category stays solid and the
 * rest add increasingly distinct textures, all drawn with the surface colour so
 * they read the same way in light and dark mode.
 */
export type ChartPatternKind = "solid" | "diagonal" | "dots" | "cross" | "horizontal" | "vertical";

const PATTERN_ORDER: ChartPatternKind[] = ["solid", "diagonal", "dots", "cross", "horizontal", "vertical"];

export function chartPattern(index: number): ChartPatternKind {
  return PATTERN_ORDER[index % PATTERN_ORDER.length];
}

const TILE = 6;

function PatternTexture({ kind }: { kind: ChartPatternKind }) {
  const strokeProps = { fill: "none", stroke: "var(--card)", strokeWidth: 1.4, strokeLinecap: "round" as const };
  switch (kind) {
    case "diagonal":
      return <path d="M-1 1 L1 -1 M-1 7 L7 -1 M5 7 L7 5" {...strokeProps} />;
    case "dots":
      return <circle cx="3" cy="3" r="1.3" fill="var(--card)" />;
    case "cross":
      return <path d="M0 3 H6 M3 0 V6" {...strokeProps} />;
    case "horizontal":
      return <path d="M0 3 H6" {...strokeProps} />;
    case "vertical":
      return <path d="M3 0 V6" {...strokeProps} />;
    default:
      return null;
  }
}

function PatternTile({ id, color, kind }: { id: string; color: string; kind: ChartPatternKind }) {
  return (
    <pattern id={id} width={TILE} height={TILE} patternUnits="userSpaceOnUse">
      <rect width={TILE} height={TILE} fill={color} />
      <PatternTexture kind={kind} />
    </pattern>
  );
}

/** `<defs>` block to drop inside a Recharts chart so slices can use `url(#id)`. */
export function ChartPatternDefs({
  items,
}: {
  items: Array<{ id: string; color: string; pattern: ChartPatternKind }>;
}) {
  return (
    <defs>
      {items.map((item) => (
        <PatternTile key={item.id} id={item.id} color={item.color} kind={item.pattern} />
      ))}
    </defs>
  );
}

/** The same texture at legend size, so the legend maps 1:1 onto the chart. */
export function ChartPatternSwatch({
  color,
  pattern,
  className,
}: {
  color: string;
  pattern: ChartPatternKind;
  className?: string;
}) {
  const id = `pattern-swatch-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 12 12" className={cn("size-3 shrink-0 overflow-hidden rounded-sm", className)} aria-hidden focusable="false">
      <defs>
        <PatternTile id={id} color={color} kind={pattern} />
      </defs>
      <rect width="12" height="12" fill={`url(#${id})`} />
    </svg>
  );
}
