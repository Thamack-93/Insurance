import Link from "next/link";
import { addDays } from "date-fns";
import { ArrowRight, CalendarClock, CalendarCheck2, CircleAlert, ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { daysUntil, formatDate, today } from "@/lib/dates";
import { formatCurrency, toNumber } from "@/lib/money";

export default async function RenewalsPage() {
  const db = getDb();
  const now = today();
  const in7 = addDays(now, 7);
  const in30 = addDays(now, 30);
  const in60 = addDays(now, 60);

  const [activePolicies, upcoming7, upcoming30, overdueRenewals, noRenewalDate, activePolicyCount] = await Promise.all([
    db.policy.findMany({
      where: { status: "ACTIVE", renewalDate: { not: null } },
      include: { client: true, insurer: true },
      orderBy: { renewalDate: "asc" },
    }),
    db.policy.findMany({
      where: { status: "ACTIVE", renewalDate: { gte: now, lte: in7 } },
      include: { client: true, insurer: true },
      orderBy: { renewalDate: "asc" },
      take: 10,
    }),
    db.policy.findMany({
      where: { status: "ACTIVE", renewalDate: { gt: in7, lte: in30 } },
      include: { client: true, insurer: true },
      orderBy: { renewalDate: "asc" },
      take: 10,
    }),
    db.policy.findMany({
      where: { status: "ACTIVE", renewalDate: { lt: now } },
      include: { client: true, insurer: true },
      orderBy: { renewalDate: "asc" },
      take: 10,
    }),
    db.policy.findMany({
      where: { status: "ACTIVE", renewalDate: null },
      include: { client: true, insurer: true },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
    db.policy.count({ where: { status: "ACTIVE" } }),
  ]);

  const renewalValue60 = activePolicies
    .filter((policy) => policy.renewalDate && policy.renewalDate <= in60)
    .reduce((sum, policy) => sum + toNumber(policy.premiumAmount), 0);

  const withoutRenewalRate = activePolicyCount ? Math.round((noRenewalDate.length / activePolicyCount) * 100) : 0;

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Operación"
          title="Renovaciones"
          description="Seguimiento de renovaciones próximas, vencidas y pólizas que aún no tienen fecha capturada."
          actions={
            <Button asChild className="rounded-full">
              <Link href="/tasks">
                Ir a tareas
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Renovaciones 60 días"
            value={activePolicies.filter((policy) => policy.renewalDate && policy.renewalDate <= in60).length}
            description={formatCurrency(renewalValue60)}
            icon={CalendarClock}
            tone="amber"
          />
          <MetricCard
            title="Próximos 7 días"
            value={upcoming7.length}
            description="Tienen el mayor riesgo de fuga si no se actúa hoy."
            icon={CalendarCheck2}
            tone="blue"
          />
          <MetricCard
            title="Vencidas"
            value={overdueRenewals.length}
            description="Renovaciones que ya pasaron su fecha."
            icon={CircleAlert}
            tone="rose"
          />
          <MetricCard
            title="Sin fecha"
            value={noRenewalDate.length}
            description={`${withoutRenewalRate}% de la cartera activa no tiene renovación capturada.`}
            icon={ClipboardList}
            tone="emerald"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <SectionCard title="Renovaciones urgentes" description="Primero las que caen en los siguientes 7 días.">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/70">
                  <TableHead>Póliza</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Prima</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {upcoming7.map((policy) => (
                  <TableRow key={policy.id}>
                    <TableCell>
                      <Link href={`/policies/${policy.id}`} className="font-medium text-foreground hover:text-primary">
                        {policy.policyNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{policy.client.fullName}</TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {policy.renewalDate ? `${formatDate(policy.renewalDate)} · ${daysUntil(policy.renewalDate)} días` : "Sin fecha"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={policy.status} />
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(policy.premiumAmount, policy.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>

          <SectionCard title="Sin fecha de renovación" description="Pólizas activas que necesitan captura o limpieza de datos.">
            <div className="divide-y divide-stone-200/80">
              {noRenewalDate.map((policy) => (
                <div key={policy.id} className="flex items-start justify-between gap-4 px-4 py-4">
                  <div className="min-w-0">
                    <Link href={`/policies/${policy.id}`} className="font-medium text-foreground hover:text-primary">
                      {policy.policyNumber}
                    </Link>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {policy.client.fullName} · {policy.insurer.name}
                    </p>
                  </div>
                  <StatusBadge status={policy.status} />
                </div>
              ))}
            </div>
          </SectionCard>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <SectionCard title="Renovaciones 8 a 30 días" description="La siguiente cola a preparar.">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/70">
                  <TableHead>Póliza</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Días</TableHead>
                  <TableHead className="text-right">Prima</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {upcoming30.map((policy) => (
                  <TableRow key={policy.id}>
                    <TableCell>{policy.policyNumber}</TableCell>
                    <TableCell>{policy.client.fullName}</TableCell>
                    <TableCell>{policy.renewalDate ? daysUntil(policy.renewalDate) : "—"}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(policy.premiumAmount, policy.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>

          <SectionCard title="Renovaciones vencidas" description="Fuga potencial ya materializada en tiempo.">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/70">
                  <TableHead>Póliza</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Prima</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overdueRenewals.map((policy) => (
                  <TableRow key={policy.id}>
                    <TableCell>{policy.policyNumber}</TableCell>
                    <TableCell>{policy.client.fullName}</TableCell>
                    <TableCell>{policy.renewalDate ? formatDate(policy.renewalDate) : "Sin fecha"}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(policy.premiumAmount, policy.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>
        </section>
      </div>
    </main>
  );
}
