import Link from "next/link";
import { BarChart3, ArrowRight, CalendarClock, CircleDollarSign, ShieldAlert, ClipboardList } from "lucide-react";
import { LocalNavigation } from "@/components/layout/local-navigation";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { Button } from "@/components/ui/button";
import { ExportButtons } from "@/components/reports/export-buttons";
import { getDb } from "@/lib/db";
import { formatDate, today } from "@/lib/dates";
import { countWorkItems, getWorkItems, OPEN_WORK_ITEM_STATUSES } from "@/lib/work-queue";
import { loadEligibleRenewalPolicies } from "@/lib/renewals";
import {
  clientOperationalWhere,
  commissionOperationalWhere,
  policyOperationalWhere,
  receiptOperationalWhere,
  requirePortfolioReadScope,
} from "@/lib/portfolio-access";

type ReportCard = {
  view: ReportView;
  title: string;
  description: string;
  href: string;
  icon: typeof BarChart3;
  tone: "blue" | "emerald" | "amber" | "rose";
};

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

export default async function ReportsPage({ searchParams }: { searchParams?: Promise<{ view?: string }> }) {
  const view = readReportView((await searchParams)?.view);
  const db = getDb();
  const scope = await requirePortfolioReadScope();
  const now = today();
  const in60 = new Date(now);
  in60.setDate(in60.getDate() + 60);
  const renewalsSoonPromise = loadEligibleRenewalPolicies(
    {
      endDate: {
        gte: now,
        lte: in60,
      },
    },
    scope.portfolioOwnerId,
  );

  const [
    activePolicies,
    dueReceipts,
    renewalsSoonPolicies,
    openWorkItems,
    risks,
    paidCommissions,
    clientsData,
    policiesData,
    receiptsData,
    workItemsData,
  ] = await Promise.all([
    db.policy.count({ where: { ...policyOperationalWhere(scope.portfolioOwnerId), status: "ACTIVE" } }),
    db.receipt.count({ where: { ...receiptOperationalWhere(scope.portfolioOwnerId), dueDate: { gte: now, lte: in60 }, status: { notIn: ["PAID", "CANCELLED"] } } }),
    renewalsSoonPromise,
    countWorkItems({ workItemTypes: ["TASK"], statuses: OPEN_WORK_ITEM_STATUSES, portfolioOwnerId: scope.portfolioOwnerId }),
    db.alert.count({ where: { status: "OPEN" } }),
    db.commission.count({ where: { ...commissionOperationalWhere(scope.portfolioOwnerId), status: "PAID" } }),
    db.client.findMany({
      where: clientOperationalWhere(scope.portfolioOwnerId),
      select: { id: true, fullName: true, email: true, phone: true, type: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    db.policy.findMany({
      where: policyOperationalWhere(scope.portfolioOwnerId),
      select: {
        id: true,
        policyNumber: true,
        policyType: true,
        status: true,
        premiumAmount: true,
        currency: true,
        startDate: true,
        endDate: true,
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    db.receipt.findMany({
      where: receiptOperationalWhere(scope.portfolioOwnerId),
      select: { id: true, receiptNumber: true, status: true, amount: true, currency: true, dueDate: true, paidDate: true },
      orderBy: { dueDate: "desc" },
      take: 1000,
    }),
    getWorkItems({
      workItemTypes: ["TASK"],
      portfolioOwnerId: scope.portfolioOwnerId,
      limit: 1000,
    }),
  ]);

  const exportData = [
    { name: "Clientes", data: clientsData },
    {
      name: "Polizas",
      data: policiesData.map((p) => ({
        ...p,
        premiumAmount: p.premiumAmount ? Number(p.premiumAmount) : null,
      })),
    },
    {
      name: "Recibos",
      data: receiptsData.map((r) => ({
        ...r,
        amount: r.amount ? Number(r.amount) : null,
      })),
    },
    {
      name: "Pendientes",
      data: workItemsData.map((workItem) => ({
        id: workItem.sourceId ?? workItem.id,
        folio: workItem.folio ?? workItem.sourceId ?? workItem.id,
        title: workItem.title,
        workItemType: workItem.workItemType,
        status: workItem.status,
        priority: workItem.priority,
        dueDate: workItem.dueDate,
      })),
    },
  ];

  const reportCards: ReportCard[] = [
    {
      view: "portfolio",
      title: "Cartera por aseguradora",
      description: "Concentración de primas, volumen y cobertura por partner.",
      href: "/reports?view=portfolio",
      icon: BarChart3,
      tone: "blue",
    },
    {
      view: "collections",
      title: "Cobranza 60 días",
      description: "Recibos abiertos, vencidos y próximos a vencer.",
      href: "/receipts?tab=cobrar",
      icon: CircleDollarSign,
      tone: "emerald",
    },
    {
      view: "renewals",
      title: "Renovaciones",
      description: "Pólizas activas que deben moverse antes de perderse.",
      href: "/operations?view=renewals",
      icon: CalendarClock,
      tone: "amber",
    },
    {
      view: "operations",
      title: "Operación diaria",
      description: "Pendientes, bloqueos y seguimiento por prioridad.",
      href: "/operations?view=pending",
      icon: ClipboardList,
      tone: "rose",
    },
    {
      view: "commissions",
      title: "Comisiones",
      description: "Ingreso esperado, cobrado y vencido del canal.",
      href: "/commissions",
      icon: CircleDollarSign,
      tone: "emerald",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Analítica"
          title="Reportes"
          description="Centro temprano de lectura ejecutiva para la operación, la cobranza y la calidad."
          actions={
            <>
              <ExportButtons exports={exportData} />
              {scope.role === "ADMIN" ? (
                <Button asChild><Link href="/settings">Ajustes<ArrowRight className="ml-2 size-4" /></Link></Button>
              ) : null}
            </>
          }
        />

        <LocalNavigation items={localItems} label="Tipos de reporte" />

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <MetricCard title="Pólizas activas" value={activePolicies} description="Base productiva actual." icon={BarChart3} tone="blue" />
          <MetricCard title="Cobranza 60 días" value={dueReceipts} description="Recibos en el radar." icon={CircleDollarSign} tone="emerald" />
          <MetricCard title="Renovaciones" value={renewalsSoonPolicies.length} description="Renovaciones activas del horizonte." icon={CalendarClock} tone="amber" />
          <MetricCard
            title="Alertas abiertas"
            value={risks}
            description={`${openWorkItems} pendientes activos y ${paidCommissions} comisiones ya cobradas.`}
            icon={ShieldAlert}
            tone="rose"
          />
        </section>

        <SectionCard title="Biblioteca de reportes" description={`Última revisión: ${formatDate(now)}.`}>
          <div className="p-4">
            {reportCards.filter((report) => report.view === view).map((report) => {
              const Icon = report.icon;
              return (
                <Link
                  key={report.title}
                  href={report.href}
                  className="group block rounded-xl border bg-card p-5 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="rounded-lg border bg-muted/40 p-3">
                      <Icon className="size-5 text-foreground/80" />
                    </div>
                    <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold tracking-tight">{report.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{report.description}</p>
                </Link>
              );
            })}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
