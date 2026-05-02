import Link from "next/link";
import { ArrowRight, AlertTriangle, BadgeCheck, Clock, FileWarning, Plus, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { daysSince, formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";

export default async function ClaimsPage() {
  const db = getDb();

  const claims = await db.claim.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      client: true,
      policy: true,
      insurer: true,
    },
  });

  const openClaims = claims.filter((c) => c.status !== "RESOLVED" && c.status !== "CANCELLED");
  const resolvedClaims = claims.filter((c) => c.status === "RESOLVED");
  const inProgressClaims = claims.filter((c) => c.status === "IN_PROGRESS");
  const waitingClaims = claims.filter((c) => c.status === "WAITING_CLIENT" || c.status === "WAITING_INSURER");

  const totalClaimed = claims.reduce((sum, c) => sum + Number(c.amountClaimed ?? 0), 0);
  const totalPaid = claims.reduce((sum, c) => sum + Number(c.amountPaid ?? 0), 0);

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
            value={openClaims.length}
            description={`${inProgressClaims.length} en progreso, ${waitingClaims.length} en espera`}
            icon={AlertTriangle}
            tone="amber"
          />
          <MetricCard
            title="Resueltos"
            value={resolvedClaims.length}
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

        <SectionCard title="Siniestros recientes" description="Listado completo de reclamaciones.">
          {claims.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              No hay siniestros registrados.
            </div>
          ) : (
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
                {claims.slice(0, 20).map((claim) => (
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
          )}
          {claims.length > 20 && (
            <div className="border-t border-stone-200/80 px-4 py-3 text-center text-sm text-muted-foreground">
              Mostrando 20 de {claims.length} siniestros
            </div>
          )}
        </SectionCard>

        <section className="grid gap-6 xl:grid-cols-2">
          <SectionCard title="En espera" description="Siniestros bloqueados a la espera de información.">
            {waitingClaims.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                No hay siniestros en espera.
              </div>
            ) : (
              <div className="divide-y divide-stone-200/80">
                {waitingClaims.slice(0, 5).map((claim) => (
                  <div key={claim.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <Link
                        href={`/claims/${claim.id}`}
                        className="font-medium text-foreground hover:text-primary"
                      >
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
            {resolvedClaims.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                No hay siniestros resueltos.
              </div>
            ) : (
              <div className="divide-y divide-stone-200/80">
                {resolvedClaims.slice(0, 5).map((claim) => (
                  <div key={claim.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <Link
                        href={`/claims/${claim.id}`}
                        className="font-medium text-foreground hover:text-primary"
                      >
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
