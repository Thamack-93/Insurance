import Link from "next/link";
import { ArrowUpRight, ChevronDown, FileUp, Plus, ReceiptText } from "@/components/icons";
import { getSession } from "@/lib/auth";
import { getOnboardingStatusFromDb, getTodayDataFromDb } from "@/lib/dashboard-queries";
import { requireOrganizationPortfolioReadScope } from "@/lib/portfolio-access";
import { withTenantTransaction } from "@/lib/tenant-dal";
import { formatDate, formatRelativeDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";
import { buildTodayOperationsModel } from "@/lib/today-operations";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { LocalNavigation } from "@/components/layout/local-navigation";
import { todayNavigation } from "@/lib/navigation";
import { InsightsView } from "@/components/dashboard/insights-view";
import { OnboardingChecklist } from "@/components/dashboard/onboarding-checklist";
import {
  EmptyOperationalState,
  EntityMeta,
  FocusQueue,
  OperationalRow,
  OperationalSection,
  OperationalSummary,
  SemanticStatusDot,
} from "@/components/operations/operational-components";
import { buttonVariants } from "@/components/ui/button";
import { NoraOpenButton } from "@/components/assistant/nora-session-provider";


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

  const scope = await requireOrganizationPortfolioReadScope();
  const [todayData, session] = await Promise.all([
    withTenantTransaction(scope.context, async (db) => {
      const [data, onboarding] = await Promise.all([
        getTodayDataFromDb(scope, db),
        getOnboardingStatusFromDb(scope, db),
      ]);
      return { data, onboarding };
    }),
    getSession(),
  ]);
  const { data, onboarding } = todayData;
  const model = buildTodayOperationsModel(data, { name: session?.name });
  const focusedReceiptIds = new Set<string>();
  const focusedPolicyIds = new Set<string>();
  for (const item of model.focusItems) {
    if (item.actionContext?.type === "collection") focusedReceiptIds.add(item.actionContext.receiptId);
    if (item.actionContext?.type === "renewal") focusedPolicyIds.add(item.actionContext.policyId);
  }
  const otherUpcomingPayments = data.paymentsDue7.filter((receipt) => !focusedReceiptIds.has(receipt.id));
  const otherUpcomingRenewals = data.urgentRenewals.filter((policy) => !focusedPolicyIds.has(policy.id));

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

      {!onboarding.complete && !onboarding.dismissed ? <OnboardingChecklist status={onboarding} role={session?.role} /> : null}

      <section aria-labelledby="today-action-zone" className="space-y-4">
        <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-3 sm:p-4">
          <h2 id="today-action-zone" className="font-display text-xl font-medium tracking-tight">Requiere acción hoy</h2>
          <p className="mt-1 text-sm text-muted-foreground">Primero, las tareas urgentes. Los elementos de abajo excluyen lo que ya aparece en esta lista.</p>
        </div>

        <FocusQueue items={model.focusItems} />

        <div className="grid gap-4 lg:grid-cols-2">
          <OperationalSection
            title="Otros cobros próximos"
            description="Dentro de siete días; los que requieren acción hoy aparecen arriba."
            action={<Link href="/receipts?tab=cobrar" className="rounded-md p-1 text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Ver próximos cobros"><ArrowUpRight className="size-4" aria-hidden /></Link>}
          >
            {otherUpcomingPayments.length ? otherUpcomingPayments.slice(0, 6).map((receipt) => (
              <OperationalRow key={receipt.id}>
                <Link href={`/receipts/${receipt.id}`} className="min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <p className="truncate text-sm font-medium">{receipt.client.fullName}</p>
                  <EntityMeta>{receipt.policy.policyNumber} · {formatRelativeDate(receipt.dueDate)}</EntityMeta>
                </Link>
                <span className="shrink-0 font-mono text-sm">{formatCurrency(receipt.amount, receipt.currency)}</span>
              </OperationalRow>
            )) : <EmptyOperationalState message={data.paymentsDue7.length ? "Los cobros próximos ya aparecen en Enfoque ahora." : "No hay cobros próximos."} />}
          </OperationalSection>

          <OperationalSection
            title="Otras renovaciones"
            description="Vencen dentro de 30 días; los seguimientos urgentes aparecen arriba."
            action={<Link href="/operations?view=renewals" className="rounded-md p-1 text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Ver renovaciones"><ArrowUpRight className="size-4" aria-hidden /></Link>}
          >
            {otherUpcomingRenewals.length ? otherUpcomingRenewals.slice(0, 6).map((policy) => (
              <OperationalRow key={policy.id}>
                <Link href={`/policies/${policy.id}`} className="min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <p className="truncate text-sm font-medium">{policy.client.fullName}</p>
                  <EntityMeta>{policy.policyNumber} · {formatDate(policy.endDate)}</EntityMeta>
                </Link>
                <SemanticStatusDot tone="success" label="Próxima" />
              </OperationalRow>
            )) : <EmptyOperationalState message={data.urgentRenewals.length ? "Las renovaciones prioritarias ya aparecen en Enfoque ahora." : "No hay renovaciones próximas."} />}
          </OperationalSection>
        </div>

      </section>

      <details className="group overflow-hidden rounded-xl border border-border/70 bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 marker:content-none [&::-webkit-details-marker]:hidden">
          <span className="font-medium">Comisiones e indicadores</span>
          <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-4 border-t border-border/70 p-4">
          <OperationalSummary metrics={model.summaryMetrics} />
          <OperationalSection
            title="Comisiones por revisar"
            description="Esperadas o vencidas."
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
      </details>

      <details className="group overflow-hidden rounded-xl border border-border/70 bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 marker:content-none [&::-webkit-details-marker]:hidden">
          <span className="font-medium">Más acciones</span>
          <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-2 border-t border-border/70 p-3 sm:flex-row sm:flex-wrap">
          <NoraOpenButton label="Registrar pago con Nora" prompt="Quiero registrar un pago. Ayúdame a localizar el recibo." variant="outline" className="min-h-11 justify-start sm:w-auto" />
          <Link href="/policies/capture" className={cn(buttonVariants({ variant: "outline" }), "min-h-11 justify-start sm:w-auto")}><FileUp className="size-4" />Capturar póliza</Link>
          <NoraOpenButton label="Capturar endoso" prompt="Quiero capturar un endoso. Primero ayúdame a seleccionar la póliza." variant="outline" className="min-h-11 justify-start sm:w-auto" />
        </div>
      </details>

      <div className="sr-only" aria-live="polite">
        {model.focusItems.length ? `${model.focusItems.length} acciones prioritarias.` : "No hay acciones prioritarias."}
      </div>
    </div>
  );
}
