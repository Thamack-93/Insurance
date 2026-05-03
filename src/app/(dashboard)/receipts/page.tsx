import Link from "next/link";
import { startOfMonth } from "date-fns";
import { ArrowRight, BadgeCheck, CircleDollarSign, Plus, ReceiptText, ShieldAlert } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { Button } from "@/components/ui/button";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UrlTabs } from "@/components/ui/url-tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-states/empty-state";
import { ListSearch } from "@/components/lists/list-search";
import { Pagination } from "@/components/lists/pagination";
import { CollectableReceipts, type CollectableReceipt } from "@/components/receipts/collectable-receipts";
import { getDb } from "@/lib/db";
import { formatDate, today } from "@/lib/dates";
import { formatCurrency, toNumber } from "@/lib/money";

const PAGE_SIZE = 25;

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string; q?: string; page?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const initialTab = params.tab === "historico" ? "historico" : "cobrar";
  const query = (params.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number(params.page) || 1);

  const db = getDb();
  const now = today();
  const monthStart = startOfMonth(now);

  const baseWhere: Prisma.ReceiptWhereInput = {
    status: { notIn: ["PAID", "CANCELLED"] },
  };
  const where: Prisma.ReceiptWhereInput = query
    ? {
        AND: [
          baseWhere,
          {
            OR: [
              { receiptNumber: { contains: query } },
              { client: { fullName: { contains: query } } },
              { policy: { policyNumber: { contains: query } } },
              { insurer: { name: { contains: query } } },
            ],
          },
        ],
      }
    : baseWhere;

  const [
    openCount,
    overdueCount,
    paidThisMonth,
    outstandingAgg,
    overdueAgg,
    filteredCount,
    pagedReceipts,
    paymentHistory,
  ] = await Promise.all([
    db.receipt.count({ where: baseWhere }),
    db.receipt.count({ where: { ...baseWhere, dueDate: { lt: now } } }),
    db.receipt.findMany({
      where: { status: "PAID", paidDate: { gte: monthStart } },
      include: { client: true, policy: true, insurer: true },
      orderBy: { paidDate: "desc" },
    }),
    db.receipt.aggregate({ _sum: { amount: true }, where: baseWhere }),
    db.receipt.aggregate({
      _sum: { amount: true },
      where: { ...baseWhere, dueDate: { lt: now } },
    }),
    db.receipt.count({ where }),
    db.receipt.findMany({
      where,
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.payment.findMany({
      include: {
        receipt: { select: { id: true, receiptNumber: true, dueDate: true } },
        client: { select: { id: true, fullName: true } },
        policy: { select: { id: true, policyNumber: true } },
      },
      orderBy: { paidDate: "desc" },
      take: 50,
    }),
  ]);

  const outstandingAmount = toNumber(outstandingAgg._sum.amount);
  const overdueAmount = toNumber(overdueAgg._sum.amount);
  const paidAmountMonth = paidThisMonth.reduce((sum, receipt) => sum + toNumber(receipt.amount), 0);
  const collectionRate =
    openCount + paidThisMonth.length > 0
      ? Math.round((paidThisMonth.length / (openCount + paidThisMonth.length)) * 100)
      : 100;

  const collectableRows: CollectableReceipt[] = pagedReceipts.map((receipt) => ({
    id: receipt.id,
    receiptNumber: receipt.receiptNumber,
    dueDate: receipt.dueDate.toISOString().split("T")[0],
    amount: toNumber(receipt.amount),
    currency: receipt.currency,
    status: receipt.status,
    client: { fullName: receipt.client.fullName },
    policy: { policyNumber: receipt.policy.policyNumber },
    insurer: { name: receipt.insurer.name },
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finanzas"
        title="Recibos y pagos"
        description="Una sola vista para cobrar lo abierto y auditar lo cobrado."
        actions={
          <>
            <Button asChild variant="outline" className="rounded-full bg-card/70">
              <Link href="/receipts/new">
                <Plus className="mr-2 size-4" />
                Nuevo recibo
              </Link>
            </Button>
            <Button asChild className="rounded-full">
              <Link href="/due-payments">
                Cobranza
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </>
        }
      />

      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricCard
          title="Saldo pendiente"
          value={formatCurrency(outstandingAmount)}
          description="Suma de recibos abiertos."
          icon={CircleDollarSign}
          tone="emerald"
        />
        <MetricCard
          title="Vencidos"
          value={overdueCount}
          description={formatCurrency(overdueAmount)}
          icon={ShieldAlert}
          tone="rose"
        />
        <MetricCard
          title="Pagado este mes"
          value={paidThisMonth.length}
          description={formatCurrency(paidAmountMonth)}
          icon={BadgeCheck}
          tone="blue"
        />
        <MetricCard
          title="Tasa de cobro"
          value={`${collectionRate}%`}
          description="Pagados vs. abiertos del mes."
          icon={ReceiptText}
          tone="amber"
        />
      </section>

      <UrlTabs defaultValue={initialTab}>
        <TabsList className="rounded-full bg-card/70 p-1">
          <TabsTrigger value="cobrar" className="rounded-full px-4">
            Cobrar
          </TabsTrigger>
          <TabsTrigger value="historico" className="rounded-full px-4">
            Histórico
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cobrar" className="space-y-4">
          <SectionCard
            title="Por cobrar"
            description="Búsqueda y paginación sobre todos los recibos abiertos."
            action={<ListSearch placeholder="Buscar por número, cliente, póliza o aseguradora..." />}
          >
            {filteredCount === 0 ? (
              query ? (
                <div className="p-4">
                  <EmptyState
                    icon={ReceiptText}
                    title="Sin resultados"
                    description={`No encontramos recibos que coincidan con "${query}".`}
                  />
                </div>
              ) : (
                <div className="p-4">
                  <EmptyState
                    icon={BadgeCheck}
                    title="¡Cartera al día!"
                    description="No hay recibos abiertos por cobrar."
                    action="Nuevo recibo"
                    actionHref="/receipts/new"
                  />
                </div>
              )
            ) : pagedReceipts.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={ReceiptText}
                  title="Página fuera de rango"
                  description="No hay recibos en esta página. Vuelve al inicio del listado."
                  action="Volver al inicio"
                  actionHref={query ? `/receipts?tab=cobrar&q=${encodeURIComponent(query)}` : "/receipts?tab=cobrar"}
                />
              </div>
            ) : (
              <div className="space-y-3 px-4 py-4">
                <CollectableReceipts receipts={collectableRows} />
                <Pagination
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={filteredCount}
                  basePath="/receipts"
                  searchParams={{ tab: "cobrar", q: query }}
                />
              </div>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="historico" className="space-y-6">
          <SectionCard
            title="Pagos registrados"
            description="Últimos 50 pagos conciliados con su recibo origen."
          >
            {paymentHistory.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={ReceiptText}
                  title="Aún no hay pagos registrados"
                  description="Cuando registres un pago, aparecerá en este historial."
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Recibo</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Póliza</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paymentHistory.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell className="font-medium">
                        <Link href={`/receipts/${payment.receipt.id}`} className="hover:text-primary">
                          {payment.receipt.receiptNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{payment.client.fullName}</TableCell>
                      <TableCell>
                        <Link href={`/policies/${payment.policy.id}`} className="hover:text-primary">
                          {payment.policy.policyNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{formatDate(payment.paidDate)}</TableCell>
                      <TableCell>{payment.paymentMethod ?? "Sin método"}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(payment.amount, payment.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>

          <SectionCard
            title="Recibos cobrados este mes"
            description="Confirmaciones registradas en el período actual."
          >
            {paidThisMonth.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={BadgeCheck}
                  title="Aún no se han cobrado recibos este mes"
                  description="Cuando confirmes un pago, aparecerá aquí."
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Recibo</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Pago</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paidThisMonth.slice(0, 30).map((receipt) => (
                    <TableRow key={receipt.id}>
                      <TableCell className="font-medium">
                        <Link href={`/receipts/${receipt.id}`} className="hover:text-primary">
                          {receipt.receiptNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{receipt.client.fullName}</TableCell>
                      <TableCell>{receipt.paidDate ? formatDate(receipt.paidDate) : "—"}</TableCell>
                      <TableCell>{receipt.paymentMethod ?? "Sin método"}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(receipt.amount, receipt.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </TabsContent>
      </UrlTabs>
    </div>
  );
}
