import Link from "next/link";
import { connection } from "next/server";
import { ArrowRight, BadgeCheck, CircleAlert, HandCoins, TrendingUp } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-states/empty-state";
import { ListSearch } from "@/components/lists/list-search";
import { Pagination } from "@/components/lists/pagination";
import { getCommissionStats, getOverdueCommissions, autoUpdateCommissionStatuses } from "@/lib/commissions";
import { formatDate } from "@/lib/dates";
import { formatCurrency, toNumber } from "@/lib/money";
import { getDb } from "@/lib/db";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";
import { commissionOperationalWhere, requirePortfolioReadScope } from "@/lib/portfolio-access";

export default async function CommissionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string }>;
}) {
  await connection();
  const scope = await requirePortfolioReadScope();
  // Run side-effect first; downstream reads must see the new statuses.
  await autoUpdateCommissionStatuses(scope.portfolioOwnerId);

  const params = (await searchParams) ?? {};
  const query = (params.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number(params.page) || 1);

  const openWhere: Prisma.CommissionWhereInput = {
    ...commissionOperationalWhere(scope.portfolioOwnerId),
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

  const db = getDb();
  const [stats, overdueCommissions, openCount, openCommissions, paidCommissions] = await Promise.all([
    getCommissionStats(undefined, scope.portfolioOwnerId),
    getOverdueCommissions(scope.portfolioOwnerId),
    db.commission.count({ where: openWhere }),
    db.commission.findMany({
      where: openWhere,
      include: { client: true, insurer: true, policy: true, receipt: true },
      orderBy: [{ status: "asc" }, { expectedDate: "asc" }],
      skip: (page - 1) * DEFAULT_PAGE_SIZE,
      take: DEFAULT_PAGE_SIZE,
    }),
    db.commission.findMany({
      where: { status: "PAID" },
      include: { client: true, insurer: true, policy: true, receipt: true },
      orderBy: [{ paidDate: "desc" }, { expectedDate: "desc" }],
      take: 10,
    }),
  ]);

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
  const safeOpenCommissions = openCommissions.filter(hasRelations);
  const safePaidCommissions = paidCommissions.filter(hasRelations);
  const paidCount = stats.statusBreakdown.find(({ status }) => status === "PAID")?.count ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Finanzas"
          title="Comisiones"
          description="Seguimiento de ingreso esperado, cobrado y vencido por póliza."
          actions={
            <Button asChild className="rounded-full">
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
          action={<ListSearch placeholder="Buscar por póliza, cliente o aseguradora..." />}
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
                action="Volver al inicio"
                actionHref={query ? `/commissions?q=${encodeURIComponent(query)}` : "/commissions"}
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
                    <TableHead>Esperada</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Estado</TableHead>
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
                        <StatusBadge status={commission.status} />
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
                searchParams={{ q: query }}
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
                    <StatusBadge status={commission.status} className="mt-1 w-fit" />
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
