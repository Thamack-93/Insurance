import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const toneMap = {
  slate: "from-stone-500/14 via-stone-500/8 to-transparent text-stone-700",
  blue: "from-sky-500/16 via-sky-500/8 to-transparent text-sky-700",
  emerald: "from-emerald-500/16 via-emerald-500/8 to-transparent text-emerald-700",
  amber: "from-amber-500/16 via-amber-500/8 to-transparent text-amber-800",
  rose: "from-rose-500/16 via-rose-500/8 to-transparent text-rose-700",
};

const iconToneMap = {
  slate: "text-stone-700",
  blue: "text-sky-700",
  emerald: "text-emerald-700",
  amber: "text-amber-800",
  rose: "text-rose-700",
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
    <Card className="relative overflow-hidden border-white/70 bg-white/85 shadow-sm shadow-stone-200/70 backdrop-blur">
      <div className={cn("absolute inset-x-0 top-0 h-24 bg-gradient-to-br", toneMap[tone])} />
      <CardContent className="relative p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
          </div>
          {Icon ? (
            <div className="rounded-2xl border bg-white/75 p-2.5 shadow-sm">
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
    <Card className={cn("border-white/70 bg-white/84 shadow-sm shadow-stone-200/70", className)}>
      <CardHeader className="border-b border-stone-200/80 pb-4">
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
    <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50/80 px-6 py-10 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border bg-white shadow-sm">
        <Icon className="size-6 text-primary" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
