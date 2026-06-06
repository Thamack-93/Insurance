import Link from "next/link";
import { ArrowRight, Building2, CalendarDays, ShieldCheck, Users } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-states/empty-state";
import { ListSearch } from "@/components/lists/list-search";
import { Pagination } from "@/components/lists/pagination";
import { getDb } from "@/lib/db";
import { daysUntil, formatDate, today } from "@/lib/dates";
import { formatCurrency, toNumber } from "@/lib/money";
import { policyTypeLabel } from "@/lib/status";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";
import { loadEligibleRenewalPolicies } from "@/lib/renewals";

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string }>;
}) {
  const db = getDb();
  const now = today();
  const in60 = new Date(now);
  in60.setDate(in60.getDate() + 60);
  const renewalSoonPromise = loadEligibleRenewalPolicies(
    {
      endDate: {
        gte: now,
        lte: in60,
      },
    },
    undefined,
  );

  const params = (await searchParams) ?? {};
  const query = (params.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number(params.page) || 1);

  const where: Prisma.PolicyWhereInput = {
    status: "ACTIVE",
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

  const [
    activeCount,
    pagedPolicies,
    portfolioAgg,
    activePolicyCount,
    activeClientCount,
    activeInsurerCount,
    renewalSoonPolicies,
    dueReceipts,
    insurerDistribution,
    topClientsRows,
  ] = await Promise.all([
    db.policy.count({ where }),
    db.policy.findMany({
      where,
      include: { client: true, insurer: true },
      orderBy: [{ premiumAmount: "desc" }, { endDate: "asc" }],
      skip: (page - 1) * DEFAULT_PAGE_SIZE,
      take: DEFAULT_PAGE_SIZE,
    }),
    db.policy.aggregate({
      where: { status: "ACTIVE" },
      _sum: { premiumAmount: true },
    }),
    db.policy.count({ where: { status: "ACTIVE" } }),
    db.client.count({ where: { status: "ACTIVE" } }),
    db.insurer.count({ where: { status: "ACTIVE" } }),
    renewalSoonPromise,
    db.receipt.findMany({
      where: { dueDate: { gte: now, lte: in60 }, status: { in: ["PENDING", "OVERDUE"] } },
      include: { client: true, policy: true, insurer: true },
      orderBy: { dueDate: "asc" },
      take: 10,
    }),
    db.policy.groupBy({
      by: ["insurerId"],
      where: { status: "ACTIVE" },
      _count: { _all: true },
      _sum: { premiumAmount: true },
    }),
    db.policy.groupBy({
      by: ["clientId"],
      where: { status: "ACTIVE" },
      _count: { _all: true },
      _sum: { premiumAmount: true },
      orderBy: { _sum: { premiumAmount: "desc" } },
      take: 10,
    }),
  ]);
  const topClientIds = topClientsRows.map((row) => row.clientId);
  const topClientNames = topClientIds.length
    ? new Map(
        (await db.client.findMany({
          where: { id: { in: topClientIds } },
          select: { id: true, fullName: true },
        })).map((c) => [c.id, c.fullName] as const),
      )
    : new Map<string, string>();
  const topClientsByExposure = topClientsRows.map((row) => ({
    id: row.clientId,
    name: topClientNames.get(row.clientId) ?? "—",
    policies: row._count._all,
    value: toNumber(row._sum.premiumAmount),
  }));

  const portfolioValue = toNumber(portfolioAgg._sum.premiumAmount);
  const insurerIds = insurerDistribution.map((row) => row.insurerId);
  const insurerNames = insurerIds.length
    ? new Map(
        (await db.insurer.findMany({
          where: { id: { in: insurerIds } },
          select: { id: true, name: true },
        })).map((i) => [i.id, i.name] as const),
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

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Cartera"
          title="Cartera"
          description="Vista ejecutiva de la cartera activa, su concentración y las renovaciones más cercanas."
          actions={
            <>
              <Button asChild variant="outline" className="rounded-full bg-card/70">
                <Link href="/renewals">Renovaciones</Link>
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

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <MetricCard
            title="Cartera activa"
            value={formatCurrency(portfolioValue)}
            description={`${activePolicyCount} pólizas activas en ${activeInsurerCount} aseguradoras`}
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
          action={<ListSearch placeholder="Buscar por póliza, cliente o aseguradora..." />}
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
                action={query ? undefined : "Nueva póliza"}
                actionHref={query ? undefined : "/policies/new"}
              />
            </div>
          ) : pagedPolicies.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={ShieldCheck}
                title="Página fuera de rango"
                description="Vuelve al inicio del listado."
                action="Volver al inicio"
                actionHref={query ? `/portfolio?q=${encodeURIComponent(query)}` : "/portfolio"}
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
                    <TableHead>Tipo</TableHead>
                    <TableHead>Renovación</TableHead>
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
                      <TableCell>{policy.insurer.name}</TableCell>
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
                searchParams={{ q: query }}
              />
            </>
          )}
        </SectionCard>

        <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <SectionCard title="Concentración por aseguradora" description="Valor activo por partner.">
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
                      <TableCell className="font-medium">{insurer.name}</TableCell>
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
            description="Top 10 por prima activa acumulada."
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
    </div>
  );
}
