import Link from "next/link";
import { ArrowRight, FileDigit, FolderOpen, Link2, ShieldAlert, Download } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MetricCard, SectionCard } from "@/components/pages-secondary/panels";
import { StatusBadge } from "@/components/badges/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { UploadForm } from "@/components/documents/upload-form";

function associationLabel(document: {
  policy?: { policyNumber: string } | null;
  receipt?: { receiptNumber: string } | null;
  task?: { folio: string } | null;
  claim?: { folio: string } | null;
  quote?: { id: string } | null;
}) {
  return (
    document.policy?.policyNumber ??
    document.receipt?.receiptNumber ??
    document.task?.folio ??
    document.claim?.folio ??
    document.quote?.id ??
    "Sin asociación"
  );
}

export default async function DocumentsPage() {
  const db = getDb();

  const documents = await db.document.findMany({
    include: { client: true, policy: true, receipt: true, task: true, claim: true, quote: true },
    orderBy: { uploadedAt: "desc" },
  });

  const orphanDocuments = documents.filter(
    (document) =>
      !document.clientId &&
      !document.policyId &&
      !document.receiptId &&
      !document.taskId &&
      !document.claimId &&
      !document.quoteId,
  );
  const paymentProofs = documents.filter((document) => document.documentType === "PAYMENT_PROOF");
  const policyDocs = documents.filter((document) => document.policyId);
  const linkedDocuments = documents.length - orphanDocuments.length;

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-50 via-white to-stone-50/70 px-4 py-6 md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Archivo"
          title="Documents"
          description="Control de documentos locales, asociaciones y huecos de expediente."
          actions={
            <Button asChild className="rounded-full">
              <Link href="/risks">
                Riesgos
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          }
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Documentos"
            value={documents.length}
            description="Total de archivos indexados."
            icon={FolderOpen}
            tone="blue"
          />
          <MetricCard
            title="Vinculados"
            value={linkedDocuments}
            description="Con al menos una relación viva."
            icon={Link2}
            tone="emerald"
          />
          <MetricCard
            title="Huerfanos"
            value={orphanDocuments.length}
            description="Sin vínculo a cliente, póliza o trámite."
            icon={ShieldAlert}
            tone="rose"
          />
          <MetricCard
            title="Comprobantes"
            value={paymentProofs.length}
            description="Comprobantes de pago y soporte financiero."
            icon={FileDigit}
            tone="amber"
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <SectionCard title="Documentos recientes" description="Últimas cargas del archivo local.">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/70">
                  <TableHead>Archivo</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Cliente / Póliza</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.slice(0, 10).map((document) => (
                  <TableRow key={document.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span>{document.fileName}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => window.open(`/api/documents/${document.id}/download`, '_blank')}
                          className="h-6 w-6 p-0"
                        >
                          <Download className="size-3" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>{document.documentType}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{document.client?.fullName ?? "Sin cliente"}</span>
                        <span className="text-xs text-muted-foreground">{associationLabel(document)}</span>
                      </div>
                    </TableCell>
                    <TableCell>{formatDate(document.uploadedAt)}</TableCell>
                    <TableCell>
                      <StatusBadge status={document.policyId || document.receiptId || document.taskId || document.claimId || document.quoteId ? "ACTIVE" : "ARCHIVED"} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </SectionCard>

          <SectionCard title="Huerfanos" description="Archivos que conviene asociar para no perder contexto.">
            <div className="divide-y divide-stone-200/80">
              {orphanDocuments.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">No hay documentos huérfanos en este momento.</div>
              ) : (
                orphanDocuments.slice(0, 10).map((document) => (
                  <div key={document.id} className="px-4 py-4">
                    <p className="font-medium text-foreground">{document.fileName}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{document.mimeType} · {formatDate(document.uploadedAt)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{document.notes ?? "Sin notas"}</p>
                  </div>
                ))
              )}
            </div>
          </SectionCard>
        </section>

        <SectionCard title="Documentos por póliza" description="Archivos que ya cuelgan del expediente de póliza.">
          <Table>
            <TableHeader>
              <TableRow className="bg-stone-50/70">
                <TableHead>Archivo</TableHead>
                <TableHead>Póliza</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Fecha</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {policyDocs.slice(0, 10).map((document) => (
                <TableRow key={document.id}>
                  <TableCell className="font-medium">{document.fileName}</TableCell>
                  <TableCell>
                    {document.policy ? (
                      <Link href={`/policies/${document.policyId}`} className="text-foreground hover:text-primary">
                        {document.policy.policyNumber}
                      </Link>
                    ) : (
                      "Sin póliza"
                    )}
                  </TableCell>
                  <TableCell>{document.documentType}</TableCell>
                  <TableCell>{formatDate(document.uploadedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>

        <SectionCard title="Subir Documento" description="Agrega nuevos archivos al sistema.">
          <UploadForm 
            onSuccess={(document) => {
              // Refresh the page to show the new document
              window.location.reload();
            }}
            onError={(error) => {
              console.error('Upload failed:', error);
            }}
          />
        </SectionCard>
      </div>
    </main>
  );
}
