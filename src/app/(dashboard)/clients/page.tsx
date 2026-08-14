import Link from "next/link";
import { ArrowRight, Building2, FileText, Users2, UserRound } from "@/components/icons";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableHead, TableHeader, TableRow, TableCell } from "@/components/ui/table";
import { ClientsListTable } from "@/components/clients/clients-list-table";
import { EmptyState } from "@/components/empty-states/empty-state";
import { TableEmptyState } from "@/components/tables/table-empty-state";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { getDb } from "@/lib/db";
import { formatCurrency, toNumber } from "@/lib/money";
import { entityStatusOptions } from "@/lib/domain-options";
import { buildTableHref } from "@/lib/table-query";
import {
  buildClientListOrderBy,
  buildClientListWhere,
  readClientListFilters,
} from "@/lib/list-filters";
import { LocalNavigation } from "@/components/layout/local-navigation";
import { clientOperationalWhere, requireOrganizationPortfolioReadScope } from "@/lib/portfolio-access";

const PAGE_SIZE = 25;

export default async function ClientsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string; sort?: string; dir?: string; status?: string; type?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const filters = readClientListFilters(params);
  const { query, page, sortKey, direction } = filters;
  const statusFilter = filters.status;
  const typeFilter = filters.type;
  const isFiltered = Boolean(query || statusFilter || typeFilter);

  const db = getDb();
  const scope = await requireOrganizationPortfolioReadScope();
  const portfolioWhere = clientOperationalWhere(scope.portfolioOwnerId, scope.organizationId);
  const clearFiltersHref = buildTableHref("/clients", params, {
    q: null,
    status: null,
    type: null,
    page: null,
  });

  const where = buildClientListWhere(filters, scope.portfolioOwnerId, scope.organizationId);
  const orderBy = buildClientListOrderBy(filters);

  const [
    activeCount,
    companiesCount,
    noPolicyCount,
    totalCount,
    filteredCount,
    pagedClients,
    topPortfolio,
  ] = await Promise.all([
    db.client.count({ where: { ...portfolioWhere, status: "ACTIVE" } }),
    db.client.count({ where: { ...portfolioWhere, type: "COMPANY" } }),
    db.client.count({ where: { ...portfolioWhere, policies: { none: {} } } }),
    db.client.count({ where: portfolioWhere }),
    db.client.count({ where }),
    db.client.findMany({
      where,
      orderBy,
      include: {
        _count: { select: { policies: true, receipts: true, tasks: true } },
      },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.client.findMany({
      where: { ...portfolioWhere, status: "ACTIVE" },
      include: {
        policies: { where: { status: "ACTIVE" }, select: { premiumAmount: true } },
      },
      take: 50,
    }),
  ]);

  const topByPortfolio = topPortfolio
    .map((client) => ({
      id: client.id,
      fullName: client.fullName,
      type: client.type,
      status: client.status,
      activePolicies: client.policies.length,
      totalPremium: client.policies.reduce(
        (sum, policy) => sum + toNumber(policy.premiumAmount),
        0
      ),
    }))
    .sort((a, b) => b.totalPremium - a.totalPremium)
    .slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="CRM"
          title="Clientes"
          description="Mapa de clientes, exposición de cartera y actividad operativa asociada."
          actions={
            <>
              <Button asChild variant="outline" className="bg-card/70">
                <Link href="/clients/new">Nuevo cliente</Link>
              </Button>
              <Button asChild variant="outline" className="bg-card/70">
                <a href="/api/exports/clients">Exportar Excel</a>
              </Button>
              <Button asChild>
                <Link href="/policies">
                  Ver pólizas
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            </>
          }
        />

        <LocalNavigation
          label="Tipos de cliente"
          items={[
            { label: "Todos", href: "/clients", excludeQueryKeys: ["type"] },
            { label: "Personas", href: "/clients?type=PERSON" },
            { label: "Empresas", href: "/clients?type=COMPANY" },
          ]}
        />

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <MetricCard
            title="Clientes activos"
            value={activeCount}
            description="Base vigente con seguimiento operativo."
            icon={Users2}
            tone="blue"
          />
          <MetricCard
            title="Empresas"
            value={companiesCount}
            description="Cuentas corporativas en la base."
            icon={Building2}
            tone="emerald"
          />
          <MetricCard
            title="Sin pólizas"
            value={noPolicyCount}
            description="Clientes que aún no tienen cartera activa."
            icon={FileText}
            tone="amber"
          />
          <MetricCard
            title="Total de clientes"
            value={totalCount}
            description="Incluye activos, inactivos y archivados."
            icon={UserRound}
            tone="rose"
          />
        </section>

        <SectionCard
          title="Directorio"
          description="Listado completo con búsqueda y paginación."
          action={
            <TableToolbar
              searchPlaceholder="Buscar por nombre, email, teléfono o RFC..."
              resultCount={filteredCount}
              totalCount={totalCount}
              resultNoun={["cliente", "clientes"]}
              exportDataset="clients"
              filters={[
                {
                  key: "type",
                  label: "Tipo",
                  options: [
                    { value: "PERSON", label: "Persona" },
                    { value: "COMPANY", label: "Empresa" },
                  ],
                },
                {
                  key: "status",
                  label: "Estado",
                  options: entityStatusOptions,
                },
              ]}
            />
          }
        >
          {filteredCount === 0 ? (
            <TableEmptyState
              icon={Users2}
              isFiltered={isFiltered}
              clearHref={clearFiltersHref}
              noun="clientes"
              query={query}
              emptyTitle="Aún no hay clientes"
              emptyDescription="Crea tu primer cliente para empezar a operar la cartera."
              emptyAction={{ label: "Nuevo cliente", href: "/clients/new" }}
            />
          ) : pagedClients.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={Users2}
                title="Página fuera de rango"
                description="No hay clientes en esta página. Vuelve al inicio del listado."
                action={{ label: "Volver al inicio", href: buildTableHref("/clients", params, { q: query || null, status: statusFilter || null, type: typeFilter || null, }) }}
              />
            </div>
          ) : (
            <ClientsListTable
              clients={pagedClients.map((client) => ({
                id: client.id,
                fullName: client.fullName,
                email: client.email,
                phone: client.phone,
                type: client.type,
                status: client.status,
                createdAt: client.createdAt.toISOString(),
                _count: client._count,
              }))}
              page={page}
              pageSize={PAGE_SIZE}
              total={filteredCount}
              query={query}
              canBulkEdit={scope.role === "ADMIN"}
              searchParams={{
                status: statusFilter ?? undefined,
                type: typeFilter ?? undefined,
                sort: sortKey ?? undefined,
                dir: direction ?? undefined,
              }}
            />
          )}
        </SectionCard>

        <SectionCard
          title="Top por cartera"
          description="Clientes ordenados por valor de prima activa."
        >
          {topByPortfolio.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={FileText}
                title="Sin pólizas activas"
                description="Cuando registres pólizas activas, este ranking se llenará automáticamente."
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Cliente</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Pólizas activas</TableHead>
                  <TableHead className="text-right">Prima activa</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topByPortfolio.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell>
                      <Link
                        href={`/clients/${client.id}`}
                        className="font-medium text-foreground hover:text-primary"
                      >
                        {client.fullName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="rounded-full">
                        {client.type === "COMPANY" ? "Empresa" : "Persona"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{client.activePolicies}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(client.totalPremium)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={client.status} entity="client" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
