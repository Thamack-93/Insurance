import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getPriorityTone, getStatusTone, priorityLabels, statusLabels } from "@/lib/status";

const toneClass = {
  neutral: "border-border bg-muted text-muted-foreground",
  info: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200",
  danger: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300",
  critical: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const tone = getStatusTone(status);

  return (
    <Badge variant="outline" className={cn("rounded-full px-2.5 py-1 font-medium", toneClass[tone], className)}>
      {statusLabels[status] ?? status}
    </Badge>
  );
}

export function PriorityBadge({ priority, className }: { priority: string; className?: string }) {
  const tone = getPriorityTone(priority);

  return (
    <Badge variant="outline" className={cn("rounded-full px-2.5 py-1 font-medium", toneClass[tone], className)}>
      {priorityLabels[priority] ?? priority}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const tone = severity === "CRITICAL" ? "critical" : severity === "WARNING" ? "warning" : "info";

  return (
    <Badge variant="outline" className={cn("rounded-full px-2.5 py-1 font-medium", toneClass[tone])}>
      {severity === "CRITICAL" ? "Critico" : severity === "WARNING" ? "Warning" : "Info"}
    </Badge>
  );
}

