import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BadgeCheck, CalendarClock, Clock, FileText, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { daysSince, formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";
import { policyTypeLabel } from "@/lib/status";

export default async function ClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const claim = await db.claim.findUnique({
    where: { id },
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

  const relatedClaims = await db.claim.findMany({
    where: { policyId: claim.policyId, id: { not: id } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const isClosed = claim.status === "RESOLVED" || claim.status === "CANCELLED";
  const daysOpen = daysSince(claim.reportedDate);

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Operación"
          title={`Siniestro ${claim.folio}`}
          description={`${claim.claimType} · ${claim.client.fullName}`}
          actions={
            <Button asChild variant="outline" className="rounded-full bg-white/70">
              <Link href="/claims">
                <ArrowLeft className="mr-2 size-4" />
                Volver
              </Link>
            </Button>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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

              <div className="rounded-2xl border bg-stone-50/70 p-4">
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
                <div className="rounded-2xl border bg-white/70 p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Notas internas</p>
                  <p className="mt-1">{claim.notes}</p>
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Documentos" description="Evidencia y archivos del siniestro.">
            {claim.documents.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                No hay documentos asociados a este siniestro.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/70">
                    <TableHead>Archivo</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {claim.documents.map((document) => (
                    <TableRow key={document.id}>
                      <TableCell className="font-medium">{document.fileName}</TableCell>
                      <TableCell>{document.documentType}</TableCell>
                      <TableCell>{formatDate(document.uploadedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
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
      </div>
    </main>
  );
}
