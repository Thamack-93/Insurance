import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarClock, CircleDollarSign, ClipboardList, ShieldAlert } from "@/components/icons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { formatBusinessDate } from "@/lib/business-dates";
import { cn } from "@/lib/utils";
import { OPERATIONAL_INSIGHT_GROUPS, type OperationalInsightGroupFilter } from "@/lib/operational-insights.logic";
import type { OperationalInsightsResult } from "@/lib/operational-insights";

const groupLabels: Record<OperationalInsightGroupFilter, string> = {
  all: "Todo",
  renewals: "Renovaciones",
  collections: "Cobranza",
  claims: "Siniestros",
  work: "Trabajo",
};

const groupIcons = {
  renewals: CalendarClock,
  collections: CircleDollarSign,
  claims: ShieldAlert,
  work: ClipboardList,
} as const;

function filterHref(group: OperationalInsightGroupFilter, page = 1) {
  const params = new URLSearchParams();
  if (group !== "all") params.set("group", group);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/reports/insights?${query}` : "/reports/insights";
}

export function OperationalInsightsPanel({ data }: { data: OperationalInsightsResult }) {
  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Resumen de señales operativas">
        {OPERATIONAL_INSIGHT_GROUPS.map((group) => {
          const Icon = groupIcons[group];
          const count = data.counts[group];
          return (
            <Link key={group} href={filterHref(group)} className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Card className={cn("h-full transition-colors hover:bg-muted/40", data.group === group && "ring-2 ring-primary")}>
                <CardHeader className="pb-1">
                  <CardDescription className="flex items-center gap-2"><Icon className="size-4" aria-hidden />{groupLabels[group]}</CardDescription>
                  <CardTitle className="text-2xl">{count.value}{count.more ? "+" : ""}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">Registros que requieren atención</CardContent>
              </Card>
            </Link>
          );
        })}
      </section>

      <div className="flex flex-wrap gap-2" aria-label="Filtrar señales por grupo">
        {(["all", ...OPERATIONAL_INSIGHT_GROUPS] as OperationalInsightGroupFilter[]).map((group) => (
          <Link
            key={group}
            href={filterHref(group)}
            aria-current={data.group === group ? "page" : undefined}
            className={cn(buttonVariants({ variant: data.group === group ? "default" : "outline", size: "sm" }), "min-h-10")}
          >
            {groupLabels[group]}
          </Link>
        ))}
      </div>

      <section className="space-y-3" aria-labelledby="operational-insights-list">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="operational-insights-list" className="font-display text-xl font-medium tracking-tight">Casos accionables</h2>
            <p className="mt-1 text-sm text-muted-foreground">Señales agrupadas por registro para evitar repetir el mismo caso.</p>
          </div>
          <p className="text-xs text-muted-foreground">Fechas de negocio · Página {data.page}</p>
        </div>

        {data.records.length ? data.records.map((record) => (
          <Card key={record.id} size="sm">
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link href={record.href} className="truncate font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{record.title}</Link>
                  <span className="text-xs text-muted-foreground">{record.subtitle}</span>
                </div>
                <ul className="space-y-1 text-sm">
                  {record.signals.map((signal) => (
                    <li key={signal.id} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{signal.label}</span>
                      <span className="text-muted-foreground">{signal.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                <div className="flex flex-wrap gap-1.5">
                  {record.groups.map((group) => (
                    <span key={group} className="rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">{groupLabels[group]}</span>
                  ))}
                </div>
                <time className="shrink-0 text-xs text-muted-foreground" dateTime={formatBusinessDate(record.date, "yyyy-MM-dd")}>{formatBusinessDate(record.date)}</time>
              </div>
            </CardContent>
          </Card>
        )) : (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="font-medium">No hay señales para este filtro.</p>
              <p className="mt-1 text-sm text-muted-foreground">Cuando un registro requiera atención, aparecerá aquí con un enlace a su flujo actual.</p>
            </CardContent>
          </Card>
        )}
      </section>

      <nav className="flex items-center justify-between" aria-label="Paginación de casos">
        {data.hasPrevious ? (
          <Link href={filterHref(data.group, data.page - 1)} className={buttonVariants({ variant: "outline" })}><ArrowLeft className="size-4" aria-hidden />Anterior</Link>
        ) : <span />}
        {data.hasNext ? (
          <Link href={filterHref(data.group, data.page + 1)} className={buttonVariants({ variant: "outline" })}>Siguiente<ArrowRight className="size-4" aria-hidden /></Link>
        ) : null}
      </nav>
    </div>
  );
}
