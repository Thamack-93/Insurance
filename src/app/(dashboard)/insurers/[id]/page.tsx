import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, FileText, History, Pencil, ShieldCheck, TrendingUp } from "@/components/icons";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { ActivityTimeline } from "@/components/timeline/activity-timeline";
import { getActivityForEntity } from "@/lib/activity-log";
import { StatusBadge } from "@/components/badges/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { withTenantOrganization } from "@/lib/tenant-dal";
import { formatDate } from "@/lib/dates";
import { formatCurrency, toNumber } from "@/lib/money";
import { policyTypeLabel } from "@/lib/status";
import { DeleteInsurerButton } from "@/components/insurers/delete-insurer-button";
import { PolicyIdentity } from "@/components/policies/policy-identity";
import { requireOrganizationRoleOrRedirect } from "@/lib/organization-context";
import {
  claimOperationalWhere,
  commissionOperationalWhere,
  policyOperationalWhere,
} from "@/lib/portfolio-access";

export default async function InsurerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireOrganizationRoleOrRedirect(["OWNER", "ADMIN"]);
  const { id } = await params;
  return withTenantOrganization(context.organizationId, async (db) => {
  const insurer = await db.insurer.findFirst({
    where: { id, organizationId: context.organizationId },
  });

  if (!insurer) {
    notFound();
  }

  const [policies, claims, commissions, activity] = await Promise.all([
    db.policy.findMany({
      where: { insurerId: id, ...policyOperationalWhere(undefined, context.organizationId) },
      include: {
        client: true,
        insuredAssets: { select: { description: true, isPrimary: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    db.claim.findMany({
      where: { insurerId: id, ...claimOperationalWhere(undefined, context.organizationId) },
      include: { client: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10,
    }),
    db.commission.findMany({
      where: { insurerId: id, ...commissionOperationalWhere(undefined, context.organizationId) },
      include: { policy: true, client: true },
      orderBy: [{ expectedDate: "desc" }, { id: "desc" }],
      take: 10,
    }),
    getActivityForEntity("Insurer", id, 20, context.organizationId, db),
  ]);

  const activePolicies = policies.filter((p) => p.status === "ACTIVE");
  const portfolioValue = activePolicies.reduce((sum, p) => sum + toNumber(p.premiumAmount), 0);
  const openClaims = claims.filter((c) => c.status !== "RESOLVED" && c.status !== "CANCELLED");

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Catálogo"
          title={insurer.name}
          description="Detalle de aseguradora, cartera vinculada y métricas comerciales."
          actions={
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" className="rounded-full bg-card/70">
                <Link href={`/insurers/${id}/edit`}>
                  <Pencil className="mr-2 size-4" />
                  Editar
                </Link>
              </Button>
              <DeleteInsurerButton id={id} name={insurer.name} />
              <Button asChild variant="outline" className="rounded-full bg-card/70">
                <Link href="/insurers">
                  <ArrowLeft className="mr-2 size-4" />
                  Volver
                </Link>
              </Button>
            </div>
          }
        />

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
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
                <StatusBadge status={insurer.status} entity="insurer" />
                {insurer.portalUrl && (
                  <Badge variant="outline" className="rounded-full">
                    <a href={insurer.portalUrl} target="_blank" rel="noopener noreferrer">
                      Portal activo
                    </a>
                  </Badge>
                )}
              </div>

              <SectionCard title="Nombre comercial">
                <p className="px-4 py-3 text-sm">{insurer.name}</p>
              </SectionCard>

              <div className="grid gap-3">
                {insurer.contactName && (
                  <div>
                    <p className="text-muted-foreground">Contacto</p>
                    <p className="font-medium">{insurer.contactName}</p>
                  </div>
                )}
                {insurer.contactEmail && (
                  <div>
                    <p className="text-muted-foreground">Correo</p>
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
                <SectionCard title="Notas">
                  <p className="px-4 py-3 text-sm text-muted-foreground">{insurer.notes}</p>
                </SectionCard>
              )}

              {insurer.portalUrl && (
                <Button asChild variant="outline" className="w-full">
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
                  <TableRow className="bg-muted/40">
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
                          <PolicyIdentity policyNumber={policy.policyNumber} policy={policy} />
                        </Link>
                      </TableCell>
                      <TableCell>{policy.client.fullName}</TableCell>
                      <TableCell>{policyTypeLabel(policy.policyType)}</TableCell>
                      <TableCell>
                        <StatusBadge status={policy.status} entity="policy" />
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
              <div className="border-t border-border/70 px-4 py-3 text-center">
                <Link href={`/policies?insurer=${id}`} className="text-sm text-primary hover:underline">
                  Ver todas las pólizas ({policies.length})
                </Link>
              </div>
            )}
          </SectionCard>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <SectionCard title="Siniestros" description="Últimos 5 casos; el enlace abre todos los siniestros de esta aseguradora." action={<Link href={`/operations?view=claims&q=${encodeURIComponent(insurer.name)}`} className="text-sm font-medium text-primary hover:underline">Ver todos</Link>}>
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
                      <StatusBadge status={claim.status} entity="claim" />
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

          <SectionCard title="Comisiones" description="Últimas 5 comisiones abiertas; el enlace abre la cola completa de comisiones abiertas." action={<Link href={`/commissions?q=${encodeURIComponent(insurer.name)}`} className="text-sm font-medium text-primary hover:underline">Ver abiertas</Link>}>
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
                      <StatusBadge status={commission.status} entity="commission" />
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

        <SectionCard
          title="Actividad"
          description="Cambios y eventos recientes registrados para esta aseguradora."
          action={
            <Link
              href={`/activity?entity=Insurer&id=${id}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              Ver todo el historial
            </Link>
          }
        >
          {activity.length === 0 ? (
            <div className="p-4">
              <div className="rounded-xl border border-dashed border-border bg-muted/40 px-6 py-8 text-center text-sm text-muted-foreground">
                <History className="mx-auto mb-2 size-5 text-muted-foreground" />
                Sin actividad registrada para esta aseguradora todavía.
              </div>
            </div>
          ) : (
            <ActivityTimeline entries={activity} />
          )}
        </SectionCard>
      </div>
    </div>
  );
});
}
