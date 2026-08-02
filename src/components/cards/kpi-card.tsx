import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type KpiCardProps = {
  title: string;
  value: string | number;
  description: string;
  href: string;
  icon: LucideIcon;
  tone?: "blue" | "green" | "amber" | "red" | "slate";
};

const toneMap = {
  blue: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  green: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  amber: "bg-amber-500/10 text-amber-800 dark:text-amber-200",
  red: "bg-red-500/10 text-red-700 dark:text-red-300",
  slate: "bg-muted text-foreground/80",
};

export function KpiCard({ title, value, description, href, icon: Icon, tone = "slate" }: KpiCardProps) {
  return (
    <Link href={href} className="group block">
      <Card className="overflow-hidden bg-card shadow-none transition-colors hover:bg-muted/35 focus-within:ring-2 focus-within:ring-ring">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">{title}</p>
              <p className="mt-2 font-mono text-2xl font-semibold tracking-tight text-foreground">{value}</p>
            </div>
            <div className={cn("grid size-9 place-items-center rounded-lg", toneMap[tone])}>
              <Icon className="size-4" />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">{description}</span>
            <ArrowUpRight data-motion-target="icon-shift" className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary motion-reduce:transform-none" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
