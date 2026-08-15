import Link from "next/link";
import { ArrowRight, FileDigit, FolderOpen, Link2, ShieldAlert, Download } from "@/components/icons";
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
import { formatDate } from "@/lib/dates";
import { UploadForm } from "@/components/documents/upload-form";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";
import { areDocumentFilesEnabled } from "@/lib/deployment";
import { documentOperationalWhere, requireOrganizationPortfolioReadScope } from "@/lib/portfolio-access";

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

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string }>;
}) {
  const scope = await requireOrganizationPortfolioReadScope();
  const db = getDb();
  const documentsEnabled = areDocumentFilesEnabled();
  const params = (await searchParams) ?? {};
  const query = (params.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number(params.page) || 1);
  const scopedWhere = documentOperationalWhere(scope.portfolioOwnerId, scope.organizationId);

  const where: Prisma.DocumentWhereInput = query
    ? {
        AND: [
          scopedWhere,
          {
            OR: [
              { fileName: { contains: query } },
              { client: { fullName: { contains: query } } },
              { policy: { policyNumber: { contains: query } } },
              { receipt: { receiptNumber: { contains: query } } },
            ],
          },
        ],
      }
    : scopedWhere;

  const [totalCount, filteredCount, pagedDocuments, totalDocs, orphanCount, paymentProofsCount, policyDocs] =
    await Promise.all([
      db.document.count({ where: scopedWhere }),
      db.document.count({ where }),
      db.document.findMany({
        where,
        include: { client: true, policy: true, receipt: true, task: true, claim: true, quote: true },
        orderBy: { uploadedAt: "desc" },
        skip: (page - 1) * DEFAULT_PAGE_SIZE,
        take: DEFAULT_PAGE_SIZE,
      }),
      db.document.count({ where: scopedWhere }),
      db.document.count({
        where: {
          ...scopedWhere,
          AND: [
            { clientId: null },
            { policyId: null },
            { receiptId: null },
            { taskId: null },
            { claimId: null },
            { quoteId: null },
          ],
        },
      }),
      db.document.count({ where: { ...scopedWhere, documentType: "PAYMENT_PROOF" } }),
      db.document.findMany({
        where: { ...scopedWhere, policyId: { not: null } },
        include: { policy: true },
        orderBy: { uploadedAt: "desc" },
        take: 10,
      }),
    ]);

  const linkedDocuments = totalDocs - orphanCount;

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          eyebrow="Archivo"
          title="Documentos"
          description="Control de documentos, asociaciones y huecos de expediente."
          actions={
            <Button asChild>
              <Link href="/risks">
                Riesgos
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          }
        />

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <MetricCard
            title="Documentos"
            value={totalCount}
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
            title="Huérfanos"
            value={orphanCount}
            description="Sin vínculo a cliente, póliza o trámite."
            icon={ShieldAlert}
            tone="rose"
          />
          <MetricCard
            title="Comprobantes"
            value={paymentProofsCount}
            description="Comprobantes de pago y soporte financiero."
            icon={FileDigit}
            tone="amber"
          />
        </section>

        <SectionCard
          title="Documentos"
          description="Listado paginado con búsqueda por archivo, tipo, cliente o póliza."
          action={<ListSearch placeholder="Buscar por archivo, tipo, cliente o póliza..." />}
        >
          {filteredCount === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={FolderOpen}
                title={query ? "Sin resultados" : "Sin documentos"}
                description={
                  query
                    ? `No encontramos documentos que coincidan con "${query}".`
                    : "Sube tu primer archivo en la sección de carga al final de la página."
                }
              />
            </div>
          ) : pagedDocuments.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={FolderOpen}
                title="Página fuera de rango"
                description="Vuelve al inicio del listado."
                action={{ label: "Volver al inicio", href: query ? `/documents?q=${encodeURIComponent(query)}` : "/documents" }}
              />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Archivo</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Cliente / Póliza</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedDocuments.map((document) => (
                    <TableRow key={document.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <span>{document.fileName}</span>
                          {documentsEnabled ? (
                            <Button asChild variant="ghost" size="sm" className="h-6 w-6 p-0">
                              <Link
                                href={`/api/documents/${document.id}/download`}
                                target="_blank"
                                aria-label={`Descargar ${document.fileName}`}
                              >
                                <Download className="size-3" />
                              </Link>
                            </Button>
                          ) : null}
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
                        <StatusBadge
                          status={
                            document.policyId ||
                            document.receiptId ||
                            document.taskId ||
                            document.claimId ||
                            document.quoteId
                              ? "ACTIVE"
                              : "ARCHIVED"
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                page={page}
                pageSize={DEFAULT_PAGE_SIZE}
                total={filteredCount}
                basePath="/documents"
                searchParams={{ q: query }}
              />
            </>
          )}
        </SectionCard>

        <SectionCard title="Documentos por póliza" description="Archivos que ya cuelgan del expediente de póliza.">
          {policyDocs.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={Link2}
                title="Sin documentos por póliza"
                description="Cuando asocies archivos a pólizas aparecerán aquí."
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Archivo</TableHead>
                  <TableHead>Póliza</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policyDocs.map((document) => (
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
          )}
        </SectionCard>

        <SectionCard title="Subir documento" description="Agrega nuevos archivos al sistema.">
          {documentsEnabled ? (
            <UploadForm />
          ) : (
            <div className="rounded-xl border border-dashed bg-muted/30 p-6 text-sm text-muted-foreground">
              La carga de archivos está deshabilitada en la demo publicada. Esta sección queda como metadata del expediente.
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
