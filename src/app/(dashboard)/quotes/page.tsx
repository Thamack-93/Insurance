import Link from "next/link";
import { ArrowRight, Calculator, Clock, Plus, TrendingUp, CheckCircle } from "@/components/icons";
import type { Prisma } from "@/generated/prisma/client";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-states/empty-state";
import { Pagination } from "@/components/lists/pagination";
import { SortableTableHead } from "@/components/tables/sortable-table-head";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { getDb } from "@/lib/db";
import { daysSince, formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";
import { quoteOperationalWhere, requirePortfolioReadScope } from "@/lib/portfolio-access";
import { buildTableHref, readTablePage, readTableSort } from "@/lib/table-query";

const PAGE_SIZE = 25;

export default async function QuotesPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string; sort?: string; dir?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const query = (params.q ?? "").trim().slice(0, 100);
  const page = readTablePage(params);
  const { sortKey, direction } = readTableSort(params);
  const scope = await requirePortfolioReadScope();
  const quoteScope = quoteOperationalWhere(scope.portfolioOwnerId);

  const db = getDb();

  const where: Prisma.QuoteWhereInput = {
    ...quoteScope,
    ...(query
      ? {
        OR: [
          { client: { fullName: { contains: query } } },
          { insurer: { name: { contains: query } } },
        ],
      }
      : {}),
  };

  const orderBy =
    sortKey === "folio"
      ? [{ id: direction ?? "asc" }]
      : sortKey === "client"
        ? [{ client: { fullName: direction ?? "asc" } }, { createdAt: "desc" as const }]
        : sortKey === "type"
          ? [{ policyType: direction ?? "asc" }, { createdAt: "desc" as const }]
          : sortKey === "insurer"
            ? [{ insurer: { name: direction ?? "asc" } }, { createdAt: "desc" as const }]
            : sortKey === "status"
              ? [{ status: direction ?? "asc" }, { createdAt: "desc" as const }]
              : sortKey === "createdAt"
                ? [{ createdAt: direction ?? "desc" }]
                : sortKey === "value"
                  ? [{ quotedAmount: direction ?? "desc" }, { createdAt: "desc" as const }]
                  : [{ createdAt: "desc" as const }];

  const [
    activeCount,
    pendingCount,
    sentCount,
    acceptedCount,
    expiredCount,
    valueAgg,
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
          description="Listado completo de propuestas."
          action={<TableToolbar searchPlaceholder="Buscar por cliente, tipo o aseguradora..." />}
        >
          {filteredCount === 0 ? (
            query ? (
              <div className="p-4">
                <EmptyState
                  icon={Calculator}
                  title="Sin resultados"
                  description={`No encontramos cotizaciones que coincidan con "${query}".`}
                />
              </div>
            ) : (
              <div className="p-4">
                <EmptyState
                  icon={Calculator}
                  title="Aún no hay cotizaciones"
                  description="Captura tu primera propuesta para arrancar el embudo comercial."
                  action={{ label: "Nueva cotización", href: "/quotes/new" }}
                />
              </div>
            )
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
              <>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <SortableTableHead sortKey="folio">Folio</SortableTableHead>
                      <SortableTableHead sortKey="client">Cliente</SortableTableHead>
                      <SortableTableHead sortKey="type">Tipo</SortableTableHead>
                      <SortableTableHead sortKey="insurer">Aseguradora</SortableTableHead>
                      <SortableTableHead sortKey="status">Estado</SortableTableHead>
                      <SortableTableHead sortKey="createdAt">Creada</SortableTableHead>
                      <SortableTableHead sortKey="value" className="text-right">
                        Prima
                      </SortableTableHead>
                    </TableRow>
                  </TableHeader>
                <TableBody>
                  {pagedQuotes.map((quote) => (
                    <TableRow key={quote.id}>
                      <TableCell>
                        <Link
                          href={`/quotes/${quote.id}`}
                          className="font-medium text-foreground hover:text-primary"
                        >
                          {quote.id.slice(0, 8)}
                        </Link>
                      </TableCell>
                      <TableCell>{quote.client.fullName}</TableCell>
                      <TableCell>{quote.policyType}</TableCell>
                      <TableCell>{quote.insurer?.name ?? "—"}</TableCell>
                      <TableCell>
                        <StatusBadge status={quote.status} entity="quote" />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Clock className="size-3" />
                          {formatDate(quote.createdAt)}
                          <span className="text-xs">({daysSince(quote.createdAt)} d)</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {quote.quotedAmount ? formatCurrency(quote.quotedAmount) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={filteredCount}
                basePath="/quotes"
                searchParams={{ q: query, sort: sortKey ?? undefined, dir: direction ?? undefined }}
              />
            </>
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
                        {quote.client.fullName} · {quote.policyType}
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
}
