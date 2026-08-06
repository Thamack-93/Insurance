import Link from "next/link";
import { ArrowUpRight, FileSignature, FileUp, Plus, ReceiptText } from "lucide-react";
import { getSession } from "@/lib/auth";
import { getTodayDashboardData, getTodayData } from "@/lib/dashboard-queries";
import { formatDate, formatRelativeDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";
import { buildTodayOperationsModel } from "@/lib/today-operations";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { LocalNavigation } from "@/components/layout/local-navigation";
import { InsightsView } from "@/components/dashboard/insights-view";
import { AlertsPanel, PolicyActivityChart, PolicyStatusDonut, RecentPoliciesTable, TodayMetricCards } from "@/components/dashboard/today-dashboard";
import {
  EmptyOperationalState,
  EntityMeta,
  FocusQueue,
  OperationalRow,
  OperationalSection,
  SemanticStatusDot,
} from "@/components/operations/operational-components";
import { buttonVariants } from "@/components/ui/button";
import { NoraOpenButton } from "@/components/assistant/nora-session-provider";

const todayNavigation = [
  { label: "Mi día", href: "/today", excludeQueryKeys: ["view"] },
  { label: "Insights", href: "/today?view=insights" },
];

export default async function TodayPage({ searchParams }: { searchParams?: Promise<{ view?: string }> }) {
  const params = (await searchParams) ?? {};

  if (params.view === "insights") {
    return (
      <div className="space-y-5">
        <LocalNavigation items={todayNavigation} label="Vistas de Hoy" />
        <InsightsView />
      </div>
    );
  }

  const [data, session, dashboard] = await Promise.all([getTodayData(), getSession(), getTodayDashboardData()]);
  const model = buildTodayOperationsModel(data, { name: session?.name });

  return (
    <div className="space-y-6">
      <LocalNavigation items={todayNavigation} label="Vistas de Hoy" />
      <PageHeader
        eyebrow="Hoy"
        title={model.greeting}
        description={model.summary}
        metadata={<time dateTime={model.dateTime}>{model.dateLabel}</time>}
        actions={
          <>
            <Link href="/receipts?tab=cobrar" className={cn(buttonVariants({ variant: "outline" }), "min-h-11") }>
              <ReceiptText className="size-4" aria-hidden />
              Cobrar recibos
            </Link>
            <Link href="/tasks/new" className={cn(buttonVariants(), "min-h-11") }>
              <Plus className="size-4" aria-hidden />
              Crear pendiente
            </Link>
          </>
        }
      />

      <TodayMetricCards metrics={dashboard.metrics} prevMonthLabel={dashboard.prevMonthLabel} />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2"><PolicyActivityChart data={dashboard.activity} /></div>
        <PolicyStatusDonut data={dashboard.statusDistribution} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2"><RecentPoliciesTable policies={dashboard.recentPolicies} /></div>
        <AlertsPanel alerts={dashboard.alerts} />
      </div>

      <section aria-labelledby="today-quick-actions">
        <h2 id="today-quick-actions" className="mb-2 text-sm font-semibold">Acciones rápidas</h2>
        <div className="flex flex-col gap-2 rounded-xl border bg-card p-2.5 sm:flex-row sm:flex-wrap">
          <NoraOpenButton label="Registrar pago" prompt="Quiero registrar un pago. Ayúdame a localizar el recibo." variant="default" className="min-h-11 justify-start sm:w-auto" />
          <Link href="/policies/capture" className={cn(buttonVariants({ variant: "outline" }), "min-h-11 justify-start sm:w-auto")}><FileUp className="size-4" />Capturar póliza</Link>
          <NoraOpenButton label="Capturar endoso" prompt="Quiero capturar un endoso. Primero ayúdame a seleccionar la póliza." className="min-h-11 justify-start sm:w-auto" />
          <Link href="/tasks/new" className={cn(buttonVariants({ variant: "ghost" }), "min-h-11 justify-start sm:ml-auto sm:w-auto")}><FileSignature className="size-4" />Crear pendiente</Link>
        </div>
      </section>

      <FocusQueue items={model.focusItems} />

      <div className="grid gap-4 lg:grid-cols-3">
        <OperationalSection
          title="Próximos cobros"
          description="Recibos de los próximos siete días."
          action={<Link href="/receipts?tab=cobrar" className="rounded-md p-1 text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Ver próximos cobros"><ArrowUpRight className="size-4" aria-hidden /></Link>}
        >
          {data.paymentsDue7.length ? data.paymentsDue7.map((receipt) => (
            <OperationalRow key={receipt.id}>
              <Link href={`/receipts/${receipt.id}`} className="min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <p className="truncate text-sm font-medium">{receipt.client.fullName}</p>
                <EntityMeta>{receipt.policy.policyNumber} · {formatRelativeDate(receipt.dueDate)}</EntityMeta>
              </Link>
              <span className="shrink-0 font-mono text-sm">{formatCurrency(receipt.amount, receipt.currency)}</span>
            </OperationalRow>
          )) : <EmptyOperationalState message="No hay cobros próximos." />}
        </OperationalSection>

        <OperationalSection
          title="Renovaciones"
          description="Pólizas que vencen en los próximos 30 días."
          action={<Link href="/operations?view=renewals" className="rounded-md p-1 text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Ver renovaciones"><ArrowUpRight className="size-4" aria-hidden /></Link>}
        >
          {data.urgentRenewals.length ? data.urgentRenewals.slice(0, 6).map((policy) => (
            <OperationalRow key={policy.id}>
              <Link href={`/policies/${policy.id}`} className="min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <p className="truncate text-sm font-medium">{policy.client.fullName}</p>
                <EntityMeta>{policy.policyNumber} · {formatDate(policy.endDate)}</EntityMeta>
              </Link>
              <SemanticStatusDot tone="success" label="Próxima" />
            </OperationalRow>
          )) : <EmptyOperationalState message="No hay renovaciones urgentes." />}
        </OperationalSection>

        <OperationalSection
          title="Comisiones"
          description="Esperadas o vencidas para revisar."
          action={<Link href="/commissions" className="rounded-md p-1 text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Ver comisiones"><ArrowUpRight className="size-4" aria-hidden /></Link>}
        >
          {data.commissionsToReview.length ? data.commissionsToReview.slice(0, 6).map((commission) => (
            <OperationalRow key={commission.id}>
              <Link href="/commissions" className="min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <p className="truncate text-sm font-medium">{commission.client.fullName}</p>
                <EntityMeta>{formatRelativeDate(commission.expectedDate)} · {commission.policy.policyNumber}</EntityMeta>
              </Link>
              <span className="shrink-0 font-mono text-sm">{formatCurrency(commission.actualAmount ?? commission.expectedAmount, commission.policy.currency)}</span>
            </OperationalRow>
          )) : <EmptyOperationalState message="No hay comisiones por revisar." />}
        </OperationalSection>
      </div>

      <div className="sr-only" aria-live="polite">
        {model.focusItems.length ? `${model.focusItems.length} acciones prioritarias.` : "No hay acciones prioritarias."}
      </div>
    </div>
  );
}
