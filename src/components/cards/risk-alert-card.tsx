import { AlertTriangle, ArrowUpRight } from "@/components/icons";
import { SeverityBadge } from "@/components/badges/status-badge";

export function RiskAlertCard({
  title,
  description,
  severity,
  action,
}: {
  title: string;
  description: string;
  severity: string;
  action: string;
}) {
  return (
    <div className="group rounded-2xl border bg-card/74 p-4 shadow-sm transition hover:border-primary/20 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3">
          <div className="rounded-2xl bg-amber-50 p-2 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            <AlertTriangle className="size-4" />
          </div>
          <div>
            <p className="font-medium">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <SeverityBadge severity={severity} />
      </div>
      <div className="mt-3 flex items-center gap-2 text-sm font-medium text-primary">
        {action}
        <ArrowUpRight data-motion-target="icon-shift" className="size-3.5 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transform-none" />
      </div>
    </div>
  );
}
