import { cn } from "@/lib/utils";

export type DaysBadgeProps = {
  days: number;
  className?: string;
};

function classFor(days: number) {
  if (days <= 0) return "border-rose-200 bg-rose-50 text-rose-700";
  if (days <= 15) return "border-orange-200 bg-orange-50 text-orange-700";
  if (days <= 30) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function labelFor(days: number) {
  if (days < 0) return `Vencido hace ${Math.abs(days)} d.`;
  if (days === 0) return "Vence hoy";
  return `${days} d.`;
}

export function DaysBadge({ days, className }: DaysBadgeProps) {
  return (
    <span
      aria-label={labelFor(days)}
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        classFor(days),
        className,
      )}
    >
      {days}
    </span>
  );
}
