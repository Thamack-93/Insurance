import Link from "next/link";
import { ArrowRight, CalendarClock, CalendarCheck2, CircleAlert, ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getRenewalStats, getUpcomingRenewals, createRenewalTasks, sendRenewalReminders } from "@/lib/renewals";
import { daysUntil, formatDate, today } from "@/lib/dates";
import { formatCurrency, toNumber } from "@/lib/money";

export default async function RenewalsPage() {
  const now = today();
  
  // Auto-create renewal tasks and send reminders
  await createRenewalTasks();
  await sendRenewalReminders();
  
  // Get renewal statistics and upcoming renewals
  const stats = await getRenewalStats();
  const upcomingRenewals = await getUpcomingRenewals(60);
  
  // Filter renewals by priority
  const urgentRenewals = upcomingRenewals.filter(r => r.priority === "URGENT");
  const highPriorityRenewals = upcomingRenewals.filter(r => r.priority === "HIGH");
  const mediumPriorityRenewals = upcomingRenewals.filter(r => r.priority === "MEDIUM");

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Operación"
          title="Renovaciones"
          description="Gestión automática de renovaciones de pólizas y recordatorios."
          actions={
            <Button asChild className="rounded-full">
              <Link href="/tasks">
                Ver Tareas
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Vencidas"
            value={stats.overdueCount}
            description="Pólizas que requieren atención inmediata."
            icon={CircleAlert}
            tone="rose"
          />
          <MetricCard
            title="Próximos 30 días"
            value={stats.next30DaysCount}
            description="Renovaciones que vencerán pronto."
            icon={CalendarClock}
            tone="amber"
          />
          <MetricCard
            title="Próximos 60 días"
            value={stats.next60DaysCount}
            description="Ventana de planificación media."
            icon={CalendarCheck2}
            tone="blue"
          />
          <MetricCard
            title="Prima Total"
            value={formatCurrency(stats.totalRenewalPremium)}
            description={`Promedio: ${formatCurrency(stats.averagePremium)}`}
            icon={ClipboardList}
            tone="emerald"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <SectionCard title="Renovaciones Urgentes" description="Requieren atención inmediata.">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/70">
                  <TableHead>Póliza</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Aseguradora</TableHead>
                  <TableHead>Vencimiento</TableHead>
                  <TableHead className="text-right">Prima</TableHead>
                  <TableHead>Días</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {urgentRenewals.slice(0, 10).map((renewal: any) => (
                  <TableRow key={renewal.policyId}>
                    <TableCell>
                      <Link href={`/policies/${renewal.policyId}`} className="font-medium text-foreground hover:text-primary">
                        {renewal.policyNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{renewal.clientName}</TableCell>
                    <TableCell>{renewal.insurerName}</TableCell>
                    <TableCell>{formatDate(renewal.renewalDate)}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(renewal.premiumAmount)}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium bg-red-100 text-red-800">
                        {renewal.daysUntilRenewal}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>

          <SectionCard title="Acciones Automáticas" description="Tareas y recordatorios generados.">
            <div className="space-y-4">
              <div className="rounded-lg bg-stone-50 p-4">
                <h4 className="font-medium mb-2">Tareas Creadas</h4>
                <p className="text-sm text-muted-foreground">
                  Se han creado automáticamente {urgentRenewals.length + highPriorityRenewals.length} tareas de renovación.
                </p>
                <Button asChild className="mt-2 w-full" size="sm">
                  <Link href="/tasks">
                    Ver Todas las Tareas
                  </Link>
                </Button>
              </div>

              <div className="rounded-lg bg-stone-50 p-4">
                <h4 className="font-medium mb-2">Recordatorios Enviados</h4>
                <p className="text-sm text-muted-foreground">
                  {urgentRenewals.length + highPriorityRenewals.length} recordatorios automáticos enviados a clientes y agentes.
                </p>
              </div>

              <div className="rounded-lg bg-stone-50 p-4">
                <h4 className="font-medium mb-2">Próximas Acciones</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Contactar clientes urgentes hoy</li>
                  <li>• Preparar cotizaciones de renovación</li>
                  <li>• Coordinar con aseguradoras</li>
                  <li>• Actualizar estados de pólizas</li>
                </ul>
              </div>
            </div>
          </SectionCard>
        </section>

        <SectionCard title="Todas las Renovaciones Próximas" description="Lista completa de renovaciones en los próximos 60 días.">
          <Table>
            <TableHeader>
              <TableRow className="bg-stone-50/70">
                <TableHead>Póliza</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Aseguradora</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead className="text-right">Prima</TableHead>
                <TableHead>Días Restantes</TableHead>
                <TableHead>Prioridad</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {upcomingRenewals.map((renewal: any) => (
                <TableRow key={renewal.policyId}>
                  <TableCell>
                    <Link href={`/policies/${renewal.policyId}`} className="font-medium text-foreground hover:text-primary">
                      {renewal.policyNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{renewal.clientName}</TableCell>
                  <TableCell>{renewal.insurerName}</TableCell>
                  <TableCell>{renewal.policyType}</TableCell>
                  <TableCell>{formatDate(renewal.renewalDate)}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(renewal.premiumAmount)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                      renewal.daysUntilRenewal <= 0 
                        ? 'bg-red-100 text-red-800'
                        : renewal.daysUntilRenewal <= 15
                        ? 'bg-orange-100 text-orange-800'
                        : renewal.daysUntilRenewal <= 30
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-green-100 text-green-800'
                    }`}>
                      {renewal.daysUntilRenewal}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={renewal.priority} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      </div>
    </main>
  );
}
