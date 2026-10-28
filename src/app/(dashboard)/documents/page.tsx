import Link from "next/link";
import { ArrowRight, FileDigit, FolderOpen, Link2, ShieldAlert, Download } from "@/components/icons";
import type { Prisma } from "@/generated/prisma/client";
import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/pages-secondary/panels";
import { Badge } from "@/components/ui/badge";
import { documentTypeLabel } from "@/lib/ui-labels";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-states/empty-state";
import { ListSearch } from "@/components/lists/list-search";
import { Pagination } from "@/components/lists/pagination";
import { formatDate } from "@/lib/dates";
import { UploadForm } from "@/components/documents/upload-form";
import { DocumentInbox, type DocumentInboxOptions } from "@/components/documents/document-inbox";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";
import { areDocumentFilesEnabled } from "@/lib/deployment";
import {
  claimOperationalWhere,
  documentOperationalWhere,
  endorsementOperationalWhere,
  policyOperationalWhere,
  receiptOperationalWhere,
  requireOrganizationPortfolioReadScope,
} from "@/lib/portfolio-access";
import { withTenantOrganization } from "@/lib/tenant-dal";
import { resolveOrganizationCapability } from "@/lib/organization-capabilities";
import { getDocumentSituation } from "@/lib/document-situation";

function associationLabel(document: {
  policy?: { policyNumber: string } | null;
  receipt?: { receiptNumber: string } | null;
  task?: { folio: string } | null;
  claim?: { folio: string } | null;
}) {
  return (
    document.policy?.policyNumber ??
    document.receipt?.receiptNumber ??
    document.task?.folio ??
    document.claim?.folio ??
    "Sin asociación"
  );
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string }>;
}) {
  const scope = await requireOrganizationPortfolioReadScope();
  return withTenantOrganization(scope.organizationId, async (db) => {
  const [organizationRecord, documentCapability] = await Promise.all([
    db.organization.findUnique({ where: { id: scope.organizationId }, select: { kind: true } }),
    resolveOrganizationCapability(scope.organizationId, "DOCUMENTS", db),
  ]);
  const documentsEnabled = areDocumentFilesEnabled() && documentCapability.enabled && organizationRecord?.kind !== "DEMO";
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

  const inboxDocumentInclude = { client: true, policy: true, endorsement: true, receipt: true, task: true, claim: true } as const;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalCount,
    filteredCount,
    pagedDocuments,
    totalDocs,
    orphanCount,
    paymentProofsCount,
    policyDocs,
    pendingInboxDocuments,
    recentInboxDocuments,
    inboxOptions,
  ] =
    await Promise.all([
      db.document.count({ where: scopedWhere }),
      db.document.count({ where }),
      db.document.findMany({
        where,
        include: { client: true, policy: true, endorsement: true, receipt: true, task: true, claim: true },
        orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
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
            { endorsementId: null },
            { receiptId: null },
            { taskId: null },
            { claimId: null },
          ],
        },
      }),
      db.document.count({ where: { ...scopedWhere, documentType: "PAYMENT_PROOF" } }),
      db.document.findMany({
        where: { ...scopedWhere, policyId: { not: null } },
        include: { policy: true },
        orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
        take: 10,
      }),
      db.document.findMany({
        where: {
          AND: [
            scopedWhere,
            { mimeType: "application/pdf" },
            { clientId: null, policyId: null, endorsementId: null, receiptId: null, taskId: null, claimId: null },
          ],
        },
        include: inboxDocumentInclude,
        orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
        take: 25,
      }),
      db.document.findMany({
        where: {
          AND: [
            scopedWhere,
            { mimeType: "application/pdf" },
            { uploadedAt: { gte: sevenDaysAgo } },
            { OR: [
              { clientId: { not: null } }, { policyId: { not: null } }, { endorsementId: { not: null } },
              { receiptId: { not: null } }, { taskId: { not: null } }, { claimId: { not: null } },
            ] },
          ],
        },
        include: inboxDocumentInclude,
        orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
        take: 10,
      }),
      Promise.all([
        db.client.findMany({ where: { organizationId: scope.organizationId, ...(scope.portfolioOwnerId ? { portfolioOwnerId: scope.portfolioOwnerId } : {}) }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" }, take: 250 }),
        db.policy.findMany({ where: policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId), select: { id: true, policyNumber: true, client: { select: { fullName: true } } }, orderBy: { policyNumber: "asc" }, take: 250 }),
        db.policyEndorsement.findMany({ where: endorsementOperationalWhere(scope.portfolioOwnerId, scope.organizationId), select: { id: true, endorsementNumber: true, policy: { select: { policyNumber: true, client: { select: { fullName: true } } } } }, orderBy: { endorsementNumber: "asc" }, take: 250 }),
        db.receipt.findMany({ where: receiptOperationalWhere(scope.portfolioOwnerId, scope.organizationId), select: { id: true, receiptNumber: true, client: { select: { fullName: true } } }, orderBy: { receiptNumber: "asc" }, take: 250 }),
        db.task.findMany({
          where: {
            organizationId: scope.organizationId,
            ...(scope.portfolioOwnerId ? { OR: [{ client: { portfolioOwnerId: scope.portfolioOwnerId } }, { clientId: null, createdById: scope.portfolioOwnerId }] } : {}),
          },
          select: { id: true, folio: true, title: true },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          take: 250,
        }),
        db.claim.findMany({ where: claimOperationalWhere(scope.portfolioOwnerId, scope.organizationId), select: { id: true, folio: true, client: { select: { fullName: true } } }, orderBy: { createdAt: "desc" }, take: 250 }),
      ]),
    ]);

  const [inboxClients, inboxPolicies, inboxEndorsements, inboxReceipts, inboxTasks, inboxClaims] = inboxOptions;
  const documentInboxOptions: DocumentInboxOptions = {
    clients: inboxClients.map((client) => ({ id: client.id, label: client.fullName })),
    policies: inboxPolicies.map((policy) => ({ id: policy.id, label: `${policy.policyNumber} · ${policy.client.fullName}` })),
    endorsements: inboxEndorsements.map((endorsement) => ({ id: endorsement.id, label: `${endorsement.endorsementNumber} · ${endorsement.policy.policyNumber} · ${endorsement.policy.client.fullName}` })),
    receipts: inboxReceipts.map((receipt) => ({ id: receipt.id, label: `${receipt.receiptNumber} · ${receipt.client.fullName}` })),
    tasks: inboxTasks.map((task) => ({ id: task.id, label: `${task.folio} · ${task.title}` })),
    claims: inboxClaims.map((claim) => ({ id: claim.id, label: `${claim.folio} · ${claim.client.fullName}` })),
  };

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

        <section aria-label="Resumen de documentos" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "PDFs por revisar", value: `${pendingInboxDocuments.length}${pendingInboxDocuments.length === 25 ? "+" : ""}`, icon: ShieldAlert, tone: "text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/30" },
            { label: "Documentos", value: totalCount, icon: FolderOpen, tone: "text-sky-700 bg-sky-50 dark:text-sky-300 dark:bg-sky-950/30" },
            { label: "Vinculados", value: linkedDocuments, icon: Link2, tone: "text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/30" },
            { label: "Comprobantes", value: paymentProofsCount, icon: FileDigit, tone: "text-violet-700 bg-violet-50 dark:text-violet-300 dark:bg-violet-950/30" },
          ].map(({ label, value, icon: Icon, tone }) => (
            <div key={label} className="flex min-w-0 items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5">
              <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${tone}`}><Icon className="size-4" aria-hidden="true" /></span>
              <span className="min-w-0"><span className="block truncate text-xs text-muted-foreground">{label}</span><span className="block text-lg font-semibold tabular-nums">{value}</span></span>
            </div>
          ))}
        </section>

        <SectionCard title="Bandeja de documentos" description="Revisa PDFs recientes y confirma manualmente su clasificación y expediente.">
          <div className="p-4">
            <DocumentInbox
              pendingDocuments={pendingInboxDocuments}
              recentDocuments={recentInboxDocuments}
              options={documentInboxOptions}
              enabled={documentsEnabled}
            />
          </div>
        </SectionCard>

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
                    <TableHead>Situación</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedDocuments.map((document) => (
                    <TableRow key={document.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <span>{document.fileName}</span>
                          {documentsEnabled || document.filePath.startsWith(`demo://${scope.organizationId}/`) ? (
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
                      <TableCell>{documentTypeLabel(document.documentType)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{document.client?.fullName ?? "Sin cliente"}</span>
                          <span className="text-xs text-muted-foreground">{associationLabel(document)}</span>
                        </div>
                      </TableCell>
                      <TableCell>{formatDate(document.uploadedAt)}</TableCell>
                      <TableCell>
                        {(() => {
                          const situation = getDocumentSituation(document);
                          return <Badge variant="outline" className={situation.className}>{situation.label}</Badge>;
                        })()}
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
                    <TableCell>{documentTypeLabel(document.documentType)}</TableCell>
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
  });
}
