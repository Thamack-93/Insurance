import Link from "next/link";
import { connection } from "next/server";
import { ArrowRight, BadgeCheck, CircleAlert, HandCoins, TrendingUp } from "@/components/icons";
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
import { getCommissionStats, getOverdueCommissions, autoUpdateCommissionStatuses } from "@/lib/commissions";
import { formatDate } from "@/lib/dates";
import { formatCurrency, toNumber } from "@/lib/money";
import { withTenantTransaction } from "@/lib/organization-context";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";
import { commissionOperationalWhere, requireOrganizationPortfolioReadScope } from "@/lib/portfolio-access";
import { buildTableHref, readTablePage, readTableSort } from "@/lib/table-query";
import { compareCommissionStatusDesc, compareDateAsc } from "@/lib/sorting";

export default async function CommissionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string; sort?: string; dir?: string }>;
}) {
  await connection();
  const scope = await requireOrganizationPortfolioReadScope();
  // Run side-effect first; downstream reads must see the new statuses.
  await autoUpdateCommissionStatuses(scope);

  const params = (await searchParams) ?? {};
  const query = (params.q ?? "").trim().slice(0, 100);
  const page = readTablePage(params);
  const { sortKey, direction } = readTableSort(params);

  const openWhere: Prisma.CommissionWhereInput = {
    ...commissionOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
    status: { notIn: ["PAID", "CANCELLED"] },
    ...(query
      ? {
          OR: [
            { policy: { policyNumber: { contains: query } } },
            { client: { fullName: { contains: query } } },
            { insurer: { name: { contains: query } } },
          ],
        }
      : {}),
  };

  const orderBy =
    sortKey === "policy"
      ? [{ policy: { policyNumber: direction ?? "asc" } }, { expectedDate: "asc" as const }, { id: "asc" as const }]
      : sortKey === "client"
        ? [{ client: { fullName: direction ?? "asc" } }, { expectedDate: "asc" as const }, { id: "asc" as const }]
        : sortKey === "insurer"
          ? [{ insurer: { name: direction ?? "asc" } }, { expectedDate: "asc" as const }, { id: "asc" as const }]
          : sortKey === "expectedDate"
            ? [{ expectedDate: direction ?? "asc" }, { policy: { policyNumber: "asc" as const } }, { id: "asc" as const }]
            : sortKey === "amount"
              ? [{ expectedAmount: direction ?? "desc" }, { expectedDate: "asc" as const }, { id: "asc" as const }]
              : sortKey === "status"
                ? [{ status: direction ?? "asc" }, { expectedDate: "asc" as const }, { id: "asc" as const }]
                : [{ expectedDate: "asc" as const }, { id: "asc" as const }];

  const [stats, overdueCommissions, directCommissionData] = await Promise.all([
    getCommissionStats(undefined, scope),
    getOverdueCommissions(scope),
    withTenantTransaction(scope.context, async (db) => ({
      openCount: await db.commission.count({ where: openWhere }),
      openCommissions: await db.commission.findMany({
        where: openWhere,
        include: { client: true, insurer: true, policy: true, receipt: true },
        orderBy: sortKey ? orderBy : [{ expectedDate: "asc" }, { id: "asc" }],
      }),
      paidCommissions: await db.commission.findMany({
        where: { ...commissionOperationalWhere(scope.portfolioOwnerId, scope.organizationId), status: "PAID" },
        include: { client: true, insurer: true, policy: true, receipt: true },
        orderBy: [{ paidDate: "desc" }, { expectedDate: "desc" }],
        take: 10,
      }),
    })),
  ]);
  const { openCount, openCommissions, paidCommissions } = directCommissionData;

  const orderedOpenCommissions = [...openCommissions].sort((left, right) => (
    compareCommissionStatusDesc(left.status, right.status) ||
    compareDateAsc(left.expectedDate, right.expectedDate) ||
    right.createdAt.getTime() - left.createdAt.getTime() ||
    left.id.localeCompare(right.id)
  ));
  const pagedOpenCommissions = sortKey && sortKey !== "status"
    ? openCommissions.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE)
    : orderedOpenCommissions.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE);

  const ratio = stats.totalExpected ? Math.round((stats.totalActual / stats.totalExpected) * 100) : 0;
  type CommissionRow = (typeof openCommissions)[number];
  type CommissionWithRelations = CommissionRow & {
    policy: NonNullable<CommissionRow["policy"]>;
    client: NonNullable<CommissionRow["client"]>;
    insurer: NonNullable<CommissionRow["insurer"]>;
    receipt: NonNullable<CommissionRow["receipt"]>;
  };
  const hasRelations = (commission: CommissionRow): commission is CommissionWithRelations =>
    Boolean(commission.policy && commission.client && commission.insurer && commission.receipt);
  const safeOpenCommissions = pagedOpenCommissions.filter(hasRelations);
  const safePaidCommissions = paidCommissions.filter(hasRelations);
  const paidCount = stats.statusBreakdown.find(({ status }) => status === "PAID")?.count ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Finanzas"
          title="Comisiones y bonos"
          description="Seguimiento de comisiones esperadas, cobradas y vencidas. Los bonos se incorporarán cuando existan datos reales."
          actions={
            <Button asChild>
              <Link href="/reports">
                Reportes
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          }
        />

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <MetricCard
            title="Esperado"
            value={formatCurrency(stats.totalExpected)}
            description="Suma de comisiones registradas."
            icon={HandCoins}
            tone="emerald"
          />
          <MetricCard
            title="Cobrado"
            value={formatCurrency(stats.totalActual)}
            description={`${ratio}% de conversión sobre lo esperado`}
            icon={TrendingUp}
            tone="blue"
          />
          <MetricCard
            title="Abiertas"
            value={stats.totalCount - paidCount}
            description="Todavía en espera de liquidación."
            icon={BadgeCheck}
            tone="amber"
          />
          <MetricCard
            title="Vencidas"
            value={overdueCommissions.length}
            description="Esperadas en el pasado sin cierre."
            icon={CircleAlert}
            tone="rose"
          />
        </section>

        <SectionCard
          title="Comisiones abiertas"
          description="Listado paginado con búsqueda por póliza, cliente o aseguradora."
          action={<TableToolbar searchPlaceholder="Buscar por póliza, cliente o aseguradora..." />}
        >
          {safeOpenCommissions.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={HandCoins}
                title={query ? "Sin resultados" : "Sin comisiones abiertas"}
                description={
                  query
                    ? `No encontramos comisiones que coincidan con "${query}".`
                    : "Cuando registres pagos asociados a una póliza, las comisiones aparecerán aquí."
                }
              />
            </div>
          ) : safeOpenCommissions.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={HandCoins}
                title="Página fuera de rango"
                description="Vuelve al inicio del listado."
                action={{ label: "Volver al inicio", href: buildTableHref("/commissions", params, { q: query || null, sort: sortKey ?? null, dir: direction ?? null, }) }}
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
                    <SortableTableHead sortKey="expectedDate">Esperada</SortableTableHead>
                    <SortableTableHead sortKey="amount" className="text-right">
                      Monto
                    </SortableTableHead>
                    <SortableTableHead sortKey="status">Estado</SortableTableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {safeOpenCommissions.map((commission) => (
                    <TableRow key={commission.id}>
                      <TableCell>
                        <Link href={`/policies/${commission.policyId}`} className="font-medium text-foreground hover:text-primary">
                          {commission.policy.policyNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{commission.client.fullName}</TableCell>
                      <TableCell>{commission.insurer.name}</TableCell>
                      <TableCell>{formatDate(commission.expectedDate)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(toNumber(commission.expectedAmount))}</TableCell>
                      <TableCell>
                        <StatusBadge status={commission.status} entity="commission" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                page={page}
                pageSize={DEFAULT_PAGE_SIZE}
                total={openCount}
                basePath="/commissions"
                searchParams={{ q: query, sort: sortKey ?? undefined, dir: direction ?? undefined }}
              />
            </>
          )}
        </SectionCard>

        <SectionCard title="Comisiones cobradas" description="Últimos cierres que ya entraron a caja.">
          {safePaidCommissions.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={BadgeCheck}
                title="Sin comisiones cobradas"
                description="Cuando registres pagos de comisión, aparecerán aquí los cierres más recientes."
              />
            </div>
          ) : (
            <div className="divide-y divide-stone-200/80">
              {safePaidCommissions.map((commission) => (
                <div key={commission.id} className="flex items-start justify-between gap-4 px-4 py-4">
                  <div className="min-w-0">
                    <Link href={`/policies/${commission.policyId}`} className="font-medium text-foreground hover:text-primary">
                      {commission.policy.policyNumber}
                    </Link>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {commission.client.fullName} · {commission.insurer.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {commission.paidDate ? formatDate(commission.paidDate) : formatDate(commission.expectedDate)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">{formatCurrency(toNumber(commission.actualAmount ?? commission.expectedAmount))}</p>
                    <StatusBadge status={commission.status} entity="commission" className="mt-1 w-fit" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
