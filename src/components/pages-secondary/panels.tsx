import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const toneMap = {
  slate: "from-stone-500/14 via-stone-500/8 to-transparent text-foreground/80 dark:from-stone-400/14 dark:via-stone-400/8",
  blue: "from-sky-500/16 via-sky-500/8 to-transparent text-sky-700 dark:from-sky-400/16 dark:via-sky-400/8 dark:text-sky-300",
  emerald: "from-emerald-500/16 via-emerald-500/8 to-transparent text-emerald-700 dark:from-emerald-400/16 dark:via-emerald-400/8 dark:text-emerald-300",
  amber: "from-amber-500/16 via-amber-500/8 to-transparent text-amber-800 dark:from-amber-400/16 dark:via-amber-400/8 dark:text-amber-200",
  rose: "from-rose-500/16 via-rose-500/8 to-transparent text-rose-700 dark:from-rose-400/16 dark:via-rose-400/8 dark:text-rose-300",
};

const iconToneMap = {
  slate: "text-foreground/80",
  blue: "text-sky-700 dark:text-sky-300",
  emerald: "text-emerald-700 dark:text-emerald-300",
  amber: "text-amber-800 dark:text-amber-200",
  rose: "text-rose-700 dark:text-rose-300",
};

export function MetricCard({
  title,
  value,
  description,
  icon: Icon,
  tone = "slate",
}: {
  title: string;
  value: string | number;
  description: string;
  icon?: LucideIcon;
  tone?: keyof typeof toneMap;
}) {
  return (
    <Card className="relative overflow-hidden border-border/60 bg-card/85 shadow-sm backdrop-blur">
      <div className={cn("absolute inset-x-0 top-0 h-24 bg-gradient-to-br", toneMap[tone])} />
      <CardContent className="relative p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
          </div>
          {Icon ? (
            <div className="rounded-2xl border bg-card/75 p-2.5 shadow-sm">
              <Icon className={cn("size-5", iconToneMap[tone])} />
            </div>
          ) : null}
        </div>
        <p className="mt-4 text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("border-border/60 bg-card/85 shadow-sm", className)}>
      <CardHeader className="border-b border-border/70 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{title}</CardTitle>
            {description ? <CardDescription className="mt-1">{description}</CardDescription> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      </CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}

export function EmptyPanel({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-6 py-10 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border bg-card shadow-sm">
        <Icon className="size-6 text-primary" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
