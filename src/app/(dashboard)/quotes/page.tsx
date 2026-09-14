import Link from "next/link";
import { ArrowRight, Calculator, Clock, Plus, TrendingUp, CheckCircle } from "@/components/icons";
import { PageHeader } from "@/components/layout/page-header";
import { LocalNavigation } from "@/components/layout/local-navigation";
import { policyNavigation } from "@/lib/navigation";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-states/empty-state";
import { QuotesListTable } from "@/components/quotes/quotes-list-table";
import { TableEmptyState } from "@/components/tables/table-empty-state";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { daysSince, formatDate } from "@/lib/dates";
import { formatCurrency, toNumber } from "@/lib/money";
import { policyTypeLabel } from "@/lib/status";
import { quoteStatusOptions } from "@/lib/domain-options";
import { quoteOperationalWhere, requireOrganizationPortfolioReadScope } from "@/lib/portfolio-access";
import { buildTableHref } from "@/lib/table-query";
import {
  buildQuoteListOrderBy,
  buildQuoteListWhere,
  readQuoteListFilters,
} from "@/lib/list-filters";
import { withTenantOrganization } from "@/lib/tenant-dal";

const PAGE_SIZE = 25;

export default async function QuotesPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string; sort?: string; dir?: string; status?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const filters = readQuoteListFilters(params);
  const { query, page, sortKey, direction } = filters;
  const statusFilter = filters.status;
  const isFiltered = Boolean(query || statusFilter || filters.allStatuses);
  const scope = await requireOrganizationPortfolioReadScope();
  const quoteScope = quoteOperationalWhere(scope.portfolioOwnerId, scope.organizationId);
  const clearFiltersHref = buildTableHref("/quotes", params, {
    q: null,
    status: null,
    page: null,
  });

  return withTenantOrganization(scope.organizationId, async (db) => {
  const where = buildQuoteListWhere(filters, scope.portfolioOwnerId, scope.organizationId);
  const orderBy = buildQuoteListOrderBy(filters);

  const [
    activeCount,
    pendingCount,
    sentCount,
    acceptedCount,
    expiredCount,
    valueAgg,
    totalCount,
    filteredCount,
    pagedQuotes,
    pendingQuotes,
    sentQuotes,
  ] = await Promise.all([
    db.quote.count({
      where: { ...quoteScope, status: { notIn: ["EXPIRED", "CANCELLED", "REJECTED"] } },
    }),
    db.quote.count({ where: { ...quoteScope, status: { in: ["REQUESTED", "IN_PROGRESS"] } } }),
    db.quote.count({ where: { ...quoteScope, status: "SENT" } }),
    db.quote.count({ where: { ...quoteScope, status: "ACCEPTED" } }),
    db.quote.count({ where: { ...quoteScope, status: "EXPIRED" } }),
    db.quote.aggregate({ where: quoteScope, _sum: { quotedAmount: true } }),
    db.quote.count({ where: quoteScope }),
    db.quote.count({ where }),
    db.quote.findMany({
      where,
      include: { client: true, insurer: true },
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.quote.findMany({
      where: { ...quoteScope, status: { in: ["REQUESTED", "IN_PROGRESS"] } },
      include: { client: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    db.quote.findMany({
      where: { ...quoteScope, status: "SENT" },
      include: { client: true },
      orderBy: { sentDate: "desc" },
      take: 5,
    }),
  ]);

  const totalValue = Number(valueAgg._sum.quotedAmount ?? 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Comercial"
          title="Cotizaciones"
          description="Seguimiento de propuestas, cotizaciones activas y tasas de conversión."
          actions={
            <>
              <Button asChild variant="outline">
                <Link href="/quotes/new">
                  <Plus className="mr-2 size-4" />
                  Nueva cotización
                </Link>
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

        <LocalNavigation items={policyNavigation} label="Vistas de pólizas" />

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <MetricCard
            title="Activas"
            value={activeCount}
            description={`${pendingCount} pendientes · ${sentCount} enviadas`}
            icon={Calculator}
            tone="blue"
          />
          <MetricCard
            title="Aceptadas"
            value={acceptedCount}
            description="Convertidas a póliza."
            icon={CheckCircle}
            tone="emerald"
          />
          <MetricCard
            title="Valor total"
            value={formatCurrency(totalValue)}
            description="Suma de primas cotizadas."
            icon={TrendingUp}
            tone="amber"
          />
          <MetricCard
            title="Expiradas"
            value={expiredCount}
            description="Fuera de vigencia."
            icon={Clock}
            tone="rose"
          />
        </section>

        <SectionCard
          title="Cotizaciones"
          description="Por defecto muestra cotizaciones operativas; usa Estado > Todas para consultar el historial completo."
        >
          <div className="border-b border-border/70 px-4 py-3">
            <TableToolbar
              searchPlaceholder="Buscar por cliente, tipo, aseguradora, prima o fecha..."
              resultCount={filteredCount}
              totalCount={totalCount}
              resultNoun={["cotización", "cotizaciones"]}
              exportDataset="quotes"
              filters={[
                {
                  key: "status",
                  label: "Estado",
                  placeholder: "Operativas",
                  options: [{ value: "ALL", label: "Todas" }, ...quoteStatusOptions],
                },
              ]}
            />
          </div>
          {filteredCount === 0 ? (
            <TableEmptyState
              icon={Calculator}
              isFiltered={isFiltered}
              clearHref={clearFiltersHref}
              noun="cotizaciones"
              query={query}
              emptyTitle="Aún no hay cotizaciones"
              emptyDescription="Captura tu primera propuesta para arrancar el embudo comercial."
              emptyAction={{ label: "Nueva cotización", href: "/quotes/new" }}
            />
          ) : pagedQuotes.length === 0 ? (
            <div className="p-4">
                <EmptyState
                  icon={Calculator}
                  title="Página fuera de rango"
                  description="No hay cotizaciones en esta página. Vuelve al inicio del listado."
                  action={{ label: "Volver al inicio", href: buildTableHref("/quotes", params, { q: query || null, sort: sortKey ?? null, dir: direction ?? null, }) }}
                />
              </div>
            ) : (
              <QuotesListTable
                quotes={pagedQuotes.map((quote) => ({
                  id: quote.id,
                  folio: quote.id.slice(0, 8),
                  clientName: quote.client.fullName,
                  policyType: quote.policyType,
                  insurerName: quote.insurer?.name ?? "",
                  status: quote.status,
                  createdAtLabel: formatDate(quote.createdAt),
                  daysSinceCreated: daysSince(quote.createdAt),
                  quotedAmount: quote.quotedAmount === null ? null : toNumber(quote.quotedAmount),
                }))}
                page={page}
                pageSize={PAGE_SIZE}
                total={filteredCount}
                searchParams={{
                  q: query,
                  status: filters.allStatuses ? "ALL" : statusFilter ?? undefined,
                  sort: sortKey ?? undefined,
                  dir: direction ?? undefined,
                }}
              />
            )}
        </SectionCard>

        <section className="grid gap-6 xl:grid-cols-2">
          <SectionCard title="Pendientes de envío" description="Cotizaciones en preparación.">
            {pendingQuotes.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={Calculator}
                  title="Sin pendientes"
                  description="No hay cotizaciones esperando ser enviadas."
                />
              </div>
            ) : (
              <div className="divide-y divide-stone-200/80">
                {pendingQuotes.map((quote) => (
                  <div key={quote.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <Link href={`/quotes/${quote.id}`} className="font-medium text-foreground hover:text-primary">
                        {quote.id.slice(0, 8)}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {quote.client.fullName} · {policyTypeLabel(quote.policyType)}
                      </p>
                    </div>
                    <StatusBadge status={quote.status} entity="quote" />
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Enviadas recientemente" description="Esperando respuesta del cliente.">
            {sentQuotes.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={Calculator}
                  title="Aún sin envíos"
                  description="Cuando envíes tu primera propuesta aparecerá aquí."
                />
              </div>
            ) : (
              <div className="divide-y divide-stone-200/80">
                {sentQuotes.map((quote) => (
                  <div key={quote.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <Link href={`/quotes/${quote.id}`} className="font-medium text-foreground hover:text-primary">
                        {quote.id.slice(0, 8)}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {quote.client.fullName}
                        {quote.validUntil && ` · Vence: ${formatDate(quote.validUntil)}`}
                      </p>
                    </div>
                    <div className="text-right">
                      {quote.quotedAmount && (
                        <p className="text-sm font-medium">{formatCurrency(quote.quotedAmount)}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </section>
      </div>
    </div>
  );
  });
}
