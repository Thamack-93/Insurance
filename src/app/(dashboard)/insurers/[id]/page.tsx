import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, FileText, Pencil, ShieldCheck, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatCurrency, toNumber } from "@/lib/money";
import { policyTypeLabel } from "@/lib/status";
import { DeleteInsurerButton } from "@/components/insurers/delete-insurer-button";

export default async function InsurerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const insurer = await db.insurer.findUnique({
    where: { id },
  });

  if (!insurer) {
    notFound();
  }

  const [policies, claims, commissions] = await Promise.all([
    db.policy.findMany({
      where: { insurerId: id },
      include: { client: true },
      orderBy: { createdAt: "desc" },
    }),
    db.claim.findMany({
      where: { insurerId: id },
      include: { client: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.commission.findMany({
      where: { insurerId: id },
      include: { policy: true, client: true },
      orderBy: { expectedDate: "desc" },
      take: 10,
    }),
  ]);

  const activePolicies = policies.filter((p) => p.status === "ACTIVE");
  const portfolioValue = activePolicies.reduce((sum, p) => sum + toNumber(p.premiumAmount), 0);
  const openClaims = claims.filter((c) => c.status !== "RESOLVED" && c.status !== "CANCELLED");
  const openCommissions = commissions.filter((c) => c.status !== "PAID" && c.status !== "CANCELLED");

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Catálogo"
          title={insurer.name}
          description="Detalle de aseguradora, cartera vinculada y métricas comerciales."
          actions={
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" className="rounded-full bg-white/70">
                <Link href={`/insurers/${id}/edit`}>
                  <Pencil className="mr-2 size-4" />
                  Editar
                </Link>
              </Button>
              <DeleteInsurerButton id={id} name={insurer.name} />
              <Button asChild variant="outline" className="rounded-full bg-white/70">
                <Link href="/insurers">
                  <ArrowLeft className="mr-2 size-4" />
                  Volver
                </Link>
              </Button>
            </div>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Estado"
            value={insurer.status === "ACTIVE" ? "Activa" : "Archivada"}
            description="Status comercial"
            icon={Building2}
            tone={insurer.status === "ACTIVE" ? "emerald" : "slate"}
          />
          <MetricCard
            title="Pólizas"
            value={policies.length}
            description={`${activePolicies.length} activas`}
            icon={ShieldCheck}
            tone="blue"
          />
          <MetricCard
            title="Valor cartera"
            value={formatCurrency(portfolioValue)}
            description="Primas activas"
            icon={TrendingUp}
            tone="emerald"
          />
          <MetricCard
            title="Siniestros"
            value={claims.length}
            description={`${openClaims.length} abiertos`}
            icon={FileText}
            tone="amber"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
          <SectionCard title="Ficha de aseguradora" description="Datos de contacto y operación.">
            <div className="grid gap-4 p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <StatusBadge status={insurer.status} />
                {insurer.portalUrl && (
                  <Badge variant="outline" className="rounded-full">
                    <a href={insurer.portalUrl} target="_blank" rel="noopener noreferrer">
                      Portal activo
                    </a>
                  </Badge>
                )}
              </div>

              <div className="rounded-2xl border bg-stone-50/70 p-4">
                <p className="font-medium text-foreground">Nombre comercial</p>
                <p className="mt-1">{insurer.name}</p>
              </div>

              <div className="grid gap-3">
                {insurer.contactName && (
                  <div>
                    <p className="text-muted-foreground">Contacto</p>
                    <p className="font-medium">{insurer.contactName}</p>
                  </div>
                )}
                {insurer.contactEmail && (
                  <div>
                    <p className="text-muted-foreground">Email</p>
                    <p className="font-medium">
                      <a href={`mailto:${insurer.contactEmail}`} className="hover:text-primary">
                        {insurer.contactEmail}
                      </a>
                    </p>
                  </div>
                )}
                {insurer.contactPhone && (
                  <div>
                    <p className="text-muted-foreground">Teléfono</p>
                    <p className="font-medium">{insurer.contactPhone}</p>
                  </div>
                )}
              </div>

              {insurer.notes && (
                <div className="rounded-2xl border bg-white/70 p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Notas</p>
                  <p className="mt-1">{insurer.notes}</p>
                </div>
              )}

              {insurer.portalUrl && (
                <Button asChild variant="outline" className="w-full rounded-full">
                  <a href={insurer.portalUrl} target="_blank" rel="noopener noreferrer">
                    Acceder al portal
                  </a>
                </Button>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Pólizas vinculadas" description="Cartera de contratos con esta aseguradora.">
            {policies.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                No hay pólizas registradas para esta aseguradora.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/70">
                    <TableHead>Póliza</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Prima</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {policies.slice(0, 10).map((policy) => (
                    <TableRow key={policy.id}>
                      <TableCell>
                        <Link
                          href={`/policies/${policy.id}`}
                          className="font-medium text-foreground hover:text-primary"
                        >
                          {policy.policyNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{policy.client.fullName}</TableCell>
                      <TableCell>{policyTypeLabel(policy.policyType)}</TableCell>
                      <TableCell>
                        <StatusBadge status={policy.status} />
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(policy.premiumAmount, policy.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {policies.length > 10 && (
              <div className="border-t border-stone-200/80 px-4 py-3 text-center">
                <Link href={`/policies?insurer=${id}`} className="text-sm text-primary hover:underline">
                  Ver todas las pólizas ({policies.length})
                </Link>
              </div>
            )}
          </SectionCard>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <SectionCard title="Siniestros" description="Registro de reclamaciones con esta aseguradora.">
            {claims.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                No hay siniestros registrados.
              </div>
            ) : (
              <div className="divide-y divide-stone-200/80">
                {claims.slice(0, 5).map((claim) => (
                  <div key={claim.id} className="px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <Link
                        href={`/claims/${claim.id}`}
                        className="font-medium text-foreground hover:text-primary"
                      >
                        {claim.folio}
                      </Link>
                      <StatusBadge status={claim.status} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {claim.client.fullName} · {formatDate(claim.incidentDate)}
                    </p>
                    {claim.amountClaimed && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Reclamado: {formatCurrency(claim.amountClaimed)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Comisiones" description="Ingresos esperados y cobrados.">
            {commissions.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                No hay comisiones registradas.
              </div>
            ) : (
              <div className="divide-y divide-stone-200/80">
                {commissions.slice(0, 5).map((commission) => (
                  <div key={commission.id} className="px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-foreground">
                        {formatCurrency(commission.expectedAmount)}
                      </p>
                      <StatusBadge status={commission.status} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {commission.client.fullName}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {commission.policy?.policyNumber}
                      {commission.expectedDate && ` · ${formatDate(commission.expectedDate)}`}
                    </p>
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
