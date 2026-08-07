"use client";

import { ChartPatternSwatch, type ChartPatternKind } from "@/components/charts/chart-patterns";
import { cn } from "@/lib/utils";

export type ChartLegendItem = {
  key: string;
  label: string;
  value: number;
  color: string;
  pattern: ChartPatternKind;
};

/**
 * Visible legend for donut charts. Each row repeats the slice texture, its
 * label, the absolute value and the share, so the chart can be read without
 * hovering and without telling hues apart.
 */
export function ChartLegend({
  items,
  total,
  className,
}: {
  items: ChartLegendItem[];
  total: number;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul className={cn("mt-3 space-y-1.5", className)}>
      {items.map((item) => (
        <li key={item.key} className="flex items-center justify-between gap-2 text-xs">
          <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <ChartPatternSwatch color={item.color} pattern={item.pattern} />
            <span className="truncate">{item.label}</span>
          </span>
          <span className="shrink-0 font-medium text-foreground">
            {item.value.toLocaleString("es-MX")}
            <span className="ml-1 font-normal text-muted-foreground">
              ({total > 0 ? Math.round((item.value / total) * 100) : 0}%)
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
