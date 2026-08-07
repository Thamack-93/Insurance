"use client";

import { ChartPatternSwatch, type ChartPatternKind } from "@/components/charts/chart-patterns";

export type ChartTooltipEntry = {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
};

type ChartTooltipOptions = {
  /**
   * Base used to express a point as a share of the whole: a single number for
   * one-series charts, or a per-series map keyed by `dataKey` when several
   * series share the tooltip.
   */
  total?: number | Record<string, number>;
  /** Wording that explains what the percentage is a share of. */
  shareLabel?: string;
  /** Row label for single-series charts, where the series has no name. */
  valueLabel?: string;
  formatValue?: (value: number) => string;
  /** Pie/donut: the heading is the slice name, not the axis label. */
  headingFromPayload?: boolean;
};

type ChartTooltipContentProps = ChartTooltipOptions & {
  active?: boolean;
  label?: string | number;
  payload?: ChartTooltipEntry[];
};

function toNumber(value: number | string | undefined) {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
}

function shareBase(total: ChartTooltipOptions["total"], entry: ChartTooltipEntry, fallback: number) {
  if (typeof total === "number") return total;
  if (total) {
    const key = String(entry.dataKey ?? entry.name ?? "");
    if (typeof total[key] === "number") return total[key];
  }
  return fallback;
}

/**
 * Themed replacement for the default Recharts tooltip: it uses the popover
 * tokens (so it is readable in dark mode) and always states label, value and
 * the proportion that value represents.
 */
export function ChartTooltipContent({
  active,
  payload,
  label,
  total,
  shareLabel,
  valueLabel = "Total",
  formatValue,
  headingFromPayload,
}: ChartTooltipContentProps) {
  if (!active || !payload?.length) return null;

  const heading = String((headingFromPayload ? payload[0]?.name : label) ?? "");
  const payloadSum = payload.reduce((sum, entry) => sum + toNumber(entry.value), 0);
  const showSeriesNames = !headingFromPayload && payload.length > 1;

  return (
    <div className="pointer-events-none min-w-36 max-w-56 rounded-xl border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md">
      {heading ? <p className="text-xs font-semibold">{heading}</p> : null}
      <ul className="mt-1 space-y-1">
        {payload.map((entry, index) => {
          const value = toNumber(entry.value);
          const base = shareBase(total, entry, payloadSum);
          const share = base > 0 ? Math.round((value / base) * 100) : null;
          const pattern = entry.payload?.pattern as ChartPatternKind | undefined;
          const color = (entry.payload?.color as string | undefined) ?? entry.color ?? "var(--chart-1)";

          return (
            <li key={`${entry.dataKey ?? entry.name ?? index}`} className="flex items-center justify-between gap-3 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                {pattern ? (
                  <ChartPatternSwatch color={color} pattern={pattern} />
                ) : (
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
                )}
                <span className="truncate">{showSeriesNames ? String(entry.name ?? "") : valueLabel}</span>
              </span>
              <span className="shrink-0 font-medium text-foreground">
                {formatValue ? formatValue(value) : value.toLocaleString("es-MX")}
                {share !== null ? <span className="ml-1 font-normal text-muted-foreground">({share}%)</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
      {shareLabel ? <p className="mt-1.5 text-[11px] text-muted-foreground">{shareLabel}</p> : null}
    </div>
  );
}

/**
 * Adapter for `<Tooltip content={...} />`: Recharts hands the raw payload to a
 * render function, and this keeps every chart from repeating the cast.
 */
export function chartTooltip(options: ChartTooltipOptions = {}) {
  return function renderChartTooltip(props: { active?: boolean; label?: unknown; payload?: unknown }) {
    return (
      <ChartTooltipContent
        {...options}
        active={props.active}
        label={props.label as string | number | undefined}
        payload={(props.payload ?? []) as ChartTooltipEntry[]}
      />
    );
  };
}
