import Link from "next/link";
import { ArrowUpRight, CheckCircle2, ChevronRight, CircleAlert, CircleDollarSign, Clock3, FileText, RefreshCw } from "lucide-react";
import { formatCurrency } from "@/lib/money";
import type { FocusItemModel, OperationalMetricModel, SemanticTone } from "@/lib/today-operations";
import { cn } from "@/lib/utils";

const toneStyles: Record<SemanticTone, { dot: string; text: string; soft: string }> = {
  critical: { dot: "bg-critical", text: "text-critical", soft: "bg-critical/10" },
  warning: { dot: "bg-warning", text: "text-warning", soft: "bg-warning/10" },
  success: { dot: "bg-success", text: "text-success", soft: "bg-success/10" },
  information: { dot: "bg-information", text: "text-information", soft: "bg-information/10" },
  ai: { dot: "bg-ai", text: "text-ai", soft: "bg-ai/10" },
  neutral: { dot: "bg-muted-foreground", text: "text-muted-foreground", soft: "bg-muted" },
};

const toneIconMap: Record<SemanticTone, typeof CircleAlert> = {
  critical: CircleAlert,
  warning: Clock3,
  success: CheckCircle2,
  information: CircleDollarSign,
  ai: RefreshCw,
  neutral: RefreshCw,
};

export function SemanticStatusDot({ tone, label }: { tone: SemanticTone; label: string }) {
  return <span className={cn("inline-flex items-center gap-1.5 text-xs", toneStyles[tone].text)}><span className={cn("size-2 rounded-full", toneStyles[tone].dot)} aria-hidden />{label}</span>;
}

export function EntityMeta({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 truncate text-xs text-muted-foreground">{children}</p>;
}

export function OperationalMetric({ metric }: { metric: OperationalMetricModel }) {
  const content = (
    <span className="flex min-w-[148px] items-center gap-3 px-4 py-3 sm:min-w-0 sm:flex-1">
      <span className={cn("size-2 shrink-0 rounded-full", toneStyles[metric.tone].dot)} aria-hidden />
      <span className="min-w-0">
        <span className="block truncate text-xs text-muted-foreground">{metric.label}</span>
        <span className={cn("mt-0.5 block font-mono text-lg font-semibold", toneStyles[metric.tone].text)} aria-label={`${metric.label}: ${metric.accessibleValue}`}>
          {metric.value}
        </span>
      </span>
    </span>
  );
  return metric.href ? <Link href={metric.href} className="rounded-md transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{content}</Link> : content;
}

export function OperationalSummary({ metrics }: { metrics: OperationalMetricModel[] }) {
  return <section aria-label="Resumen operativo" className="overflow-x-auto rounded-xl border bg-card"><div className="flex min-w-max divide-x sm:min-w-0">{metrics.map((metric) => <OperationalMetric key={metric.id} metric={metric} />)}</div></section>;
}

export function FocusQueueItem({ item }: { item: FocusItemModel }) {
  const Icon = toneIconMap[item.tone];
  return (
    <div className="flex flex-col gap-3 border-b px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg", toneStyles[item.tone].soft, toneStyles[item.tone].text)}><Icon className="size-4" aria-hidden /></span>
        <div className="min-w-0">
          <SemanticStatusDot tone={item.tone} label={item.category} />
          <p className="mt-1 truncate text-sm font-medium text-foreground">{item.title}</p>
          <EntityMeta>{item.context} · {item.dueText}</EntityMeta>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
        {item.amount !== undefined ? <span className="font-mono text-sm font-medium">{formatCurrency(item.amount, item.currency)}</span> : null}
        {item.detailsHref ? <Link href={item.detailsHref} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{item.detailsLabel ?? "Detalles"}<FileText className="size-3.5" aria-hidden /></Link> : null}
        <Link href={item.href} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-primary/25 px-3 text-xs font-medium text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{item.actionLabel}<ArrowUpRight className="size-3.5" aria-hidden /></Link>
      </div>
    </div>
  );
}

export function FocusQueue({ items }: { items: FocusItemModel[] }) {
  return <section aria-labelledby="focus-queue-title" className="rounded-xl border bg-card"><div className="flex items-center justify-between border-b px-4 py-4"><div><h2 id="focus-queue-title" className="text-base font-semibold">Enfoque ahora</h2><p className="mt-1 text-xs text-muted-foreground">Lo que requiere una acción primero.</p></div><Link href="/operations?view=pending" className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Ver pendientes<ChevronRight className="size-3.5" aria-hidden /></Link></div>{items.length ? <div>{items.map((item) => <FocusQueueItem key={item.id} item={item} />)}</div> : <EmptyOperationalState message="Todo el trabajo está dentro de fecha." />}</section>;
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
