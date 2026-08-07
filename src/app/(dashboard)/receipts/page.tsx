import Link from "next/link";
import { ArrowRight, BadgeCheck, CircleDollarSign, Plus, ReceiptText, ShieldAlert } from "@/components/icons";
import type { Prisma } from "@/generated/prisma/client";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { Button } from "@/components/ui/button";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UrlTabs } from "@/components/ui/url-tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-states/empty-state";
import { Pagination } from "@/components/lists/pagination";
import { RecordCards } from "@/components/tables/record-cards";
import { TableEmptyState } from "@/components/tables/table-empty-state";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { CollectableReceipts, type CollectableReceipt } from "@/components/receipts/collectable-receipts";
import { DeletePaymentButton } from "@/components/payments/delete-payment-button";
import { getDb } from "@/lib/db";
import { formatDate, today } from "@/lib/dates";
import { businessStartOfMonth } from "@/lib/business-dates";
import { formatCurrency, toNumber } from "@/lib/money";
import { getReceiptOriginLabel } from "@/lib/receipt-context";
import {
  paymentOperationalWhere,
  receiptOperationalWhere,
  receiptPortfolioWhere,
  requirePortfolioReadScope,
} from "@/lib/portfolio-access";
import { buildTableHref } from "@/lib/table-query";
import {
  buildOpenReceiptBaseWhere,
  buildReceiptListOrderBy,
  buildReceiptListWhere,
  readReceiptListFilters,
} from "@/lib/list-filters";

