import Link from "next/link";
import { ArrowUpRight, BellRing, CalendarDays, CheckCircle2, ChevronRight, CircleAlert, CircleDollarSign, Clock3, FileText, ReceiptText, RefreshCw, ShieldCheck } from "@/components/icons";
import { formatCurrency } from "@/lib/money";
import type { FocusItemModel, OperationalMetricModel, SemanticTone } from "@/lib/today-operations";
import { cn } from "@/lib/utils";

const toneStyles: Record<SemanticTone, { dot: string; text: string; soft: string; card: string }> = {
  critical: { dot: "bg-critical", text: "text-critical", soft: "bg-critical/10", card: "border-border bg-card" },
  warning: { dot: "bg-warning", text: "text-warning", soft: "bg-warning/10", card: "border-border bg-card" },
  success: { dot: "bg-success", text: "text-success", soft: "bg-success/10", card: "border-border bg-card" },
  information: { dot: "bg-information", text: "text-information", soft: "bg-information/10", card: "border-border bg-card" },
  ai: { dot: "bg-ai", text: "text-ai", soft: "bg-ai/10", card: "border-border bg-card" },
  neutral: { dot: "bg-muted-foreground", text: "text-muted-foreground", soft: "bg-muted", card: "border-border bg-card" },
};

const toneIconMap: Record<SemanticTone, typeof CircleAlert> = {
  critical: CircleAlert,
  warning: Clock3,
  success: CheckCircle2,
  information: CircleDollarSign,
  ai: RefreshCw,
  neutral: RefreshCw,
};

const metricIconMap: Record<string, typeof CircleAlert> = {
  overdue: BellRing,
  "due-today": ReceiptText,
  "due-7": CalendarDays,
  renewals: ShieldCheck,
  "overdue-work": CheckCircle2,
  commissions: CircleDollarSign,
};

export function SemanticStatusDot({ tone, label }: { tone: SemanticTone; label: string }) {
  return <span className={cn("inline-flex items-center gap-1.5 text-xs", toneStyles[tone].text)}><span className={cn("size-2 rounded-full", toneStyles[tone].dot)} aria-hidden />{label}</span>;
}

export function EntityMeta({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 truncate text-xs text-muted-foreground">{children}</p>;
}

export function OperationalMetric({ metric }: { metric: OperationalMetricModel }) {
  const Icon = metricIconMap[metric.id] ?? toneIconMap[metric.tone];
  const content = (
    <span className={cn("flex min-h-28 min-w-[164px] flex-col justify-between rounded-xl border p-3.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)]", toneStyles[metric.tone].card)}>
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-xs font-medium text-muted-foreground">{metric.label}</span>
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-md", toneStyles[metric.tone].soft, toneStyles[metric.tone].text)} aria-hidden>
          <Icon className="size-4" />
        </span>
      </span>
      <span>
        <span className={cn("font-display block text-[28px] font-medium tracking-tight", toneStyles[metric.tone].text)} aria-label={`${metric.label}: ${metric.accessibleValue}`}>
          {metric.value}
        </span>
        {metric.description ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{metric.description}</span> : null}
      </span>
    </span>
  );
  return metric.href ? <Link href={metric.href} data-motion-target="lift" className="rounded-xl transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transform-none">{content}</Link> : content;
}

export function OperationalSummary({ metrics }: { metrics: OperationalMetricModel[] }) {
  return <section aria-label="Resumen operativo" className="overflow-x-auto py-1"><div className="grid min-w-max grid-flow-col auto-cols-[164px] gap-2.5 sm:min-w-0 sm:grid-flow-row sm:grid-cols-3 xl:grid-cols-6">{metrics.map((metric) => <OperationalMetric key={metric.id} metric={metric} />)}</div></section>;
}

export function FocusQueueItem({ item }: { item: FocusItemModel }) {
  const Icon = toneIconMap[item.tone];
  return (
    <div className="flex flex-col gap-3 border-b px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-md", toneStyles[item.tone].soft, toneStyles[item.tone].text)}><Icon className="size-4" aria-hidden /></span>
        <div className="min-w-0">
          <SemanticStatusDot tone={item.tone} label={item.category} />
          <p className="mt-1 truncate text-sm font-medium text-foreground">{item.title}</p>
          <EntityMeta>{item.context} · {item.dueText}</EntityMeta>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
        {item.amount !== undefined ? <span className="font-mono text-sm font-medium">{formatCurrency(item.amount, item.currency)}</span> : null}
        {item.detailsHref ? <Link href={item.detailsHref} className="inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{item.detailsLabel ?? "Detalles"}<FileText className="size-3.5" aria-hidden /></Link> : null}
        <Link href={item.href} className="inline-flex min-h-10 items-center gap-1 rounded-md border border-primary/25 px-3 text-xs font-medium text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{item.actionLabel}<ArrowUpRight className="size-3.5" aria-hidden /></Link>
      </div>
    </div>
  );
}

export function FocusQueue({ items }: { items: FocusItemModel[] }) {
  return <section aria-labelledby="focus-queue-title" className="rounded-xl border bg-card"><div className="flex items-center justify-between border-b px-4 py-4"><div><h2 id="focus-queue-title" className="text-base font-semibold">Enfoque ahora</h2><p className="mt-1 text-xs text-muted-foreground">Lo que requiere una acción primero.</p></div><Link href="/operations?view=pending" className="inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-xs text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Ver pendientes<ChevronRight className="size-3.5" aria-hidden /></Link></div>{items.length ? <div>{items.map((item) => <FocusQueueItem key={item.id} item={item} />)}</div> : <EmptyOperationalState message="Todo el trabajo está dentro de fecha." />}</section>;
}

export function OperationalRow({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-14 items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0">{children}</div>;
}

export function EmptyOperationalState({ message, action }: { message: string; action?: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 px-4 py-5 text-sm text-muted-foreground"><span className="flex items-center gap-2"><CheckCircle2 className="size-4 text-success" aria-hidden />{message}</span>{action}</div>;
}

export function OperationalSection({ title, description, children, action }: { title: string; description?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <section className="rounded-xl border bg-card"><div className="flex items-start justify-between gap-3 border-b px-4 py-4"><div><h2 className="text-sm font-semibold">{title}</h2>{description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}</div>{action}</div>{children}</section>;
}
