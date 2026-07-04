import Link from "next/link";
import { ArrowRight, CalendarClock, CalendarCheck2, CircleAlert, ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { DaysBadge } from "@/components/badges/days-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-states/empty-state";
import { Pagination } from "@/components/lists/pagination";
import { getOverdueRenewals, getRenewalStats, getUpcomingRenewals, type RenewalOpportunity } from "@/lib/renewals";
import { formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";
import { requirePortfolioReadScope } from "@/lib/portfolio-access";
import { RenewalRowActions } from "@/components/renewals/renewal-row-actions";
import { SortableTableHead } from "@/components/tables/sortable-table-head";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { buildTableHref, readTablePage, readTableSort } from "@/lib/table-query";

export const dynamic = "force-dynamic";

export default async function RenewalsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string; sort?: string; dir?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const query = (params.q ?? "").trim().slice(0, 100).toLowerCase();
  const page = readTablePage(params);
  const { sortKey, direction } = readTableSort(params);

  const scope = await requirePortfolioReadScope();
  const [stats, overdueRenewals, upcomingRenewals] = await Promise.all([
    getRenewalStats(scope.portfolioOwnerId),
    getOverdueRenewals(scope.portfolioOwnerId),
    getUpcomingRenewals(60, scope.portfolioOwnerId),
  ]);

  const matchesQuery = (r: RenewalOpportunity) =>
    [r.policyNumber, r.clientName, r.insurerName, r.policyType]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(query));

  const filteredOverdue = query ? overdueRenewals.filter(matchesQuery) : overdueRenewals;
  const filteredUpcoming = query ? upcomingRenewals.filter(matchesQuery) : upcomingRenewals;

  const priorityWeight: Record<RenewalOpportunity["priority"], number> = {
    URGENT: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
  };

  const sortedUpcoming = [...filteredUpcoming].sort((a, b) => {
    const dir = direction === "desc" ? -1 : 1;
    const compareText = (left: string, right: string) => left.localeCompare(right) * dir;
    const compareDate = (left: Date, right: Date) => (left.getTime() - right.getTime()) * dir;
    const compareNumber = (left: number, right: number) => (left - right) * dir;

    switch (sortKey) {
      case "policy":
        return compareText(a.policyNumber, b.policyNumber) || compareText(a.clientName, b.clientName);
      case "client":
        return compareText(a.clientName, b.clientName) || compareText(a.policyNumber, b.policyNumber);
      case "insurer":
        return compareText(a.insurerName, b.insurerName) || compareText(a.policyNumber, b.policyNumber);
      case "type":
        return compareText(a.policyType, b.policyType) || compareText(a.policyNumber, b.policyNumber);
      case "dueDate":
        return compareDate(a.endDate, b.endDate) || compareText(a.policyNumber, b.policyNumber);
      case "premium":
        return compareNumber(a.premiumAmount, b.premiumAmount) || compareText(a.policyNumber, b.policyNumber);
      case "days":
        return compareNumber(a.daysUntilRenewal, b.daysUntilRenewal) || compareText(a.policyNumber, b.policyNumber);
      case "priority":
        return compareNumber(priorityWeight[a.priority], priorityWeight[b.priority]) || compareText(a.policyNumber, b.policyNumber);
      default:
        return compareDate(a.endDate, b.endDate) || compareText(a.policyNumber, b.policyNumber);
    }
  });

  const totalFiltered = sortedUpcoming.length;
  const start = (page - 1) * DEFAULT_PAGE_SIZE;
  const pagedRenewals = sortedUpcoming.slice(start, start + DEFAULT_PAGE_SIZE);

  const urgentRenewals = filteredUpcoming.filter((r) => r.priority === "URGENT");
  const highPriorityRenewals = filteredUpcoming.filter((r) => r.priority === "HIGH");

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
          <SectionCard title="Renovaciones vencidas" description="Pólizas activas ya vencidas que siguen visibles para seguimiento.">
            {filteredOverdue.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={CircleAlert}
                  title={query ? "Sin vencidas para esta búsqueda" : "Sin renovaciones vencidas"}
                  description={
                    query
                      ? `No encontramos renovaciones vencidas que coincidan con "${query}".`
                      : "No hay pólizas vencidas en la cartera actual."
                  }
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
                    <TableHead className="text-right">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOverdue.slice(0, 10).map((renewal) => (
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
                      <TableCell className="text-right">
                        <RenewalRowActions
                          sourcePolicyId={renewal.policyId}
                          sourcePolicyNumber={renewal.policyNumber}
                          clientName={renewal.clientName}
                          insurerName={renewal.insurerName}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>

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
                    <TableHead className="text-right">Acción</TableHead>
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
                      <TableCell className="text-right">
                        <RenewalRowActions
                          sourcePolicyId={renewal.policyId}
                          sourcePolicyNumber={renewal.policyNumber}
                          clientName={renewal.clientName}
                          insurerName={renewal.insurerName}
                        />
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
          action={<TableToolbar searchPlaceholder="Buscar por póliza, cliente, aseguradora o tipo..." />}
        >
          {sortedUpcoming.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={CalendarClock}
                title={query ? "Sin renovaciones próximas" : "Sin renovaciones próximas"}
                description={
                  query && filteredOverdue.length > 0
                    ? `Sí encontramos ${filteredOverdue.length} vencida${filteredOverdue.length === 1 ? "" : "s"} en la sección superior.`
                    : query
                      ? `No encontramos renovaciones próximas que coincidan con "${query}".`
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
                  actionHref={buildTableHref("/renewals", params, {
                    q: query || null,
                    sort: sortKey ?? null,
                    dir: direction ?? null,
                  })}
                />
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <SortableTableHead sortKey="policy">Póliza</SortableTableHead>
                      <SortableTableHead sortKey="client">Cliente</SortableTableHead>
                      <SortableTableHead sortKey="insurer">Aseguradora</SortableTableHead>
                      <SortableTableHead sortKey="type">Tipo</SortableTableHead>
                      <SortableTableHead sortKey="dueDate">Vencimiento</SortableTableHead>
                      <SortableTableHead sortKey="premium" className="text-right">
                        Prima
                      </SortableTableHead>
                      <SortableTableHead sortKey="days">Días restantes</SortableTableHead>
                      <SortableTableHead sortKey="priority">Prioridad</SortableTableHead>
                    <TableHead className="text-right">Acción</TableHead>
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
                      <TableCell className="text-right">
                        <RenewalRowActions
                          sourcePolicyId={renewal.policyId}
                          sourcePolicyNumber={renewal.policyNumber}
                          clientName={renewal.clientName}
                          insurerName={renewal.insurerName}
                        />
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
                searchParams={{ q: query, sort: sortKey ?? undefined, dir: direction ?? undefined }}
              />
            </>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
