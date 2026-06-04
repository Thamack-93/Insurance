import Link from "next/link";
import { ArrowRight, CalendarClock, CalendarCheck2, CircleAlert, ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { DaysBadge } from "@/components/badges/days-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-states/empty-state";
import { ListSearch } from "@/components/lists/list-search";
import { Pagination } from "@/components/lists/pagination";
import { getRenewalStats, getUpcomingRenewals, type RenewalOpportunity } from "@/lib/renewals";
import { formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";
import { requirePortfolioReadScope } from "@/lib/portfolio-access";

export const dynamic = "force-dynamic";

export default async function RenewalsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const query = (params.q ?? "").trim().slice(0, 100).toLowerCase();
  const page = Math.max(1, Number(params.page) || 1);

  const scope = await requirePortfolioReadScope();
  const [stats, upcomingRenewals] = await Promise.all([
    getRenewalStats(scope.portfolioOwnerId),
    getUpcomingRenewals(60, scope.portfolioOwnerId),
  ]);

  const matchesQuery = (r: RenewalOpportunity) =>
    [r.policyNumber, r.clientName, r.insurerName, r.policyType]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(query));

  const filtered = query ? upcomingRenewals.filter(matchesQuery) : upcomingRenewals;

  const totalFiltered = filtered.length;
  const start = (page - 1) * DEFAULT_PAGE_SIZE;
  const pagedRenewals = filtered.slice(start, start + DEFAULT_PAGE_SIZE);

  const urgentRenewals = upcomingRenewals.filter((r) => r.priority === "URGENT");
  const highPriorityRenewals = upcomingRenewals.filter((r) => r.priority === "HIGH");

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Operación"
          title="Renovaciones"
          description="Seguimiento de renovaciones basado en la fecha de vencimiento."
          actions={
            <Button asChild className="rounded-full">
              <Link href="/tasks">
                Ver tareas
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          }
        />

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
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
            title="Prima total"
            value={formatCurrency(stats.totalRenewalPremium)}
            description={`Promedio: ${formatCurrency(stats.averagePremium)}`}
            icon={ClipboardList}
            tone="emerald"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <SectionCard title="Renovaciones urgentes" description="Requieren atención inmediata.">
            {urgentRenewals.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={CalendarCheck2}
                  title="Sin renovaciones urgentes"
                  description="No hay pólizas que requieran atención inmediata."
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Póliza</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Aseguradora</TableHead>
                    <TableHead>Vencimiento</TableHead>
                    <TableHead className="text-right">Prima</TableHead>
                    <TableHead>Días</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {urgentRenewals.slice(0, 10).map((renewal) => (
                    <TableRow key={renewal.policyId}>
                      <TableCell>
                        <Link href={`/policies/${renewal.policyId}`} className="font-medium text-foreground hover:text-primary">
                          {renewal.policyNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{renewal.clientName}</TableCell>
                      <TableCell>{renewal.insurerName}</TableCell>
                      <TableCell>{formatDate(renewal.endDate)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(renewal.premiumAmount)}</TableCell>
                      <TableCell>
                        <DaysBadge days={renewal.daysUntilRenewal} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>

          <SectionCard title="Seguimiento operativo" description="La gestión de tareas y seguimiento vive en la bandeja de trabajo.">
            <div className="space-y-4">
              <div className="rounded-lg bg-muted/40 p-4">
                <h4 className="mb-2 font-medium">Tareas sugeridas</h4>
                <p className="text-sm text-muted-foreground">
                  {urgentRenewals.length + highPriorityRenewals.length} renovaciones requieren atención prioritaria.
                </p>
                <Button asChild className="mt-2 w-full" size="sm">
                  <Link href="/tasks">Ver todas las tareas</Link>
                </Button>
              </div>

              <div className="rounded-lg bg-muted/40 p-4">
                <h4 className="mb-2 font-medium">Seguimiento</h4>
                <p className="text-sm text-muted-foreground">
                  El seguimiento se genera desde procesos de soporte, no al abrir esta pantalla.
                </p>
              </div>

              <div className="rounded-lg bg-muted/40 p-4">
                <h4 className="mb-2 font-medium">Próximas acciones</h4>
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

        <SectionCard
          title="Todas las renovaciones próximas"
          description="Lista paginada con búsqueda por póliza, cliente o aseguradora."
          action={<ListSearch placeholder="Buscar por póliza, cliente, aseguradora o tipo..." />}
        >
          {totalFiltered === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={CalendarClock}
                title={query ? "Sin resultados" : "Sin renovaciones próximas"}
                description={
                  query
                    ? `No encontramos renovaciones que coincidan con "${query}".`
                    : "No hay pólizas con renovación en los próximos 60 días."
                }
              />
            </div>
          ) : pagedRenewals.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={CalendarClock}
                title="Página fuera de rango"
                description="Vuelve al inicio del listado."
                action="Volver al inicio"
                actionHref={query ? `/renewals?q=${encodeURIComponent(query)}` : "/renewals"}
              />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Póliza</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Aseguradora</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Vencimiento</TableHead>
                    <TableHead className="text-right">Prima</TableHead>
                    <TableHead>Días restantes</TableHead>
                    <TableHead>Prioridad</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedRenewals.map((renewal) => (
                    <TableRow key={renewal.policyId}>
                      <TableCell>
                        <Link href={`/policies/${renewal.policyId}`} className="font-medium text-foreground hover:text-primary">
                          {renewal.policyNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{renewal.clientName}</TableCell>
                      <TableCell>{renewal.insurerName}</TableCell>
                      <TableCell>{renewal.policyType}</TableCell>
                      <TableCell>{formatDate(renewal.endDate)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(renewal.premiumAmount)}</TableCell>
                      <TableCell>
                        <DaysBadge days={renewal.daysUntilRenewal} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={renewal.priority} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                page={page}
                pageSize={DEFAULT_PAGE_SIZE}
                total={totalFiltered}
                basePath="/renewals"
                searchParams={{ q: query }}
              />
            </>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
