import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckSquare, CircleDollarSign, ReceiptText, ShieldCheck } from "@/components/icons";
import { KpiCard } from "@/components/cards/kpi-card";
import { StatGrid } from "@/components/cards/stat-grid";
import { ChartCard } from "@/components/charts/chart-card";
import { CommissionChart, DistributionChart, DuePaymentsChart, RenewalsChart } from "@/components/charts/dashboard-charts";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { getDashboardData } from "@/lib/dashboard-queries";
import { formatCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";

export async function InsightsView() {
  const data = await getDashboardData();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Insights"
        title="Visión operativa y financiera"
        description="Indicadores consolidados de tu cartera para detectar carga, riesgo y oportunidades."
        actions={<Link href="/reports" className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}>Generar reporte</Link>}
      />
      <StatGrid>
        <KpiCard title="Pólizas activas" value={data.kpis.activePolicies} description="Contratos vigentes" href="/policies?status=ACTIVE" icon={ShieldCheck} tone="blue" />
        <KpiCard title="Recibos próximos" value={data.kpis.duePayments60} description="Siguientes 60 días" href="/receipts?tab=cobrar" icon={ReceiptText} tone="green" />
        <KpiCard title="Recibos vencidos" value={data.kpis.overduePayments} description="Requieren atención" href="/receipts?tab=cobrar&due=overdue" icon={AlertTriangle} tone="red" />
        <KpiCard title="Renovaciones" value={data.kpis.renewals60} description="Siguientes 60 días" href="/operations?view=renewals" icon={CalendarClock} tone="amber" />
        <KpiCard title="Pendientes abiertos" value={data.kpis.openWorkItems} description="Trabajo operativo" href="/operations?view=pending" icon={CheckSquare} tone="slate" />
        <KpiCard
          title="Comisiones por cobrar"
          value={data.kpis.commissionsReceivable === null ? "Sin tasa" : formatCurrency(data.kpis.commissionsReceivable, "MXN")}
          description={data.kpis.commissionsReceivableMoney.missingCurrencies.length
            ? `MXN · Sin tasa: ${data.kpis.commissionsReceivableMoney.missingCurrencies.join(", ")}`
            : "MXN · Esperadas o pendientes"}
          href="/commissions"
          icon={CircleDollarSign}
          tone="green"
        />
      </StatGrid>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Vencimientos por semana" description="Recibos abiertos por fecha de vencimiento."><DuePaymentsChart data={data.charts.dueByWeek} /></ChartCard>
        <ChartCard title="Renovaciones por semana" description="Pólizas activas con renovación cercana."><RenewalsChart data={data.charts.renewalsByWeek} /></ChartCard>
        <ChartCard title="Distribución por tipo" description="Composición de la cartera activa."><DistributionChart data={data.charts.policyTypeDistribution} /></ChartCard>
        <ChartCard title="Comisiones esperadas" description="Ingreso esperado por mes."><CommissionChart data={data.charts.commissionsByMonth} /></ChartCard>
      </div>
    </div>
  );
}
