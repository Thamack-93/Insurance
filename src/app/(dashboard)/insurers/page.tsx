import Link from "next/link";
import { ArrowRight, Building2, FileText, Plus, ShieldCheck, TrendingUp } from "lucide-react";
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
import { formatCurrency, toNumber } from "@/lib/money";

const PAGE_SIZE = 25;

export default async function InsurersPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const query = (params.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number(params.page) || 1);

  const db = getDb();

  const where: Prisma.InsurerWhereInput = query
    ? {
        OR: [
          { name: { contains: query } },
          { contactEmail: { contains: query } },
          { contactName: { contains: query } },
        ],
      }
    : {};

  const [
    activeCount,
    archivedCount,
    totalPolicies,
    totalClaims,
    portfolioAgg,
    filteredCount,
    pagedInsurers,
  ] = await Promise.all([
    db.insurer.count({ where: { status: "ACTIVE" } }),
    db.insurer.count({ where: { status: "ARCHIVED" } }),
    db.policy.count(),
    db.claim.count(),
    db.policy.aggregate({
      where: { status: "ACTIVE" },
      _sum: { premiumAmount: true },
    }),
    db.insurer.count({ where }),
    db.insurer.findMany({
      where,
      orderBy: { name: "asc" },
      include: {
        _count: { select: { policies: true, claims: true } },
        policies: {
          where: { status: "ACTIVE" },
          select: { premiumAmount: true },
        },
      },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const totalPortfolioValue = toNumber(portfolioAgg._sum.premiumAmount ?? 0);

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Catálogo"
          title="Aseguradoras"
          description="Directorio de compañías aseguradoras, volumen de negocio y concentración de cartera."
          actions={
            <>
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/insurers/new">
                  <Plus className="mr-2 size-4" />
                  Nueva aseguradora
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
            title="Aseguradoras activas"
            value={activeCount}
            description={`${archivedCount} archivadas`}
            icon={Building2}
            tone="blue"
          />
          <MetricCard
            title="Valor en cartera"
            value={formatCurrency(totalPortfolioValue)}
            description="Suma de primas activas."
            icon={TrendingUp}
            tone="emerald"
          />
          <MetricCard
            title="Total pólizas"
            value={totalPolicies}
            description="Contratos vinculados."
            icon={ShieldCheck}
            tone="amber"
          />
          <MetricCard
            title="Siniestros"
            value={totalClaims}
            description="Registrados en el sistema."
            icon={FileText}
            tone="rose"
          />
        </section>

        <SectionCard
          title="Directorio de aseguradoras"
          description="Listado completo con métricas de negocio."
          action={<ListSearch placeholder="Buscar por nombre o contacto..." />}
        >
          {filteredCount === 0 ? (
            query ? (
              <div className="p-4">
                <EmptyState
                  icon={Building2}
                  title="Sin resultados"
                  description={`No encontramos aseguradoras que coincidan con "${query}".`}
                />
              </div>
            ) : (
              <div className="p-4">
                <EmptyState
                  icon={Building2}
                  title="Aún no hay aseguradoras"
                  description="Registra tu primera compañía aseguradora para enlazar pólizas."
                  action="Nueva aseguradora"
                  actionHref="/insurers/new"
                />
              </div>
            )
          ) : pagedInsurers.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={Building2}
                title="Página fuera de rango"
                description="No hay aseguradoras en esta página. Vuelve al inicio del listado."
                action="Volver al inicio"
                actionHref={query ? `/insurers?q=${encodeURIComponent(query)}` : "/insurers"}
              />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/70">
                    <TableHead>Nombre</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Pólizas</TableHead>
                    <TableHead className="text-right">Siniestros</TableHead>
                    <TableHead className="text-right">Valor cartera</TableHead>
                    <TableHead>Portal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedInsurers.map((insurer) => {
                    const portfolioValue = insurer.policies.reduce(
                      (sum, p) => sum + toNumber(p.premiumAmount),
                      0
                    );
                    return (
                      <TableRow key={insurer.id}>
                        <TableCell>
                          <Link
                            href={`/insurers/${insurer.id}`}
                            className="font-medium text-foreground hover:text-primary"
                          >
                            {insurer.name}
                          </Link>
                          {insurer.contactEmail && (
                            <p className="text-xs text-muted-foreground">{insurer.contactEmail}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={insurer.status} />
                        </TableCell>
                        <TableCell className="text-right">{insurer._count.policies}</TableCell>
                        <TableCell className="text-right">{insurer._count.claims}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(portfolioValue)}
                        </TableCell>
                        <TableCell>
                          {insurer.portalUrl ? (
                            <a
                              href={insurer.portalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-primary hover:underline"
                            >
                              Acceder
                            </a>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={filteredCount}
                basePath="/insurers"
                searchParams={{ q: query }}
              />
            </>
          )}
        </SectionCard>
      </div>
    </main>
  );
}
