import Link from "next/link";
import { ArrowRight, Calculator, Clock, Plus, TrendingUp, CheckCircle } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-states/empty-state";
import { ListSearch } from "@/components/lists/list-search";
import { Pagination } from "@/components/lists/pagination";
import { getDb } from "@/lib/db";
import { daysSince, formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";

const PAGE_SIZE = 25;

export default async function QuotesPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const query = (params.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number(params.page) || 1);

  const db = getDb();

  const where: Prisma.QuoteWhereInput = query
    ? {
        OR: [
          { client: { fullName: { contains: query } } },
          { insurer: { name: { contains: query } } },
        ],
      }
    : {};

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
      where: { status: { notIn: ["EXPIRED", "CANCELLED", "REJECTED"] } },
    }),
    db.quote.count({ where: { status: { in: ["REQUESTED", "IN_PROGRESS"] } } }),
    db.quote.count({ where: { status: "SENT" } }),
    db.quote.count({ where: { status: "ACCEPTED" } }),
    db.quote.count({ where: { status: "EXPIRED" } }),
    db.quote.aggregate({ _sum: { quotedAmount: true } }),
    db.quote.count({ where }),
    db.quote.findMany({
      where,
      include: { client: true, insurer: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.quote.findMany({
      where: { status: { in: ["REQUESTED", "IN_PROGRESS"] } },
      include: { client: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    db.quote.findMany({
      where: { status: "SENT" },
      include: { client: true },
      orderBy: { sentDate: "desc" },
      take: 5,
    }),
  ]);

  const totalValue = Number(valueAgg._sum.quotedAmount ?? 0);

  return (
    <main className="min-h-screen bg-background px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Comercial"
          title="Cotizaciones"
          description="Seguimiento de propuestas, cotizaciones activas y tasas de conversión."
          actions={
            <>
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/quotes/new">
                  <Plus className="mr-2 size-4" />
                  Nueva cotización
                </Link>
              </Button>
              <Button asChild className="rounded-full">
                <Link href="/policies">
                  Ver pólizas
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            </>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
          action={<ListSearch placeholder="Buscar por cliente, tipo o aseguradora..." />}
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
                  action="Nueva cotización"
                  actionHref="/quotes/new"
                />
              </div>
            )
          ) : pagedQuotes.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={Calculator}
                title="Página fuera de rango"
                description="No hay cotizaciones en esta página. Vuelve al inicio del listado."
                action="Volver al inicio"
                actionHref={query ? `/quotes?q=${encodeURIComponent(query)}` : "/quotes"}
              />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Folio</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Aseguradora</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Creada</TableHead>
                    <TableHead className="text-right">Prima</TableHead>
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
                        <StatusBadge status={quote.status} />
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
                searchParams={{ q: query }}
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
                    <StatusBadge status={quote.status} />
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
    </main>
  );
}
