import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BadgeCheck, CalendarClock, FileText, History, Pencil, ShieldCheck } from "@/components/icons";
import { DeleteClaimButton } from "@/components/claims/delete-claim-button";
import { PageHeader } from "@/components/layout/page-header";
import { NoraContextButton } from "@/components/assistant/nora-session-provider";
import { AuditByline } from "@/components/audit/audit-byline";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { ActivityTimeline } from "@/components/timeline/activity-timeline";
import { getActivityForEntity } from "@/lib/activity-log";
import { StatusBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { DocumentDropZone } from "@/components/documents/document-drop-zone";
import { DocumentList } from "@/components/documents/document-list";
import { getDb } from "@/lib/db";
import { daysSince, formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";
import { policyTypeLabel } from "@/lib/status";
import { claimOperationalWhere, requirePortfolioReadScope } from "@/lib/portfolio-access";

export default async function ClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await requirePortfolioReadScope();
  const claimScope = claimOperationalWhere(scope.portfolioOwnerId);
  const db = getDb();

  const claim = await db.claim.findFirst({
    where: { id, ...claimScope },
    include: {
      client: true,
      policy: { include: { insurer: true } },
      insurer: true,
      documents: { orderBy: { uploadedAt: "desc" } },
    },
  });

  if (!claim) {
    notFound();
  }

  const [relatedClaims, activity] = await Promise.all([
    db.claim.findMany({
      where: { ...claimScope, policyId: claim.policyId, id: { not: id } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    getActivityForEntity("Claim", id, 20),
  ]);

  const isClosed = claim.status === "RESOLVED" || claim.status === "CANCELLED";
  const daysOpen = daysSince(claim.reportedDate);

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Operación"
          title={`Siniestro ${claim.folio}`}
          description={`${claim.claimType} · ${claim.client.fullName}`}
          actions={
            <div className="flex items-center gap-2">
              <NoraContextButton context={{ type: "claim", id: claim.id }} />
              <Button asChild variant="outline" className="bg-card/70">
                <Link href={`/claims/${claim.id}/edit`}>
                  <Pencil className="mr-2 size-4" />
                  Editar
                </Link>
              </Button>
              <DeleteClaimButton id={claim.id} folio={claim.folio} />
              <Button asChild variant="outline" className="bg-card/70">
                <Link href="/operations?view=claims">
                  <ArrowLeft className="mr-2 size-4" />
                  Volver
                </Link>
              </Button>
            </div>
          }
        />

        <AuditByline createdById={claim.createdById} updatedById={claim.updatedById} />

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <MetricCard
            title="Estado"
            value={claim.status.replace(/_/g, " ")}
            description={isClosed ? "Siniestro cerrado" : `Abierto hace ${daysOpen} días`}
            icon={BadgeCheck}
            tone={isClosed ? "emerald" : "amber"}
          />
          <MetricCard
            title="Reclamado"
            value={claim.amountClaimed ? formatCurrency(claim.amountClaimed) : "Sin monto"}
            description="Monto demandado"
            icon={FileText}
            tone="blue"
          />
          <MetricCard
            title="Pagado"
            value={claim.amountPaid ? formatCurrency(claim.amountPaid) : "Sin pago"}
            description="Indemnización efectuada"
            icon={ShieldCheck}
            tone={claim.amountPaid ? "emerald" : "slate"}
          />
          <MetricCard
            title="Días desde incidente"
            value={daysSince(claim.incidentDate)}
            description={`Ocurrido el ${formatDate(claim.incidentDate)}`}
            icon={CalendarClock}
            tone="amber"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
          <SectionCard title="Ficha del siniestro" description="Datos del reclamo y vínculos operativos.">
            <div className="grid gap-4 p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <StatusBadge status={claim.status} />
                <span className="text-xs text-muted-foreground">Folio: {claim.folio}</span>
              </div>

              <div className="rounded-xl border bg-muted/40 p-4">
                <p className="font-medium text-foreground">Tipo de siniestro</p>
                <p className="mt-1">{claim.claimType}</p>
                {claim.description && (
                  <>
                    <p className="mt-3 font-medium text-foreground">Descripción</p>
                    <p className="mt-1 text-muted-foreground">{claim.description}</p>
                  </>
                )}
              </div>

              <div className="grid gap-3">
                <div>
                  <p className="text-muted-foreground">Cliente</p>
                  <Link href={`/clients/${claim.clientId}`} className="font-medium text-foreground hover:text-primary">
                    {claim.client.fullName}
                  </Link>
                </div>
                <div>
                  <p className="text-muted-foreground">Póliza</p>
                  <Link href={`/policies/${claim.policyId}`} className="font-medium text-foreground hover:text-primary">
                    {claim.policy.policyNumber}
                  </Link>
                  <p className="mt-1 text-xs text-muted-foreground">{policyTypeLabel(claim.policy.policyType)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Aseguradora</p>
                  <Link href={`/insurers/${claim.insurerId}`} className="font-medium text-foreground hover:text-primary">
                    {claim.insurer.name}
                  </Link>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground">Fecha del incidente</p>
                  <p className="font-medium">{formatDate(claim.incidentDate)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Fecha de reporte</p>
                  <p className="font-medium">{formatDate(claim.reportedDate)}</p>
                </div>
                {claim.closedDate && (
                  <div>
                    <p className="text-muted-foreground">Fecha de cierre</p>
                    <p className="font-medium">{formatDate(claim.closedDate)}</p>
                  </div>
                )}
              </div>

              {claim.notes && (
                <div className="rounded-xl border bg-card/70 p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Notas internas</p>
                  <p className="mt-1">{claim.notes}</p>
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Documentos" description="Evidencia y archivos del siniestro.">
            <div className="space-y-4 p-4">
              <DocumentDropZone
                associations={{ claimId: claim.id, clientId: claim.clientId, policyId: claim.policyId }}
                defaultDocumentType="CLAIM"
              />
              <DocumentList
                documents={claim.documents.map((d) => ({
                  id: d.id,
                  fileName: d.fileName,
                  documentType: d.documentType,
                  mimeType: d.mimeType,
                  uploadedAt: d.uploadedAt,
                }))}
                emptyTitle="Sin documentos del siniestro"
                emptyDescription="Sube fotos, oficios o evidencia desde aquí."
              />
            </div>
          </SectionCard>
        </section>

        {relatedClaims.length > 0 && (
          <SectionCard title="Otros siniestros de la póliza" description="Historial relacionado.">
            <div className="divide-y divide-stone-200/80">
              {relatedClaims.map((related) => (
                <div key={related.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <Link href={`/claims/${related.id}`} className="font-medium text-foreground hover:text-primary">
                      {related.folio}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {related.claimType} · {formatDate(related.incidentDate)}
                    </p>
                  </div>
                  <StatusBadge status={related.status} />
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        <SectionCard
          title="Actividad"
          description="Cambios y eventos recientes registrados para este siniestro."
          action={
            <Link
              href={`/activity?entity=Claim&id=${id}`}
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
                Sin actividad registrada para este siniestro todavía.
              </div>
            </div>
          ) : (
            <ActivityTimeline entries={activity} />
          )}
        </SectionCard>
      </div>
    </div>
  );
}
