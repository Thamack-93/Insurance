import Link from "next/link";
import { BarChart3, CalendarClock, CircleDollarSign, ClipboardList, Settings2, ShieldAlert } from "lucide-react";
import { LocalNavigation } from "@/components/layout/local-navigation";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard } from "@/components/pages-secondary/panels";
import { ReportDownloadCard, type ReportDownloadDefinition } from "@/components/reports/report-download-card";
import { Button } from "@/components/ui/button";
import { getDb } from "@/lib/db";
import { businessAddDays, businessToday, formatBusinessDateInput } from "@/lib/business-dates";
import { countWorkItems, OPEN_WORK_ITEM_STATUSES } from "@/lib/work-queue";
import { loadEligibleRenewalPolicies } from "@/lib/renewals";
import {
  commissionOperationalWhere,
  policyOperationalWhere,
  receiptOperationalWhere,
  requirePortfolioReadScope,
} from "@/lib/portfolio-access";

type ReportView = "collections" | "renewals" | "portfolio" | "commissions" | "operations";

const localItems = [
  { label: "Cobranza", href: "/reports?view=collections" },
  { label: "Renovaciones", href: "/reports?view=renewals" },
  { label: "Cartera", href: "/reports?view=portfolio" },
  { label: "Comisiones", href: "/reports?view=commissions" },
  { label: "Operación", href: "/reports?view=operations" },
];

function readReportView(value?: string): ReportView {
  return value === "renewals" || value === "portfolio" || value === "commissions" || value === "operations"
    ? value
    : "collections";
}

function buildDefinitions(now: Date): Record<ReportView, ReportDownloadDefinition> {
  const today = formatBusinessDateInput(now);
  const monthAgo = formatBusinessDateInput(businessAddDays(now, -30));
  const quarterAgo = formatBusinessDateInput(businessAddDays(now, -90));
  const in30 = formatBusinessDateInput(businessAddDays(now, 30));
  const yearAgo = formatBusinessDateInput(businessAddDays(now, -365));

  return {
    collections: {
      type: "overdue",
      title: "Reporte de cobranza",
      description: "Recibos vencidos o abiertos con cliente, póliza, aseguradora, fecha e importe.",
      dateLabel: "El rango se aplica a la fecha de vencimiento",
      defaultFrom: quarterAgo,
      defaultTo: today,
      filterLabel: "Alcance",
      defaultFilter: "overdue",
      filterOptions: [
        { label: "Sólo vencidos", value: "overdue" },
        { label: "Todos los abiertos", value: "open" },
        { label: "Todos los estados", value: "all" },
      ],
    },
    renewals: {
      type: "renewals",
      title: "Reporte de renovaciones",
      description: "Pólizas por vencer con cliente, vigencia, ramo, aseguradora y prima.",
      dateLabel: "El rango se aplica al fin de vigencia de la póliza",
      defaultFrom: today,
      defaultTo: in30,
      filterLabel: "Estado de póliza",
      defaultFilter: "active",
      filterOptions: [
        { label: "Sólo activas", value: "active" },
        { label: "Todos los estados", value: "all" },
      ],
    },
    portfolio: {
      type: "portfolio",
      title: "Reporte de cartera",
      description: "Inventario de pólizas con cliente, aseguradora, vigencia, ramo y prima.",
      dateLabel: "El rango incluye pólizas con vigencia durante el período",
      defaultFrom: yearAgo,
      defaultTo: today,
      filterLabel: "Estado de póliza",
      defaultFilter: "active",
      filterOptions: [
        { label: "Activas", value: "active" },
        { label: "Vencidas", value: "expired" },
        { label: "Todos los estados", value: "all" },
      ],
    },
    commissions: {
      type: "commissions",
      title: "Reporte de comisiones y bonos",
      description: "Comisiones esperadas y pagadas. No incluye cálculos ficticios de bonos.",
      dateLabel: "El rango se aplica a la fecha esperada de la comisión",
      defaultFrom: monthAgo,
      defaultTo: in30,
      filterLabel: "Estado",
      defaultFilter: "pending",
      filterOptions: [
        { label: "Pendientes", value: "pending" },
        { label: "Pagadas", value: "paid" },
        { label: "Todos los estados", value: "all" },
      ],
    },
    operations: {
      type: "operations",
      title: "Reporte de operación",
      description: "Pendientes con cliente, póliza, prioridad, estado y fecha límite.",
      dateLabel: "El rango se aplica a la fecha límite del pendiente",
      defaultFrom: monthAgo,
      defaultTo: in30,
      filterLabel: "Prioridad y estado",
      defaultFilter: "open",
      filterOptions: [
        { label: "Todos los abiertos", value: "open" },
        { label: "Sólo urgentes", value: "urgent" },
        { label: "Prioridad alta", value: "high" },
        { label: "Incluye cerrados", value: "all" },
      ],
    },
  };
}

export default async function ReportsPage({ searchParams }: { searchParams?: Promise<{ view?: string }> }) {
  const view = readReportView((await searchParams)?.view);
  const db = getDb();
  const scope = await requirePortfolioReadScope();
  const now = businessToday();
  const in60 = businessAddDays(now, 60);

  const [activePolicies, dueReceipts, renewalsSoonPolicies, openWorkItems, risks, paidCommissions] = await Promise.all([
    db.policy.count({ where: { ...policyOperationalWhere(scope.portfolioOwnerId), status: "ACTIVE" } }),
    db.receipt.count({ where: { ...receiptOperationalWhere(scope.portfolioOwnerId), dueDate: { gte: now, lte: in60 }, status: { notIn: ["PAID", "CANCELLED"] } } }),
    loadEligibleRenewalPolicies({ endDate: { gte: now, lte: in60 } }, scope.portfolioOwnerId),
    countWorkItems({ statuses: OPEN_WORK_ITEM_STATUSES, portfolioOwnerId: scope.portfolioOwnerId }),
    db.alert.count({ where: { status: "OPEN" } }),
    db.commission.count({ where: { ...commissionOperationalWhere(scope.portfolioOwnerId), status: "PAID" } }),
  ]);
  const definition = buildDefinitions(now)[view];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <PageHeader
        eyebrow="Documentos"
        title="Reportes"
        description="Filtra, revisa y descarga documentos Excel sin abandonar esta página."
        actions={scope.role === "ADMIN" ? <Button asChild variant="outline"><Link href="/settings"><Settings2 className="size-4" />Ajustes</Link></Button> : undefined}
      />

      <LocalNavigation items={localItems} label="Tipos de reporte" />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Resumen de reportes">
        <MetricCard title="Pólizas activas" value={activePolicies} description="Base productiva actual." icon={BarChart3} tone="blue" />
        <MetricCard title="Cobranza 60 días" value={dueReceipts} description="Recibos en el radar." icon={CircleDollarSign} tone="emerald" />
        <MetricCard title="Renovaciones" value={renewalsSoonPolicies.length} description="Pólizas del horizonte." icon={CalendarClock} tone="amber" />
        <MetricCard title="Atención operativa" value={risks + openWorkItems} description={`${openWorkItems} pendientes · ${paidCommissions} comisiones pagadas.`} icon={view === "operations" ? ClipboardList : ShieldAlert} tone="rose" />
      </section>

      <ReportDownloadCard key={view} definition={definition} />
    </div>
  );
}
