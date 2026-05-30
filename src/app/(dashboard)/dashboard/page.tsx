import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckSquare,
  CircleDollarSign,
  FileWarning,
  ReceiptText,
  ShieldCheck,
  Siren,
} from "lucide-react";
import { KpiCard } from "@/components/cards/kpi-card";
import { RiskAlertCard } from "@/components/cards/risk-alert-card";
import { StatGrid } from "@/components/cards/stat-grid";
import { ChartCard } from "@/components/charts/chart-card";
import {
  CommissionChart,
  DistributionChart,
  DuePaymentsChart,
  RenewalsChart,
} from "@/components/charts/dashboard-charts";
import { PageHeader } from "@/components/layout/page-header";
import { ActivityTimeline } from "@/components/timeline/activity-timeline";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OnboardingChecklist } from "@/components/dashboard/onboarding-checklist";
import { getDashboardData, getOnboardingStatus } from "@/lib/dashboard-queries";
import { formatCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";

export default async function DashboardPage() {
  const [data, onboarding] = await Promise.all([getDashboardData(), getOnboardingStatus()]);
  const topRisks = data.sections.topRisks.slice(0, 3);
  const showOnboarding = !onboarding.complete && !onboarding.dismissed;

  return (
    <div className="space-y-8">
      {showOnboarding ? <OnboardingChecklist status={onboarding} /> : null}
      <PageHeader
        eyebrow="Cockpit operativo"
        title="Tu cartera, en modo control."
        description="Una vista estratégica de KPIs, gráficos y actividad. Para lo accionable del día abre Hoy."
        actions={
          <>
            <Link href="/reports" className={cn(buttonVariants({ variant: "outline" }), "rounded-full bg-card/80")}>
              Generar reporte
            </Link>
            <Link href="/today" className={cn(buttonVariants(), "rounded-full")}>
              Ver qué hacer hoy
            </Link>
          </>
        }
      />

      <StatGrid>
        <KpiCard
          title="Pólizas activas"
          value={data.kpis.activePolicies}
          description="Contratos vigentes en cartera"
          href="/policies"
          icon={ShieldCheck}
          tone="blue"
        />
        <KpiCard
          title="Pagos próx. 60 días"
          value={data.kpis.duePayments60}
          description="Recibos pendientes por vencer"
          href="/due-payments"
          icon={ReceiptText}
          tone="green"
        />
        <KpiCard
          title="Pagos vencidos"
          value={data.kpis.overduePayments}
          description="Requieren seguimiento inmediato"
          href="/today"
          icon={Siren}
          tone="red"
        />
        <KpiCard
          title="Renovaciones 60 días"
          value={data.kpis.renewals60}
          description="Pólizas por renovar pronto"
          href="/renewals"
          icon={CalendarClock}
          tone="amber"
        />
        <KpiCard
          title="Pendientes abiertos"
          value={data.kpis.openWorkItems}
          description="Trabajo operativo activo"
          href="/tasks"
          icon={CheckSquare}
          tone="slate"
        />
        <KpiCard
          title="Pendientes urgentes"
          value={data.kpis.urgentWorkItems}
          description="Prioridad máxima"
          href="/today"
          icon={AlertTriangle}
          tone="red"
        />
        <KpiCard
          title="Comisiones por cobrar"
          value={formatCurrency(data.kpis.commissionsReceivable)}
          description="Esperadas o pendientes"
          href="/commissions"
          icon={CircleDollarSign}
          tone="green"
        />
        <KpiCard
          title="Riesgos detectados"
          value={data.kpis.risksDetected}
          description="Alertas determinísticas"
          href="/risks"
          icon={FileWarning}
          tone="amber"
        />
      </StatGrid>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Vencimientos por semana" description="Recibos abiertos agrupados por fecha de vencimiento.">
          <DuePaymentsChart data={data.charts.dueByWeek} />
        </ChartCard>
        <ChartCard title="Renovaciones por semana" description="Pólizas activas con renovación cercana.">
          <RenewalsChart data={data.charts.renewalsByWeek} />
        </ChartCard>
        <ChartCard title="Distribución por tipo" description="Mix de productos en cartera.">
          <DistributionChart data={data.charts.policyTypeDistribution} />
        </ChartCard>
        <ChartCard title="Comisiones esperadas por mes" description="Ingreso esperado por fecha de comisión.">
          <CommissionChart data={data.charts.commissionsByMonth} />
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-border/60 bg-card/85 shadow-sm backdrop-blur">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="text-lg">Riesgos principales</CardTitle>
            <Link
              href="/risks"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-full bg-card/70")}
            >
              Ver todos
              <ArrowRight className="ml-1 size-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            {topRisks.length === 0 ? (
              <p className="text-sm text-muted-foreground md:col-span-3">
                No hay riesgos abiertos en este momento.
              </p>
            ) : (
              topRisks.map((risk) => (
                <RiskAlertCard
                  key={`${risk.alertType}-${risk.entityId}`}
                  title={risk.title}
                  description={risk.description}
                  severity={risk.severity}
                  action={risk.suggestedAction}
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/85 shadow-sm backdrop-blur">
          <CardHeader>
            <CardTitle className="text-lg">Actividad reciente</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityTimeline items={data.sections.recentActivity} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
