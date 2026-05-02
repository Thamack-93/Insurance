import Link from "next/link";
import { addDays } from "date-fns";
import { ArrowRight, Plus, Shield, CalendarClock, AlertCircle, BadgeDollarSign, FolderKanban } from "lucide-react";
import type { Prisma } from "@prisma/client";
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

const PAGE_SIZE = 25;

export default async function PoliciesPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const query = (params.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number(params.page) || 1);

  const db = getDb();
  const now = today();
  const in60 = addDays(now, 60);

  const where: Prisma.PolicyWhereInput = query
    ? {
        OR: [
          { policyNumber: { contains: query } },
          { client: { fullName: { contains: query } } },
          { insurer: { name: { contains: query } } },
        ],
      }
    : {};

  const [
    activeCount,
    pendingCount,
    expiredCount,
    renewals60Count,
    portfolioAgg,
    filteredCount,
    pagedPolicies,
    attentionPolicies,
  ] = await Promise.all([
    db.policy.count({ where: { status: "ACTIVE" } }),
    db.policy.count({ where: { status: "PENDING" } }),
    db.policy.count({ where: { status: "EXPIRED" } }),
    db.policy.count({
      where: { status: "ACTIVE", renewalDate: { gte: now, lte: in60 } },
    }),
    db.policy.aggregate({
      where: { status: "ACTIVE" },
      _sum: { premiumAmount: true },
    }),
    db.policy.count({ where }),
    db.policy.findMany({
      where,
      include: { client: true, insurer: true },
      orderBy: [{ renewalDate: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.policy.findMany({
      where: { status: { in: ["EXPIRED", "PENDING"] } },
      include: { client: true, insurer: true },
      orderBy: [{ status: "asc" }, { renewalDate: "asc" }],
      take: 10,
    }),
  ]);

  const portfolioValue = toNumber(portfolioAgg._sum.premiumAmount ?? 0);

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="CRM"
          title="Pólizas"
          description="Inventario vivo de pólizas, con foco en estado, valor y renovación."
          actions={
            <>
              <Button asChild variant="outline" className="rounded-full bg-white/70">
                <Link href="/policies/new">
                  <Plus className="mr-2 size-4" />
                  Nueva póliza
                </Link>
              </Button>
              <Button asChild className="rounded-full">
                <Link href="/portfolio">
                  Portfolio
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            </>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Pólizas activas"
            value={activeCount}
            description={formatCurrency(portfolioValue)}
            icon={Shield}
            tone="emerald"
          />
          <MetricCard
            title="Renovaciones 60 días"
            value={renewals60Count}
            description="Pólizas activas con ventana de seguimiento."
            icon={CalendarClock}
            tone="amber"
          />
          <MetricCard
            title="Pendientes"
            value={pendingCount}
            description="Pólizas en captación o por finalizar."
            icon={BadgeDollarSign}
            tone="blue"
          />
          <MetricCard
            title="Vencidas"
            value={expiredCount}
            description="Pólizas que requieren atención inmediata."
            icon={AlertCircle}
            tone="rose"
          />
        </section>

        <SectionCard
          title="Inventario"
          description="Búsqueda y paginación sobre todas las pólizas."
          action={
            <ListSearch placeholder="Buscar por número, cliente o aseguradora..." />
          }
        >
          {filteredCount === 0 ? (
            query ? (
              <div className="p-4">
                <EmptyState
                  icon={FolderKanban}
                  title="Sin resultados"
                  description={`No encontramos pólizas que coincidan con "${query}".`}
                />
              </div>
            ) : (
              <div className="p-4">
                <EmptyState
                  icon={FolderKanban}
                  title="Aún no hay pólizas"
                  description="Registra tu primera póliza para construir el inventario."
                  action="Nueva póliza"
                  actionHref="/policies/new"
                />
              </div>
            )
          ) : pagedPolicies.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={FolderKanban}
                title="Página fuera de rango"
                description="No hay pólizas en esta página. Vuelve al inicio del listado."
                action="Volver al inicio"
                actionHref={query ? `/policies?q=${encodeURIComponent(query)}` : "/policies"}
              />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/70">
                    <TableHead>Póliza</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Aseguradora</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Renovación</TableHead>
                    <TableHead className="text-right">Prima</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedPolicies.map((policy) => (
                    <TableRow key={policy.id}>
                      <TableCell>
                        <Link
                          href={`/policies/${policy.id}`}
                          className="font-medium text-foreground hover:text-primary"
                        >
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
                        {policy.renewalDate ? (
                          <span className="text-sm text-muted-foreground">
                            {formatDate(policy.renewalDate)} · {daysUntil(policy.renewalDate)} días
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">Sin fecha</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(policy.premiumAmount, policy.currency)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={policy.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={filteredCount}
                basePath="/policies"
                searchParams={{ q: query }}
              />
            </>
          )}
        </SectionCard>

        <SectionCard
          title="Atención inmediata"
          description="Pólizas vencidas o pendientes que conviene mover esta semana."
        >
          {attentionPolicies.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={Shield}
                title="Cartera al día"
                description="No hay pólizas vencidas ni pendientes que reclamen atención inmediata."
              />
            </div>
          ) : (
            <div className="divide-y divide-stone-200/80">
              {attentionPolicies.map((policy) => (
                <div key={policy.id} className="flex items-start justify-between gap-4 px-4 py-4">
                  <div className="min-w-0">
                    <Link
                      href={`/policies/${policy.id}`}
                      className="font-medium text-foreground hover:text-primary"
                    >
                      {policy.policyNumber}
                    </Link>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {policy.client.fullName} · {policy.insurer.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {policy.renewalDate ? formatDate(policy.renewalDate) : "Sin renovación"} · {policyTypeLabel(policy.policyType)}
                    </p>
                  </div>
                  <StatusBadge status={policy.status} className="w-fit" />
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </main>
  );
}
