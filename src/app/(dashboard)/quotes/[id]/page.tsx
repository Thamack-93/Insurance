import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BadgeCheck, Calculator, CalendarClock, FileText, Pencil } from "lucide-react";
import { DeleteQuoteButton } from "@/components/quotes/delete-quote-button";
import { PageHeader } from "@/components/layout/page-header";
import { AuditByline } from "@/components/audit/audit-byline";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { daysSince, formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/money";
import { policyTypeLabel } from "@/lib/status";
import { quoteOperationalWhere, requirePortfolioReadScope } from "@/lib/portfolio-access";

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await requirePortfolioReadScope();
  const quoteScope = quoteOperationalWhere(scope.portfolioOwnerId);
  const db = getDb();

  const quote = await db.quote.findFirst({
    where: { id, ...quoteScope },
    include: {
      client: true,
      insurer: true,
      documents: { orderBy: { uploadedAt: "desc" } },
    },
  });

  if (!quote) {
    notFound();
  }

  const relatedQuotes = await db.quote.findMany({
    where: { ...quoteScope, clientId: quote.clientId, id: { not: id } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const isExpired = quote.status === "EXPIRED" || quote.status === "CANCELLED" || quote.status === "REJECTED";
  const isAccepted = quote.status === "ACCEPTED";
  const daysOld = daysSince(quote.createdAt);

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Comercial"
          title={`Cotización ${quote.id.slice(0, 8)}`}
          description={`${quote.policyType} · ${quote.client.fullName}`}
          actions={
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" className="rounded-full bg-card/70">
                <Link href={`/quotes/${quote.id}/edit`}>
                  <Pencil className="mr-2 size-4" />
                  Editar
                </Link>
              </Button>
              <DeleteQuoteButton id={quote.id} label={quote.id.slice(0, 8)} />
              <Button asChild variant="outline" className="rounded-full bg-card/70">
                <Link href="/quotes">
                  <ArrowLeft className="mr-2 size-4" />
                  Volver
                </Link>
              </Button>
            </div>
          }
        />

        <AuditByline createdById={quote.createdById} updatedById={quote.updatedById} />

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <MetricCard
            title="Estado"
            value={quote.status.replace(/_/g, " ")}
            description={isExpired ? "Cotización cerrada" : isAccepted ? "Convertida a póliza" : `Activa hace ${daysOld} días`}
            icon={BadgeCheck}
            tone={isExpired ? "rose" : isAccepted ? "emerald" : "amber"}
          />
          <MetricCard
            title="Monto cotizado"
            value={quote.quotedAmount ? formatCurrency(quote.quotedAmount) : "Sin monto"}
            description="Prima propuesta"
            icon={Calculator}
            tone="blue"
          />
          <MetricCard
            title="Tipo de póliza"
            value={policyTypeLabel(quote.policyType)}
            description="Producto cotizado"
            icon={FileText}
            tone="amber"
          />
          <MetricCard
            title="Válida hasta"
            value={quote.validUntil ? formatDate(quote.validUntil) : "Sin fecha"}
            description={quote.validUntil && quote.validUntil < new Date() ? "Vencida" : "En vigor"}
            icon={CalendarClock}
            tone={quote.validUntil && quote.validUntil < new Date() ? "rose" : "emerald"}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
          <SectionCard title="Ficha de cotización" description="Datos de la propuesta y vínculos operativos.">
            <div className="grid gap-4 p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <StatusBadge status={quote.status} />
                <span className="text-xs text-muted-foreground">ID: {quote.id.slice(0, 8)}</span>
              </div>

              <div className="rounded-2xl border bg-muted/40 p-4">
                <p className="font-medium text-foreground">Tipo de póliza</p>
                <p className="mt-1">{policyTypeLabel(quote.policyType)}</p>
                {quote.notes && (
                  <>
                    <p className="mt-3 font-medium text-foreground">Notas</p>
                    <p className="mt-1 text-muted-foreground">{quote.notes}</p>
                  </>
                )}
              </div>

              <div className="grid gap-3">
                <div>
                  <p className="text-muted-foreground">Cliente</p>
                  <Link href={`/clients/${quote.clientId}`} className="font-medium text-foreground hover:text-primary">
                    {quote.client.fullName}
                  </Link>
                </div>
                {quote.insurer && (
                  <div>
                    <p className="text-muted-foreground">Aseguradora</p>
                    <Link href={`/insurers/${quote.insurerId}`} className="font-medium text-foreground hover:text-primary">
                      {quote.insurer.name}
                    </Link>
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground">Fecha de solicitud</p>
                  <p className="font-medium">{formatDate(quote.requestedDate)}</p>
                </div>
                {quote.sentDate && (
                  <div>
                    <p className="text-muted-foreground">Fecha de envío</p>
                    <p className="font-medium">{formatDate(quote.sentDate)}</p>
                  </div>
                )}
                {quote.validUntil && (
                  <div>
                    <p className="text-muted-foreground">Válida hasta</p>
                    <p className={`font-medium ${quote.validUntil < new Date() ? "text-rose-600" : ""}`}>
                      {formatDate(quote.validUntil)}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Documentos" description="Archivos adjuntos a la cotización.">
            {quote.documents.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                No hay documentos asociados a esta cotización.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Archivo</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quote.documents.map((document) => (
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

        {relatedQuotes.length > 0 && (
          <SectionCard title="Otras cotizaciones del cliente" description="Historial de propuestas.">
            <div className="divide-y divide-stone-200/80">
              {relatedQuotes.map((related) => (
                <div key={related.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <Link href={`/quotes/${related.id}`} className="font-medium text-foreground hover:text-primary">
                      {related.id.slice(0, 8)}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {policyTypeLabel(related.policyType)} · {formatDate(related.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {related.quotedAmount && (
                      <span className="text-sm text-muted-foreground">
                        {formatCurrency(related.quotedAmount)}
                      </span>
                    )}
                    <StatusBadge status={related.status} />
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}
      </div>
    </div>
  );
}
