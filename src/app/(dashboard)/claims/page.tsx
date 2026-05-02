import Link from "next/link";
import { ArrowRight, AlertTriangle, BadgeCheck, Clock, FileWarning, Plus, TrendingUp } from "lucide-react";
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

export default async function ClaimsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const query = (params.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number(params.page) || 1);

  const db = getDb();

  const where: Prisma.ClaimWhereInput = query
    ? {
        OR: [
          { folio: { contains: query } },
          { claimType: { contains: query } },
          { client: { fullName: { contains: query } } },
        ],
      }
    : {};

  const [
    openCount,
    inProgressCount,
    resolvedCount,
    waitingCount,
    claimedAgg,
    paidAgg,
    filteredCount,
    pagedClaims,
    waitingClaims,
    resolvedRecent,
  ] = await Promise.all([
    db.claim.count({ where: { status: { notIn: ["RESOLVED", "CANCELLED"] } } }),
    db.claim.count({ where: { status: "IN_PROGRESS" } }),
    db.claim.count({ where: { status: "RESOLVED" } }),
    db.claim.count({ where: { status: { in: ["WAITING_CLIENT", "WAITING_INSURER"] } } }),
    db.claim.aggregate({ _sum: { amountClaimed: true } }),
    db.claim.aggregate({ _sum: { amountPaid: true } }),
    db.claim.count({ where }),
    db.claim.findMany({
      where,
      include: { client: true, policy: true, insurer: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.claim.findMany({
      where: { status: { in: ["WAITING_CLIENT", "WAITING_INSURER"] } },
      include: { client: true, insurer: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    db.claim.findMany({
      where: { status: "RESOLVED" },
      include: { client: true },
      orderBy: { closedDate: "desc" },
      take: 5,
    }),
  ]);

  const totalClaimed = Number(claimedAgg._sum.amountClaimed ?? 0);
  const totalPaid = Number(paidAgg._sum.amountPaid ?? 0);

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Operación"
          title="Siniestros"
          description="Seguimiento de reclamaciones, reservas y pagos por siniestro."
          actions={
            <>
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/claims/new">
                  <Plus className="mr-2 size-4" />
                  Nuevo siniestro
                </Link>
              </Button>
              <Button asChild className="rounded-full">
                <Link href="/risks">
                  Ver riesgos
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            </>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Abiertos"
            value={openCount}
            description={`${inProgressCount} en progreso, ${waitingCount} en espera`}
            icon={AlertTriangle}
            tone="amber"
          />
          <MetricCard
            title="Resueltos"
            value={resolvedCount}
            description="Siniestros cerrados exitosamente."
            icon={BadgeCheck}
            tone="emerald"
          />
          <MetricCard
            title="Monto reclamado"
            value={formatCurrency(totalClaimed)}
            description="Total de reservas registradas."
            icon={TrendingUp}
            tone="blue"
          />
          <MetricCard
            title="Monto pagado"
            value={formatCurrency(totalPaid)}
            description="Total indemnizado."
            icon={FileWarning}
            tone="rose"
          />
        </section>

        <SectionCard
          title="Siniestros"
          description="Listado completo de reclamaciones."
          action={<ListSearch placeholder="Buscar por folio, tipo o cliente..." />}
        >
          {filteredCount === 0 ? (
            query ? (
              <div className="p-4">
                <EmptyState
                  icon={AlertTriangle}
                  title="Sin resultados"
                  description={`No encontramos siniestros que coincidan con "${query}".`}
                />
              </div>
            ) : (
              <div className="p-4">
                <EmptyState
                  icon={AlertTriangle}
                  title="No hay siniestros registrados"
                  description="Registra el primer reclamo cuando aparezca un caso operativo."
                  action="Nuevo siniestro"
                  actionHref="/claims/new"
                />
              </div>
            )
          ) : pagedClaims.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={AlertTriangle}
                title="Página fuera de rango"
                description="No hay siniestros en esta página. Vuelve al inicio del listado."
                action="Volver al inicio"
                actionHref={query ? `/claims?q=${encodeURIComponent(query)}` : "/claims"}
              />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/70">
                    <TableHead>Folio</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Aseguradora</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Incidente</TableHead>
                    <TableHead className="text-right">Reclamado</TableHead>
                    <TableHead className="text-right">Pagado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedClaims.map((claim) => (
                    <TableRow key={claim.id}>
                      <TableCell>
                        <Link
                          href={`/claims/${claim.id}`}
                          className="font-medium text-foreground hover:text-primary"
                        >
                          {claim.folio}
                        </Link>
                      </TableCell>
                      <TableCell>{claim.client.fullName}</TableCell>
                      <TableCell>{claim.claimType}</TableCell>
                      <TableCell>{claim.insurer.name}</TableCell>
                      <TableCell>
                        <StatusBadge status={claim.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Clock className="size-3" />
                          {formatDate(claim.incidentDate)}
                          <span className="text-xs">({daysSince(claim.incidentDate)} d)</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {claim.amountClaimed ? formatCurrency(claim.amountClaimed) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {claim.amountPaid ? formatCurrency(claim.amountPaid) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={filteredCount}
                basePath="/claims"
                searchParams={{ q: query }}
              />
            </>
          )}
        </SectionCard>

        <section className="grid gap-6 xl:grid-cols-2">
          <SectionCard title="En espera" description="Siniestros bloqueados a la espera de información.">
            {waitingClaims.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={BadgeCheck}
                  title="Sin bloqueos"
                  description="Todos los siniestros están avanzando o cerrados."
                />
              </div>
            ) : (
              <div className="divide-y divide-stone-200/80">
                {waitingClaims.map((claim) => (
                  <div key={claim.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <Link href={`/claims/${claim.id}`} className="font-medium text-foreground hover:text-primary">
                        {claim.folio}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {claim.client.fullName} · {claim.insurer.name}
                      </p>
                    </div>
                    <StatusBadge status={claim.status} />
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Recién resueltos" description="Últimos siniestros cerrados.">
            {resolvedRecent.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={BadgeCheck}
                  title="Aún sin cierres"
                  description="Cuando cierres tu primer siniestro aparecerá aquí."
                />
              </div>
            ) : (
              <div className="divide-y divide-stone-200/80">
                {resolvedRecent.map((claim) => (
                  <div key={claim.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <Link href={`/claims/${claim.id}`} className="font-medium text-foreground hover:text-primary">
                        {claim.folio}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {claim.client.fullName}
                        {claim.closedDate && ` · Cerrado: ${formatDate(claim.closedDate)}`}
                      </p>
                    </div>
                    <div className="text-right">
                      {claim.amountPaid && (
                        <p className="text-sm font-medium">{formatCurrency(claim.amountPaid)}</p>
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
