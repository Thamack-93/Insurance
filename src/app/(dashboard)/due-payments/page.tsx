import Link from "next/link";
import { ArrowRight, CircleDollarSign, Clock3, AlertTriangle, ReceiptText } from "lucide-react";
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
import { daysUntil, formatDate, today } from "@/lib/dates";
import { formatCurrency, toNumber } from "@/lib/money";
import { addDays } from "date-fns";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";

export default async function DuePaymentsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string }>;
}) {
  const db = getDb();
  const now = today();
  const in7 = addDays(now, 7);
  const in30 = addDays(now, 30);
  const in60 = addDays(now, 60);

  const params = (await searchParams) ?? {};
  const query = (params.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number(params.page) || 1);

  const openHorizonWhere: Prisma.ReceiptWhereInput = {
    dueDate: { gte: now, lte: in60 },
    status: { notIn: ["PAID", "CANCELLED"] },
    ...(query
      ? {
          OR: [
            { receiptNumber: { contains: query } },
            { client: { fullName: { contains: query } } },
            { policy: { policyNumber: { contains: query } } },
          ],
        }
      : {}),
  };

  const [
    openCount,
    pagedOpenReceipts,
    overdueAggregates,
    overdueReceipts,
    next7Receipts,
    next30Receipts,
    recentPaidReceipts,
    openHorizonAggregate,
    dueTodayCount,
  ] = await Promise.all([
    db.receipt.count({ where: openHorizonWhere }),
    db.receipt.findMany({
      where: openHorizonWhere,
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
      skip: (page - 1) * DEFAULT_PAGE_SIZE,
      take: DEFAULT_PAGE_SIZE,
    }),
    db.receipt.aggregate({
      where: { dueDate: { lt: now }, status: { notIn: ["PAID", "CANCELLED"] } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.receipt.findMany({
      where: { dueDate: { lt: now }, status: { notIn: ["PAID", "CANCELLED"] } },
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
      take: 10,
    }),
    db.receipt.findMany({
      where: { dueDate: { gte: now, lte: in7 }, status: { notIn: ["PAID", "CANCELLED"] } },
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
      take: 10,
    }),
    db.receipt.findMany({
      where: { dueDate: { gt: in7, lte: in30 }, status: { notIn: ["PAID", "CANCELLED"] } },
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
      take: 10,
    }),
    db.receipt.findMany({
      where: { status: "PAID" },
      include: { client: true, policy: true, insurer: true },
      orderBy: { paidDate: "desc" },
      take: 10,
    }),
    db.receipt.aggregate({
      where: { dueDate: { gte: now, lte: in60 }, status: { notIn: ["PAID", "CANCELLED"] } },
      _sum: { amount: true },
    }),
    db.receipt.count({
      where: { dueDate: { gte: now, lt: addDays(now, 1) }, status: { notIn: ["PAID", "CANCELLED"] } },
    }),
  ]);

  const outstandingAmount = toNumber(openHorizonAggregate._sum.amount);
  const overdueAmount = toNumber(overdueAggregates._sum.amount);

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Cartera"
          title="Cobros pendientes"
          description="Calendario de cobros y vencimientos para concentrar seguimiento comercial y financiero."
          actions={
            <Button asChild className="rounded-full">
              <Link href="/receipts">
                Ver recibos
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Saldo por cobrar"
            value={formatCurrency(outstandingAmount)}
            description="Total abierto dentro del horizonte de 60 días."
            icon={CircleDollarSign}
            tone="emerald"
          />
          <MetricCard
            title="Vencidos"
            value={overdueAggregates._count._all}
            description={formatCurrency(overdueAmount)}
            icon={AlertTriangle}
            tone="rose"
          />
          <MetricCard
            title="Vence hoy"
            value={dueTodayCount}
            description="Recibos que requieren contacto el mismo día."
            icon={Clock3}
            tone="amber"
          />
          <MetricCard
            title="Próximos 7 días"
            value={next7Receipts.length}
            description={`${next30Receipts.length} más entre el día 8 y el 30.`}
            icon={ReceiptText}
            tone="blue"
          />
        </section>

        <SectionCard
          title="Recibos por cobrar (60 días)"
          description="Listado paginado con búsqueda por recibo, cliente o póliza."
          action={<ListSearch placeholder="Buscar por recibo, cliente o póliza..." />}
        >
          {openCount === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={ReceiptText}
                title={query ? "Sin resultados" : "Sin recibos próximos"}
                description={
                  query
                    ? `No encontramos recibos que coincidan con "${query}".`
                    : "No hay recibos pendientes en los próximos 60 días."
                }
              />
            </div>
          ) : pagedOpenReceipts.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={ReceiptText}
                title="Página fuera de rango"
                description="Vuelve al inicio del listado."
                action="Volver al inicio"
                actionHref={query ? `/due-payments?q=${encodeURIComponent(query)}` : "/due-payments"}
              />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/70">
                    <TableHead>Recibo</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Póliza</TableHead>
                    <TableHead>Vencimiento</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedOpenReceipts.map((receipt) => (
                    <TableRow key={receipt.id}>
                      <TableCell className="font-medium">{receipt.receiptNumber}</TableCell>
                      <TableCell>
                        <Link href={`/clients/${receipt.clientId}`} className="text-foreground hover:text-primary">
                          {receipt.client.fullName}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/policies/${receipt.policyId}`} className="text-foreground hover:text-primary">
                          {receipt.policy.policyNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{formatDate(receipt.dueDate)}</span>
                          <StatusBadge status={receipt.status} className="mt-1 w-fit" />
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(receipt.amount, receipt.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                page={page}
                pageSize={DEFAULT_PAGE_SIZE}
                total={openCount}
                basePath="/due-payments"
                searchParams={{ q: query }}
              />
            </>
          )}
        </SectionCard>

        <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <SectionCard title="Recibos vencidos" description="Máxima prioridad operativa y de cobranza.">
            {overdueReceipts.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={AlertTriangle}
                  title="Sin recibos vencidos"
                  description="Felicidades: la cartera vencida está limpia."
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/70">
                    <TableHead>Recibo</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Vencimiento</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overdueReceipts.map((receipt) => (
                    <TableRow key={receipt.id}>
                      <TableCell className="font-medium">{receipt.receiptNumber}</TableCell>
                      <TableCell>
                        <Link href={`/clients/${receipt.clientId}`} className="text-foreground hover:text-primary">
                          {receipt.client.fullName}
                        </Link>
                      </TableCell>
                      <TableCell>{formatDate(receipt.dueDate)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(receipt.amount, receipt.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>

          <SectionCard title="Pagos recientes" description="Liquidaciones confirmadas para referencia rápida.">
            {recentPaidReceipts.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={CircleDollarSign}
                  title="Sin pagos recientes"
                  description="Cuando marques recibos como pagados, aparecerán aquí."
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/70">
                    <TableHead>Recibo</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Pago</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentPaidReceipts.map((receipt) => (
                    <TableRow key={receipt.id}>
                      <TableCell className="font-medium">{receipt.receiptNumber}</TableCell>
                      <TableCell>{receipt.client.fullName}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{receipt.paidDate ? formatDate(receipt.paidDate) : "Sin fecha"}</span>
                          <StatusBadge status={receipt.status} className="mt-1 w-fit" />
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(receipt.amount, receipt.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </section>
      </div>
    </main>
  );
}
