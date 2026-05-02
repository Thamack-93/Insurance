import Link from "next/link";
import {
  AlertTriangle,
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
import { StatusBadge } from "@/components/badges/status-badge";
import { PageHeader, SectionHeader } from "@/components/layout/page-header";
import { ActivityTimeline } from "@/components/timeline/activity-timeline";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardData } from "@/lib/dashboard-queries";
import { daysUntil, formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";
import { policyTypeLabel } from "@/lib/status";
import { cn } from "@/lib/utils";

export default async function DashboardPage() {
  const data = await getDashboardData();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Cockpit operativo"
        title="Tu cartera, en modo control."
        description="Pagos, renovaciones, pendientes, comisiones y riesgos conectados para decidir en segundos que atender primero."
        actions={
          <>
            <Link href="/reports" className={cn(buttonVariants({ variant: "outline" }), "rounded-full bg-white/80")}>
              Generar reporte
            </Link>
            <Link href="/today" className={cn(buttonVariants(), "rounded-full")}>
              Ver que hacer hoy
            </Link>
          </>
        }
      />

      <StatGrid>
        <KpiCard
          title="Polizas activas"
          value={data.kpis.activePolicies}
          description="Contratos vigentes en cartera"
          href="/policies"
          icon={ShieldCheck}
          tone="blue"
        />
        <KpiCard
          title="Pagos prox. 60 dias"
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
          href="/due-payments"
          icon={Siren}
          tone="red"
        />
        <KpiCard
          title="Renovaciones 60 dias"
          value={data.kpis.renewals60}
          description="Polizas por renovar pronto"
          href="/renewals"
          icon={CalendarClock}
          tone="amber"
        />
        <KpiCard
          title="Pendientes abiertos"
          value={data.kpis.openTasks}
          description="Trabajo operativo activo"
          href="/tasks"
          icon={CheckSquare}
          tone="slate"
        />
        <KpiCard
          title="Pendientes urgentes"
          value={data.kpis.urgentTasks}
          description="Prioridad maxima"
          href="/tasks"
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
          description="Alertas deterministicas"
          href="/risks"
          icon={FileWarning}
          tone="amber"
        />
      </StatGrid>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Vencimientos por semana" description="Recibos abiertos agrupados por fecha de vencimiento.">
          <DuePaymentsChart data={data.charts.dueByWeek} />
        </ChartCard>
        <ChartCard title="Renovaciones por semana" description="Polizas activas con renovacion cercana.">
          <RenewalsChart data={data.charts.renewalsByWeek} />
        </ChartCard>
        <ChartCard title="Distribucion por tipo" description="Mix de productos en cartera.">
          <DistributionChart data={data.charts.policyTypeDistribution} />
        </ChartCard>
        <ChartCard title="Comisiones esperadas por mes" description="Ingreso esperado por fecha de comision.">
          <CommissionChart data={data.charts.commissionsByMonth} />
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="border-white/70 bg-white/84 shadow-sm shadow-stone-200/70 backdrop-blur">
          <CardHeader>
            <SectionHeader title="Pagos urgentes" description="Vencidos o por vencer en los proximos 7 dias." />
          </CardHeader>
          <CardContent className="space-y-3">
            {data.sections.urgentPayments.map((receipt) => (
              <Link
                key={receipt.id}
                href="/due-payments"
                className="flex items-center justify-between gap-4 rounded-2xl border bg-white/70 p-4 transition hover:border-primary/20 hover:shadow-sm"
              >
                <div>
                  <p className="font-medium">{receipt.client.fullName}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {receipt.policy.policyNumber} · {receipt.receiptNumber} · {policyTypeLabel(receipt.policy.policyType)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{formatCurrency(receipt.amount, receipt.currency)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(receipt.dueDate)} · {daysUntil(receipt.dueDate)} dias
                  </p>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="border-white/70 bg-white/84 shadow-sm shadow-stone-200/70 backdrop-blur">
          <CardHeader>
            <SectionHeader title="Pendientes criticos" description="Urgentes, atrasados o bloqueados." />
          </CardHeader>
          <CardContent className="space-y-3">
            {data.sections.criticalTasks.map((task) => (
              <Link key={task.id} href="/tasks" className="block rounded-2xl border bg-white/70 p-4 transition hover:border-primary/20">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{task.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {task.folio} · {task.client?.fullName ?? "Sin cliente"}
                    </p>
                  </div>
                  <StatusBadge status={task.status} />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="border-white/70 bg-white/84 shadow-sm shadow-stone-200/70 backdrop-blur xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Riesgos principales</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {data.sections.topRisks.map((risk) => (
              <RiskAlertCard
                key={`${risk.alertType}-${risk.entityId}`}
                title={risk.title}
                description={risk.description}
                severity={risk.severity}
                action={risk.suggestedAction}
              />
            ))}
          </CardContent>
        </Card>

        <Card className="border-white/70 bg-white/84 shadow-sm shadow-stone-200/70 backdrop-blur">
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