const PAGE_SIZE = 25;

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string; q?: string; page?: string; sort?: string; dir?: string; status?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const initialTab = params.tab === "historico" || params.tab === "revision" ? params.tab : "cobrar";
  const filters = readReceiptListFilters(params);
  const { query, page, sortKey, direction } = filters;
  const statusFilter = filters.status;
  const isFiltered = Boolean(query || statusFilter);

  const db = getDb();
  const scope = await requirePortfolioReadScope();
  const now = today();
  const monthStart = businessStartOfMonth(now);
  const clearFiltersHref = buildTableHref("/receipts", params, {
    q: null,
    status: null,
    page: null,
    tab: "cobrar",
  });

  const baseWhere = buildOpenReceiptBaseWhere(scope.portfolioOwnerId);
  const scopedReceiptWhere = receiptOperationalWhere(scope.portfolioOwnerId);
  const scopedPaymentWhere = paymentOperationalWhere(scope.portfolioOwnerId);
  const scopedReceiptIssueWhere: Prisma.ReceiptReconciliationIssueWhereInput = scope.portfolioOwnerId
    ? { receipt: receiptPortfolioWhere(scope.portfolioOwnerId) }
    : {};
  const where = buildReceiptListWhere(filters, scope.portfolioOwnerId);

  const orderBy = buildReceiptListOrderBy(filters);

  const [
    openCount,
    overdueCount,
    paidThisMonth,
    outstandingAgg,
    overdueAgg,
    totalOpenCount,
    filteredCount,
    pagedReceipts,
    paymentHistory,
    reviewIssues,
  ] = await Promise.all([
    db.receipt.count({ where: baseWhere }),
    db.receipt.count({ where: { ...baseWhere, dueDate: { lt: now } } }),
    db.receipt.findMany({
      where: { ...scopedReceiptWhere, status: "PAID", paidDate: { gte: monthStart } },
      include: { client: true, policy: true, insurer: true, endorsement: true },
      orderBy: { paidDate: "desc" },
    }),
    db.receipt.aggregate({ _sum: { amount: true }, where: baseWhere }),
    db.receipt.aggregate({
      _sum: { amount: true },
      where: { ...baseWhere, dueDate: { lt: now } },
    }),
    db.receipt.count({ where: baseWhere }),
    db.receipt.count({ where }),
    db.receipt.findMany({
      where,
      include: {
        client: true,
        policy: true,
        insurer: true,
        endorsement: true,
        _count: { select: { payments: { where: { status: "POSTED" } } } },
      },
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.payment.findMany({
      where: { ...scopedPaymentWhere, status: "POSTED" },
      include: {
        receipt: { select: { id: true, receiptNumber: true, dueDate: true, endorsement: { select: { id: true, endorsementNumber: true } } } },
        client: { select: { id: true, fullName: true } },
        policy: { select: { id: true, policyNumber: true } },
      },
      orderBy: { paidDate: "desc" },
      take: 50,
    }),
    db.receiptReconciliationIssue.findMany({
      where: {
        ...scopedReceiptIssueWhere,
        status: "OPEN",
      },
      include: {
        receipt: { include: { payments: { where: { status: "POSTED" } }, client: true } },
        policy: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const outstandingAmount = toNumber(outstandingAgg._sum.amount);
  const overdueAmount = toNumber(overdueAgg._sum.amount);
  const paidAmountMonth = paidThisMonth.reduce((sum, receipt) => sum + toNumber(receipt.amount), 0);
  const collectionRate =
    openCount + paidThisMonth.length > 0
      ? Math.round((paidThisMonth.length / (openCount + paidThisMonth.length)) * 100)
      : 100;

  const collectableRows: CollectableReceipt[] = pagedReceipts
    .filter((receipt) => receipt.client && receipt.policy && receipt.insurer)
    .map((receipt) => ({
      id: receipt.id,
      receiptNumber: receipt.receiptNumber,
      dueDate: formatDate(receipt.dueDate, "yyyy-MM-dd"),
      amount: toNumber(receipt.amount),
      currency: receipt.currency,
      status: receipt.status,
      client: { fullName: receipt.client.fullName },
      policy: { policyNumber: receipt.policy.policyNumber, status: receipt.policy.status },
      insurer: { name: receipt.insurer.name },
      endorsement: receipt.endorsement
        ? { endorsementNumber: receipt.endorsement.endorsementNumber, reference: receipt.endorsement.reference }
        : undefined,
      originLabel: getReceiptOriginLabel(receipt),
      paymentCount: receipt._count.payments,
    }));

  const safePaymentHistory = paymentHistory.filter((payment) => payment.receipt && payment.client && payment.policy);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finanzas"
        title="Recibos y pagos"
        description="Una sola vista para cobrar lo abierto y auditar lo cobrado."
        actions={
          <>
            <Button asChild variant="outline" className="bg-card/70">
              <Link href="/receipts/new">
                <Plus className="mr-2 size-4" />
                Nuevo recibo
              </Link>
            </Button>
            <Button asChild>
              <Link href="/payments/new">
                Registrar pago
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
        <TabsList className="rounded-md bg-muted p-1">
          <TabsTrigger value="cobrar" className="rounded-md px-4">
            Por cobrar
          </TabsTrigger>
          <TabsTrigger value="historico" className="rounded-md px-4">
            Pagos
          </TabsTrigger>
          {scope.role === "ADMIN" ? (
            <TabsTrigger value="revision" className="rounded-md px-4">
              Revisión
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="cobrar" className="space-y-4">
          <SectionCard
            title="Por cobrar"
            description="Búsqueda y paginación sobre todos los recibos abiertos."
            action={(
              <TableToolbar
                searchPlaceholder="Buscar por número, cliente, póliza, monto o vencimiento..."
                resultCount={filteredCount}
                totalCount={totalOpenCount}
                resultNoun={["recibo", "recibos"]}
                exportDataset="receipts"
                filters={[{
                  key: "status",
                  label: "Vencimiento",
                  options: [
                    { label: "Vencidos", value: "overdue" },
                    { label: "Vencen hoy", value: "today" },
                    { label: "Próximos 7 días", value: "upcoming" },
                  ],
                }]}
                tableControls={false}
              />
            )}
          >
            {filteredCount === 0 ? (
              <TableEmptyState
                icon={isFiltered ? ReceiptText : BadgeCheck}
                isFiltered={isFiltered}
                clearHref={clearFiltersHref}
                noun="recibos abiertos"
                query={query}
                emptyTitle="¡Cartera al día!"
                emptyDescription="No hay recibos abiertos por cobrar."
                emptyAction={{ label: "Nuevo recibo", href: "/receipts/new" }}
              />
            ) : pagedReceipts.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={ReceiptText}
                  title="Página fuera de rango"
                  description="No hay recibos en esta página. Vuelve al inicio del listado."
                  action={{ label: "Volver al inicio", href: buildTableHref("/receipts", params, { tab: "cobrar", q: query || null, sort: sortKey ?? null, dir: direction ?? null, }) }}
                />
              </div>
            ) : (
              <div className="px-3 py-3">
                <CollectableReceipts receipts={collectableRows} />
                <Pagination
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={filteredCount}
                  basePath="/receipts"
                  searchParams={{ tab: "cobrar", q: query, status: statusFilter, sort: sortKey ?? undefined, dir: direction ?? undefined }}
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
              <>
              <RecordCards
                label="Pagos registrados"
                items={safePaymentHistory.map((payment) => ({
                  id: payment.id,
                  title: payment.receipt.receiptNumber,
                  href: `/receipts/${payment.receipt.id}`,
                  subtitle: payment.client.fullName,
                  fields: [
                    { label: "Póliza", value: payment.policy.policyNumber },
                    { label: "Origen", value: getReceiptOriginLabel(payment.receipt) },
                    { label: "Fecha", value: formatDate(payment.paidDate) },
                    { label: "Método", value: payment.paymentMethod ?? "Sin método" },
                    {
                      label: "Monto",
                      value: formatCurrency(payment.amount, payment.currency),
                      emphasis: true,
                    },
                  ],
                  actions: (
                    <DeletePaymentButton
                      id={payment.id}
                      receiptId={payment.receipt.id}
                      receiptNumber={payment.receipt.receiptNumber}
                      paidDate={payment.paidDate}
                      amount={Number(payment.amount)}
                      currency={payment.currency}
                      paymentMethod={payment.paymentMethod}
                      triggerLabel="Eliminar"
                      triggerClassName="h-7 bg-card/70 px-2.5 text-xs text-destructive hover:text-destructive"
                    />
                  ),
                }))}
              />
              <Table className="hidden md:table">
              <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Recibo</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Póliza</TableHead>
                    <TableHead>Origen</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Método</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {safePaymentHistory.map((payment) => (
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
                        <p className="text-xs text-muted-foreground">{getReceiptOriginLabel(payment.receipt)}</p>
                      </TableCell>
                      <TableCell>
                        {payment.receipt.endorsement ? (
                          <Link
                            href={`/policies/${payment.policy.id}/endorsements/${payment.receipt.endorsement.id}/edit`}
                            className="hover:text-primary"
                          >
                            Endoso {payment.receipt.endorsement.endorsementNumber}
                          </Link>
                        ) : (
                          "Póliza base"
                        )}
                      </TableCell>
                      <TableCell>{formatDate(payment.paidDate)}</TableCell>
                      <TableCell>{payment.paymentMethod ?? "Sin método"}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(payment.amount, payment.currency)}
                      </TableCell>
                      <TableCell className="text-right">
                        <DeletePaymentButton
                          id={payment.id}
                          receiptId={payment.receipt.id}
                          receiptNumber={payment.receipt.receiptNumber}
                          paidDate={payment.paidDate}
                          amount={Number(payment.amount)}
                          currency={payment.currency}
                          paymentMethod={payment.paymentMethod}
                          triggerLabel="Eliminar"
                          triggerClassName="h-7 bg-card/70 px-2.5 text-xs text-destructive hover:text-destructive"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </>
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
              <>
              <RecordCards
                label="Recibos cobrados este mes"
                items={paidThisMonth.slice(0, 30).map((receipt) => ({
                  id: receipt.id,
                  title: receipt.receiptNumber,
                  href: `/receipts/${receipt.id}`,
                  subtitle: receipt.client?.fullName ?? "Cliente eliminado",
                  fields: [
                    {
                      label: "Origen",
                      value: receipt.endorsement
                        ? `Endoso ${receipt.endorsement.endorsementNumber}`
                        : "Póliza base",
                    },
                    { label: "Pago", value: receipt.paidDate ? formatDate(receipt.paidDate) : "—" },
                    { label: "Método", value: receipt.paymentMethod ?? "Sin método" },
                    {
                      label: "Monto",
                      value: formatCurrency(receipt.amount, receipt.currency),
                      emphasis: true,
                    },
                  ],
                }))}
              />
              <Table className="hidden md:table">
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Recibo</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Origen</TableHead>
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
                      <TableCell>{receipt.client?.fullName ?? "Cliente eliminado"}</TableCell>
                      <TableCell>
                        {receipt.endorsement ? (
                          <Link
                            href={`/policies/${receipt.policyId}/endorsements/${receipt.endorsement.id}/edit`}
                            className="hover:text-primary"
                          >
                            Endoso {receipt.endorsement.endorsementNumber}
                          </Link>
                        ) : (
                          "Póliza base"
                        )}
                      </TableCell>
                      <TableCell>{receipt.paidDate ? formatDate(receipt.paidDate) : "—"}</TableCell>
                      <TableCell>{receipt.paymentMethod ?? "Sin método"}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(receipt.amount, receipt.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="revision" className="space-y-6">
          <SectionCard
            title="Inconsistencias por revisar"
            description="Recibos con pagos parciales, diferencias o evidencia que requiere validación humana."
          >
            {reviewIssues.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={BadgeCheck}
                  title="Sin incidencias abiertas"
                  description="La conciliación no dejó recibos pendientes de revisión."
                />
              </div>
            ) : (
              <>
              <RecordCards
                label="Inconsistencias por revisar"
                items={reviewIssues
                  .filter((issue) => issue.receipt && issue.policy)
                  .map((issue) => {
                    const receipt = issue.receipt!;
                    const policy = issue.policy!;
                    const paidAmount = receipt.payments.reduce(
                      (sum, payment) => sum + toNumber(payment.amount),
                      0,
                    );
                    return {
                      id: issue.id,
                      title: receipt.receiptNumber,
                      href: `/receipts/${receipt.id}`,
                      subtitle: receipt.client.fullName,
                      fields: [
                        { label: "Póliza", value: policy.policyNumber },
                        { label: "Motivo", value: issue.reason },
                        {
                          label: "Recibo",
                          value: formatCurrency(receipt.amount, receipt.currency),
                          emphasis: true,
                        },
                        {
                          label: "Pagos reales",
                          value: formatCurrency(paidAmount, receipt.currency),
                          emphasis: true,
                        },
                      ],
                    };
                  })}
              />
              <Table className="hidden md:table">
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Recibo</TableHead>
                    <TableHead>Póliza</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead className="text-right">Recibo</TableHead>
                    <TableHead className="text-right">Pagos reales</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reviewIssues.filter((issue) => issue.receipt && issue.policy).map((issue) => {
                    const receipt = issue.receipt!;
                    const policy = issue.policy!;
                    const paidAmount = receipt.payments.reduce(
                      (sum, payment) => sum + toNumber(payment.amount),
                      0,
                    );
                    return (
                      <TableRow key={issue.id}>
                        <TableCell>
                          <Link href={`/receipts/${receipt.id}`} className="font-medium hover:text-primary">
                            {receipt.receiptNumber}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Link href={`/policies/${policy.id}`} className="hover:text-primary">
                            {policy.policyNumber}
                          </Link>
                        </TableCell>
                        <TableCell>{receipt.client.fullName}</TableCell>
                        <TableCell className="max-w-xs text-xs text-muted-foreground">
                          {issue.reason}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(receipt.amount, receipt.currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(paidAmount, receipt.currency)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </>
            )}
          </SectionCard>
        </TabsContent>
      </UrlTabs>
    </div>
  );
}
