import Link from "next/link";
import { ArrowRight, Building2, FileText, Plus, ShieldCheck, Users2, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { formatCurrency, toNumber } from "@/lib/money";

export default async function InsurersPage() {
  const db = getDb();

  const insurers = await db.insurer.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: { policies: true, claims: true },
      },
      policies: {
        where: { status: "ACTIVE" },
        select: { premiumAmount: true },
      },
    },
  });

  const activeInsurers = insurers.filter((i) => i.status === "ACTIVE");
  const archivedInsurers = insurers.filter((i) => i.status === "ARCHIVED");

  const totalPortfolioValue = insurers.reduce((sum, insurer) => {
    const insurerValue = insurer.policies.reduce((s, p) => s + toNumber(p.premiumAmount), 0);
    return sum + insurerValue;
  }, 0);

  const totalPolicies = insurers.reduce((sum, i) => sum + i._count.policies, 0);
  const totalClaims = insurers.reduce((sum, i) => sum + i._count.claims, 0);

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
            value={activeInsurers.length}
            description="Partners comerciales vigentes."
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

        <SectionCard title="Directorio de aseguradoras" description="Listado completo con métricas de negocio.">
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
              {insurers.map((insurer) => {
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
        </SectionCard>

        {archivedInsurers.length > 0 && (
          <SectionCard title="Aseguradoras archivadas" description="Partners inactivos históricos.">
            <div className="divide-y divide-stone-200/80">
              {archivedInsurers.map((insurer) => (
                <div key={insurer.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="font-medium text-foreground">{insurer.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {insurer._count.policies} pólizas históricas
                    </p>
                  </div>
                  <Button asChild variant="outline" size="sm" className="rounded-full">
                    <Link href={`/insurers/${insurer.id}`}>Ver</Link>
                  </Button>
                </div>
              ))}
            </div>
          </SectionCard>
        )}
      </div>
    </main>
  );
}
