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
  blue: "from-sky-500/14 to-cyan-400/5 text-sky-700 dark:text-sky-300",
  green: "from-emerald-500/14 to-lime-400/5 text-emerald-700 dark:text-emerald-300",
  amber: "from-amber-500/18 to-orange-400/5 text-amber-800 dark:text-amber-200",
  red: "from-red-500/14 to-rose-400/5 text-red-700 dark:text-red-300",
  slate: "from-slate-500/12 to-stone-400/5 text-foreground/80",
};

export function KpiCard({ title, value, description, href, icon: Icon, tone = "slate" }: KpiCardProps) {
  return (
    <Link href={href} className="group block">
      <Card className="overflow-hidden border-border/70 bg-card/85 shadow-sm backdrop-blur transition duration-200 hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-xl">
        <CardContent className="relative p-5">
          <div className={cn("absolute inset-x-0 top-0 h-24 bg-gradient-to-br", toneMap[tone])} />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">{title}</p>
              <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
            </div>
            <div className={cn("rounded-2xl border bg-card/75 p-2.5 shadow-sm", toneMap[tone])}>
              <Icon className="size-5" />
            </div>
          </div>
          <div className="relative mt-4 flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{description}</span>
            <ArrowUpRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

