import Link from "next/link";
import { BarChart3, ArrowRight, CalendarClock, CircleDollarSign, ShieldAlert, ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { Button } from "@/components/ui/button";
import { ExportButtons } from "@/components/reports/export-buttons";
import { getDb } from "@/lib/db";
import { formatDate, today } from "@/lib/dates";

type ReportCard = {
  title: string;
  description: string;
  href: string;
  icon: typeof BarChart3;
  tone: "blue" | "emerald" | "amber" | "rose";
};

export default async function ReportsPage() {
  const db = getDb();
  const now = today();
  const in60 = new Date(now);
  in60.setDate(in60.getDate() + 60);

  const [
    activePolicies,
    dueReceipts,
    renewalsSoon,
    openTasks,
    risks,
    paidCommissions,
    clientsData,
    policiesData,
    receiptsData,
    tasksData,
  ] = await Promise.all([
    db.policy.count({ where: { status: "ACTIVE" } }),
    db.receipt.count({ where: { dueDate: { gte: now, lte: in60 }, status: { notIn: ["PAID", "CANCELLED"] } } }),
    db.policy.count({ where: { status: "ACTIVE", renewalDate: { gte: now, lte: in60 } } }),
    db.task.count({ where: { status: { notIn: ["RESOLVED", "CANCELLED", "ARCHIVED"] } } }),
    db.alert.count({ where: { status: "OPEN" } }),
    db.commission.count({ where: { status: "PAID" } }),
    db.client.findMany({
      select: { id: true, fullName: true, email: true, phone: true, type: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    db.policy.findMany({
      select: {
        id: true,
        policyNumber: true,
        policyType: true,
        status: true,
        premiumAmount: true,
        currency: true,
        startDate: true,
        endDate: true,
        renewalDate: true,
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    db.receipt.findMany({
      select: { id: true, receiptNumber: true, status: true, amount: true, currency: true, dueDate: true, paidDate: true },
      orderBy: { dueDate: "desc" },
      take: 1000,
    }),
    db.task.findMany({
      select: { id: true, folio: true, title: true, taskType: true, status: true, priority: true, dueDate: true },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
  ]);

  const exportData = [
    { name: "Clientes", data: clientsData },
    { name: "Polizas", data: policiesData },
    { name: "Recibos", data: receiptsData },
    { name: "Tareas", data: tasksData },
  ];

  const reportCards: ReportCard[] = [
    {
      title: "Cartera por aseguradora",
      description: "Concentración de primas, volumen y cobertura por partner.",
      href: "/portfolio",
      icon: BarChart3,
      tone: "blue",
    },
    {
      title: "Cobranza 60 días",
      description: "Recibos abiertos, vencidos y próximos a vencer.",
      href: "/due-payments",
      icon: CircleDollarSign,
      tone: "emerald",
    },
    {
      title: "Renovaciones",
      description: "Pólizas activas que deben moverse antes de perderse.",
      href: "/renewals",
      icon: CalendarClock,
      tone: "amber",
    },
    {
      title: "Operación diaria",
      description: "Pendientes, bloqueos y seguimiento por prioridad.",
      href: "/tasks",
      icon: ClipboardList,
      tone: "rose",
    },
    {
      title: "Calidad de datos",
      description: "Riesgos, huecos y consistencia del archivo local.",
      href: "/risks",
      icon: ShieldAlert,
      tone: "blue",
    },
    {
      title: "Comisiones",
      description: "Ingreso esperado, cobrado y vencido del canal.",
      href: "/commissions",
      icon: CircleDollarSign,
      tone: "emerald",
    },
  ];

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Analítica"
          title="Reportes"
          description="Centro temprano de lectura ejecutiva para la operación, la cobranza y la calidad."
          actions={
            <>
              <ExportButtons exports={exportData} />
              <Button asChild className="rounded-full">
                <Link href="/settings">
                  Ajustes
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            </>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Pólizas activas" value={activePolicies} description="Base productiva actual." icon={BarChart3} tone="blue" />
          <MetricCard title="Cobranza 60 días" value={dueReceipts} description="Recibos en el radar." icon={CircleDollarSign} tone="emerald" />
          <MetricCard title="Renovaciones" value={renewalsSoon} description="Renovaciones activas del horizonte." icon={CalendarClock} tone="amber" />
          <MetricCard
            title="Alertas abiertas"
            value={risks}
            description={`${openTasks} tareas activas y ${paidCommissions} comisiones ya cobradas.`}
            icon={ShieldAlert}
            tone="rose"
          />
        </section>

        <SectionCard title="Biblioteca de reportes" description={`Última revisión: ${formatDate(now)}.`}>
          <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
            {reportCards.map((report) => {
              const Icon = report.icon;
              return (
                <Link
                  key={report.title}
                  href={report.href}
                  className="group rounded-3xl border border-white/70 bg-white/80 p-5 shadow-sm shadow-stone-200/70 transition hover:-translate-y-0.5 hover:shadow-xl"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="rounded-2xl border bg-stone-50 p-3">
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
    </main>
  );
}
