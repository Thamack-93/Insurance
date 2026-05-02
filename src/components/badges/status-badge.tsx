import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getPriorityTone, getStatusTone, priorityLabels, statusLabels } from "@/lib/status";

const toneClass = {
  neutral: "border-stone-200 bg-stone-100 text-stone-700",
  info: "border-sky-200 bg-sky-50 text-sky-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
  critical: "border-red-200 bg-red-50 text-red-700",
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

