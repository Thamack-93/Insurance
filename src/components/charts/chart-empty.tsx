import { BarChart3 } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * What a chart shows when there is nothing to plot. Mirrors the dashed-border
 * language of `EmptyState` so a chart without data reads as "no hay datos"
 * instead of a blank or half-drawn canvas.
 */
export function ChartEmptyState({
  message = "Aún no hay datos para graficar.",
  hint,
  className,
}: {
  message?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-[clamp(11rem,26vh,18rem)] w-full min-h-44 flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/30 px-4 py-6 text-center",
        className,
      )}
    >
      <span className="grid size-9 place-items-center rounded-md border bg-card text-muted-foreground" aria-hidden>
        <BarChart3 className="size-4" />
      </span>
      <p className="text-sm text-muted-foreground">{message}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
