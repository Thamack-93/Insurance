import Link from "next/link";
import { ArrowRight, Building2, CalendarDays, ShieldCheck, Users } from "@/components/icons";
import type { Prisma } from "@/generated/prisma/client";
import { PageHeader } from "@/components/layout/page-header";
import { LocalNavigation } from "@/components/layout/local-navigation";
import { reportsNavigation } from "@/lib/navigation";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-states/empty-state";
import { Pagination } from "@/components/lists/pagination";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { SortableTableHead } from "@/components/tables/sortable-table-head";
import { withTenantTransaction } from "@/lib/organization-context";
import { daysUntil, formatDate, today } from "@/lib/dates";
import { formatCurrency, toNumber } from "@/lib/money";
import { convertMoneyValue, loadCurrencyRates, summarizeMoney } from "@/lib/currency-rates";
import { policyTypeLabel } from "@/lib/status";
import { policyTypeOptions } from "@/lib/domain-options";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";
import { loadEligibleRenewalPolicies } from "@/lib/renewals";
import {
  clientOperationalWhere,
  policyOperationalWhere,
  receiptOperationalWhere,
  requireOrganizationPortfolioReadScope,
} from "@/lib/portfolio-access";
import { getInsurerHref } from "@/lib/insurer-navigation";
import { buildTableHref, readAllowedTableParam, readTablePage, readTableParam, readTableSort } from "@/lib/table-query";

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string; sort?: string; dir?: string; type?: string; insurerId?: string }>;
}) {
  const scope = await requireOrganizationPortfolioReadScope();
  const policyScope = policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId);
  const clientScope = clientOperationalWhere(scope.portfolioOwnerId, scope.organizationId);
  const receiptScope = receiptOperationalWhere(scope.portfolioOwnerId, scope.organizationId);
  const now = today();
  const in60 = new Date(now);
  in60.setDate(in60.getDate() + 60);
  const params = (await searchParams) ?? {};
  const query = (params.q ?? "").trim().slice(0, 100);
  const page = readTablePage(params);
  const typeFilter = readAllowedTableParam(params, "type", policyTypeOptions.map((option) => option.value));
  const insurerFilter = readTableParam(params, "insurerId");
  const { sortKey, direction } = readTableSort(params);

  const activePolicyWhere: Prisma.PolicyWhereInput = {
    ...policyScope,
    status: "ACTIVE",
    ...(insurerFilter ? { insurerId: insurerFilter } : {}),
  };
  const renewalSoonPromise = loadEligibleRenewalPolicies(
    {
      endDate: {
        gte: now,
        lte: in60,
      },
      ...(insurerFilter ? { insurerId: insurerFilter } : {}),
    },
    scope.portfolioOwnerId,
  );

  const where: Prisma.PolicyWhereInput = {
    ...activePolicyWhere,
    ...(typeFilter ? { policyType: typeFilter } : {}),
    ...(query
      ? {
          OR: [
            { policyNumber: { contains: query } },
            { client: { fullName: { contains: query } } },
            { insurer: { name: { contains: query } } },
          ],
      }
      : {}),
  };

  const orderBy =
    sortKey === "policyNumber"
      ? [{ policyNumber: direction ?? "asc" }, { endDate: "asc" as const }]
      : sortKey === "client"
        ? [{ client: { fullName: direction ?? "asc" } }, { endDate: "asc" as const }]
        : sortKey === "insurer"
          ? [{ insurer: { name: direction ?? "asc" } }, { endDate: "asc" as const }]
          : sortKey === "endDate"
            ? [{ endDate: direction ?? "asc" }, { premiumAmount: "desc" as const }]
            : sortKey === "premiumAmount"
              ? [{ premiumAmount: direction ?? "desc" }, { endDate: "asc" as const }]
              : [{ premiumAmount: "desc" as const }, { endDate: "asc" as const }];

  const directPortfolioData = withTenantTransaction(scope.context, (db) => Promise.all([
    db.policy.count({ where }),
    db.policy.findMany({
      where,
      include: { client: true, insurer: true },
      orderBy,
      skip: (page - 1) * DEFAULT_PAGE_SIZE,
      take: DEFAULT_PAGE_SIZE,
    }),
    db.policy.groupBy({
      by: ["currency"],
      where: activePolicyWhere,
      _sum: { premiumAmount: true },
    }),
    loadCurrencyRates(db, scope.organizationId, now),
    db.policy.count({ where: activePolicyWhere }),
    db.client.count({
      where: {
        ...clientScope,
        status: "ACTIVE",
        ...(insurerFilter ? { policies: { some: { status: "ACTIVE", insurerId: insurerFilter } } } : {}),
      },
    }),
    db.insurer.count({
      where: {
        status: "ACTIVE",
        ...(insurerFilter ? { id: insurerFilter } : {}),
        ...(scope.portfolioOwnerId || insurerFilter
          ? { policies: { some: activePolicyWhere } }
          : {}),
      },
    }),
    db.receipt.findMany({
      where: {
        ...receiptScope,
        ...(insurerFilter ? { insurerId: insurerFilter } : {}),
        dueDate: { gte: now, lte: in60 },
        status: { in: ["PENDING", "OVERDUE"] },
      },
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
      take: 10,
    }),
    db.policy.groupBy({
      by: ["insurerId"],
      where: activePolicyWhere,
      _count: { _all: true },
      _sum: { premiumAmount: true },
    }),
    db.policy.groupBy({
      by: ["clientId"],
      where: activePolicyWhere,
      _count: { _all: true },
      _sum: { premiumAmount: true },
      orderBy: { _sum: { premiumAmount: "desc" } },
      take: 10,
    }),
  ]));
  const [directPortfolioValues, renewalSoonPolicies] = await Promise.all([directPortfolioData, renewalSoonPromise]);
  const [
    activeCount,
    pagedPolicies,
    portfolioCurrencyRows,
    portfolioRates,
    activePolicyCount,
    activeClientCount,
    activeInsurerCount,
    dueReceipts,
    insurerDistribution,
    topClientsRows,
  ] = directPortfolioValues;
  const topClientIds = topClientsRows.map((row) => row.clientId);
  const topClientNames = topClientIds.length
    ? new Map(
        (await withTenantTransaction(scope.context, (db) => db.client.findMany({
          where: { ...clientScope, id: { in: topClientIds } },
          select: { id: true, fullName: true },
        }))).map((c) => [c.id, c.fullName] as const),
      )
    : new Map<string, string>();
  const topClientsByExposure = topClientsRows.map((row) => ({
    id: row.clientId,
    name: topClientNames.get(row.clientId) ?? "—",
    policies: row._count._all,
    value: toNumber(row._sum.premiumAmount),
  }));

  const portfolioMoney = summarizeMoney(portfolioCurrencyRows.map((row) => convertMoneyValue(
    row._sum.premiumAmount,
    row.currency,
    now,
    portfolioRates,
  )));
  const portfolioValue = portfolioMoney.totalMxn === null ? null : toNumber(portfolioMoney.totalMxn);
  const insurerIds = insurerDistribution.map((row) => row.insurerId);
  const insurerNames = insurerIds.length
    ? new Map(
        (await withTenantTransaction(scope.context, (db) => db.insurer.findMany({
          where: { id: { in: insurerIds } },
          select: { id: true, name: true },
        }))).map((i) => [i.id, i.name] as const),
      )
    : new Map<string, string>();
  const activeByInsurer = insurerDistribution
    .map((row) => ({
      id: row.insurerId,
      name: insurerNames.get(row.insurerId) ?? "—",
      policies: row._count._all,
      value: toNumber(row._sum.premiumAmount),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);
  const selectedInsurer = insurerFilter
    ? await withTenantTransaction(scope.context, (db) => db.insurer.findFirst({
        where: {
          id: insurerFilter,
          ...(scope.portfolioOwnerId || insurerFilter
            ? { policies: { some: activePolicyWhere } }
            : {}),
        },
        select: { id: true, name: true },
      }))
    : null;
  const insurerOptions = activeByInsurer.map((insurer) => ({ value: insurer.id, label: insurer.name }));
  const selectedInsurerName = selectedInsurer?.name ?? (insurerFilter ? "Aseguradora seleccionada" : null);
  const insurerHref = (id: string) => getInsurerHref(id, scope.role === "ADMIN");

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Cartera"
          title="Cartera"
          description={selectedInsurerName
            ? `Cartera activa de ${selectedInsurerName}, sus renovaciones y concentración.`
            : "Vista ejecutiva de la cartera activa, su concentración y las renovaciones más cercanas."}
          actions={
            <>
              <Button asChild variant="outline" className="bg-card/70">
                <Link href="/renewals">Renovaciones</Link>
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

        <LocalNavigation items={reportsNavigation} label="Secciones de reportes" />

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <MetricCard
            title="Cartera activa"
            value={portfolioValue === null ? "Sin tasa" : formatCurrency(portfolioValue, "MXN")}
            description={portfolioMoney.missingCurrencies.length
              ? `MXN · Sin tasa: ${portfolioMoney.missingCurrencies.join(", ")}`
              : `${activePolicyCount} pólizas activas en ${activeInsurerCount} aseguradoras`}
            icon={ShieldCheck}
            tone="emerald"
          />
          <MetricCard
            title="Clientes activos"
            value={activeClientCount}
            description="Clientes con operación viva y seguimiento potencial."
            icon={Users}
            tone="blue"
          />
          <MetricCard
            title="Renovaciones 60 días"
            value={renewalSoonPolicies.length}
            description="Pólizas activas con vencimiento próximo."
            icon={CalendarDays}
            tone="amber"
          />
          <MetricCard
            title="Recibos próximos"
            value={dueReceipts.length}
            description="Cobros del siguiente horizonte de 60 días."
            icon={Building2}
            tone="rose"
          />
        </section>

        <SectionCard
          title="Pólizas activas"
          description="Ordenadas por prima. Listado paginado con búsqueda."
          action={
            <TableToolbar
              searchPlaceholder="Buscar por póliza, cliente o aseguradora..."
              filters={[
                {
                  key: "type",
                  label: "Tipo",
                  options: policyTypeOptions,
                },
                {
                  key: "insurerId",
                  label: "Aseguradora",
                  options: insurerOptions,
                },
              ]}
            />
          }
        >
          {activeCount === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={ShieldCheck}
                title={query ? "Sin resultados" : "Sin pólizas activas"}
                description={
                  query
                    ? `No encontramos pólizas activas que coincidan con "${query}".`
                    : "Cuando registres pólizas activas, aparecerán aquí ordenadas por prima."
                }
                action={query ? undefined : { label: "Nueva póliza", href: "/policies/new" }}
              />
            </div>
          ) : pagedPolicies.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={ShieldCheck}
                title="Página fuera de rango"
                description="Vuelve al inicio del listado."
                action={{ label: "Volver al inicio", href: buildTableHref("/portfolio", params, { q: query || null, type: typeFilter || null, }) }}
              />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <SortableTableHead sortKey="policyNumber">Póliza</SortableTableHead>
                    <SortableTableHead sortKey="client">Cliente</SortableTableHead>
                    <SortableTableHead sortKey="insurer">Aseguradora</SortableTableHead>
                    <TableHead>Tipo</TableHead>
                    <SortableTableHead sortKey="endDate">Renovación</SortableTableHead>
                    <TableHead className="text-right">Prima</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedPolicies.map((policy) => (
                    <TableRow key={policy.id}>
                      <TableCell>
                        <Link href={`/policies/${policy.id}`} className="font-medium text-foreground hover:text-primary">
                          {policy.policyNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/clients/${policy.clientId}`} className="text-foreground hover:text-primary">
                          {policy.client.fullName}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={insurerHref(policy.insurerId)} className="text-foreground hover:text-primary">
                          {policy.insurer.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="rounded-full">
                          {policyTypeLabel(policy.policyType)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {policy.endDate ? (
                          <span className="text-sm text-muted-foreground">
                            {formatDate(policy.endDate)} · {daysUntil(policy.endDate)} días
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">Sin fecha</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(policy.premiumAmount, policy.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                page={page}
                pageSize={DEFAULT_PAGE_SIZE}
                total={activeCount}
                basePath="/portfolio"
                searchParams={{
                  q: query,
                  type: typeFilter ?? undefined,
                  insurerId: insurerFilter ?? undefined,
                  sort: sortKey ?? undefined,
                  dir: direction ?? undefined,
                }}
              />
            </>
          )}
        </SectionCard>

        <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <SectionCard title="Concentración por aseguradora" description="Valor activo en moneda original; la tarjeta superior muestra el total MXN convertido.">
            {activeByInsurer.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={Building2}
                  title="Sin distribución"
                  description="Cuando tengas pólizas activas, aparecerá aquí su concentración por aseguradora."
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Aseguradora</TableHead>
                    <TableHead className="text-right">Pólizas</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeByInsurer.map((insurer) => (
                    <TableRow key={insurer.id}>
                      <TableCell className="font-medium">
                        <Link href={insurerHref(insurer.id)} className="text-foreground hover:text-primary">
                          {insurer.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">{insurer.policies}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(insurer.value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>

          <SectionCard
            title="Clientes con mayor exposición"
            description="Top 10 por prima activa acumulada en moneda original."
          >
            {topClientsByExposure.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={Users}
                  title="Sin exposición activa"
                  description="Cuando registres pólizas activas, verás aquí a tus clientes top."
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Pólizas</TableHead>
                    <TableHead className="text-right">Prima</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topClientsByExposure.map((client) => (
                    <TableRow key={client.id}>
                      <TableCell className="font-medium">
                        <Link href={`/clients/${client.id}`} className="text-foreground hover:text-primary">
                          {client.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">{client.policies}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(client.value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </section>

        <section className="grid gap-6">
          <SectionCard title="Recibos próximos" description="Cobros ya en el radar para las próximas semanas.">
            {dueReceipts.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={CalendarDays}
                  title="Sin cobros próximos"
                  description="No hay recibos pendientes en el horizonte de 60 días."
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Recibo</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Vencimiento</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dueReceipts.map((receipt) => (
                    <TableRow key={receipt.id}>
                      <TableCell>
                        <Link href={`/policies/${receipt.policyId}`} className="font-medium text-foreground hover:text-primary">
                          {receipt.receiptNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/clients/${receipt.clientId}`} className="text-foreground hover:text-primary">
                          {receipt.client.fullName}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{formatDate(receipt.dueDate)}</span>
                          <StatusBadge status={receipt.status} entity="receipt" className="mt-1 w-fit" />
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
    </div>
  );
}
