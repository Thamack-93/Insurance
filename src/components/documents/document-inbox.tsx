"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Download, FileText, FolderOpen, Link2, ChevronDown, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/empty-states/empty-state";
import { DocumentPreviewDialog } from "@/components/documents/document-preview-dialog";
import { documentTypeOptions } from "@/lib/domain-options";
import { documentTypeLabel } from "@/lib/ui-labels";
import { formatDate } from "@/lib/dates";
import { associateInboxDocument, type DocumentInboxActionState } from "@/app/(dashboard)/documents/actions";

export type DocumentInboxOption = {
  id: string;
  label: string;
};

export type DocumentInboxOptions = {
  clients: DocumentInboxOption[];
  policies: DocumentInboxOption[];
  endorsements: DocumentInboxOption[];
  receipts: DocumentInboxOption[];
  tasks: DocumentInboxOption[];
  claims: DocumentInboxOption[];
};

export type DocumentInboxItem = {
  id: string;
  fileName: string;
  documentType: string;
  mimeType: string;
  uploadedAt: Date;
  filePath: string;
  clientId: string | null;
  policyId: string | null;
  endorsementId: string | null;
  receiptId: string | null;
  taskId: string | null;
  claimId: string | null;
  client: { fullName: string } | null;
  policy: { policyNumber: string } | null;
  endorsement: { endorsementNumber: string } | null;
  receipt: { receiptNumber: string } | null;
  task: { folio: string; title: string } | null;
  claim: { folio: string } | null;
};

const associations = [
  ["CLIENT", "Cliente"],
  ["POLICY", "Póliza"],
  ["ENDORSEMENT", "Endoso"],
  ["RECEIPT", "Recibo"],
  ["TASK", "Trámite"],
  ["CLAIM", "Siniestro"],
] as const;

function associationOptions(options: DocumentInboxOptions) {
  const optionKey: Record<(typeof associations)[number][0], keyof DocumentInboxOptions> = {
    CLIENT: "clients",
    POLICY: "policies",
    ENDORSEMENT: "endorsements",
    RECEIPT: "receipts",
    TASK: "tasks",
    CLAIM: "claims",
  };
  return associations.flatMap(([type, label]) => {
    const values = options[optionKey[type]];
    return values.length > 0 ? [{ type, label, values }] : [];
  });
}

function isUnassociated(document: DocumentInboxItem) {
  return !document.clientId && !document.policyId && !document.endorsementId && !document.receiptId && !document.taskId && !document.claimId;
}

function associationLabel(document: DocumentInboxItem) {
  return document.policy?.policyNumber ?? document.endorsement?.endorsementNumber ?? document.receipt?.receiptNumber ?? document.task?.folio ?? document.claim?.folio ?? document.client?.fullName ?? "Sin asociación";
}

function InboxReviewForm({ document, options, onDefer, canDefer }: { document: DocumentInboxItem; options: DocumentInboxOptions; onDefer: () => void; canDefer: boolean }) {
  const [state, formAction, pending] = useActionState<DocumentInboxActionState | null, FormData>(associateInboxDocument, null);
  const groups = associationOptions(options);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="documentId" value={document.id} />
      <div className="space-y-2">
        <Label htmlFor={`document-type-${document.id}`}>Clasificación</Label>
        <Select name="documentType" defaultValue={document.documentType}>
          <SelectTrigger id={`document-type-${document.id}`} className="w-full bg-background">
            <SelectValue placeholder="Tipo de documento" />
          </SelectTrigger>
          <SelectContent>
            {documentTypeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`document-association-${document.id}`}>Asociar a</Label>
        <select
          id={`document-association-${document.id}`}
          name="associationRef"
          required
          defaultValue=""
          className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <option value="" disabled>Selecciona el expediente correcto</option>
          {groups.map((group) => (
            <optgroup key={group.type} label={group.label}>
              {group.values.map((option) => (
                <option key={`${group.type}:${option.id}`} value={`${group.type}:${option.id}`}>{option.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">La clasificación y la asociación se guardan solo cuando confirmes.</p>
      {state && !state.ok ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
      {state?.ok ? <p role="status" className="text-sm text-emerald-700">{state.message}</p> : null}
      {groups.length === 0 ? <p className="text-sm text-muted-foreground">No hay expedientes disponibles para asociar.</p> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" disabled={pending || !canDefer} onClick={onDefer}>Dejar para después</Button>
        <Button type="submit" disabled={pending || groups.length === 0}>{pending ? "Guardando…" : "Confirmar asociación"}</Button>
      </div>
    </form>
  );
}

function DocumentRow({ document, enabled, options }: { document: DocumentInboxItem; enabled: boolean; options: DocumentInboxOptions }) {
  const previewAvailable = document.filePath.startsWith("demo://");
  const unassociated = isUnassociated(document);
  return (
    <article className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted"><FileText className="size-4" /></span>
          <div className="min-w-0">
            <p className="truncate font-medium">{document.fileName}</p>
            <p className="mt-1 text-sm text-muted-foreground">{documentTypeLabel(document.documentType)} · {formatDate(document.uploadedAt)}</p>
            {!unassociated ? <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground"><Link2 className="size-3" />{associationLabel(document)}</p> : <p className="mt-1 text-sm text-amber-700">Pendiente de clasificación y asociación</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {enabled || previewAvailable ? (
            <>
              <DocumentPreviewDialog documentId={document.id} fileName={document.fileName} mimeType={document.mimeType} disabled={!enabled && !previewAvailable} />
              <Button asChild variant="ghost" size="sm" className="size-8 p-0" aria-label={`Descargar ${document.fileName}`}>
                <Link href={`/api/documents/${document.id}/download`} target="_blank"><Download className="size-4" /></Link>
              </Button>
            </>
          ) : <span className="text-xs text-muted-foreground">Vista y descarga deshabilitadas</span>}
        </div>
      </div>
      {unassociated && enabled ? (
        <InboxReviewForm document={document} options={options} onDefer={() => undefined} canDefer={false} />
      ) : unassociated ? (
        <p className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-sm text-muted-foreground">La clasificación y asociación están deshabilitadas para esta organización.</p>
      ) : null}
    </article>
  );
}

export function DocumentInbox({
  pendingDocuments,
  recentDocuments,
  options,
  enabled,
}: {
  pendingDocuments: DocumentInboxItem[];
  recentDocuments: DocumentInboxItem[];
  options: DocumentInboxOptions;
  enabled: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(pendingDocuments[0]?.id ?? null);
  const pendingIds = new Set(pendingDocuments.map((document) => document.id));
  const recentLinked = recentDocuments.filter((document) => !pendingIds.has(document.id));
  const selectedDocument = pendingDocuments.find((document) => document.id === selectedId) ?? pendingDocuments[0] ?? null;
  const selectedIndex = selectedDocument ? pendingDocuments.findIndex((document) => document.id === selectedDocument.id) : -1;
  const deferToNext = () => {
    if (selectedIndex >= 0 && selectedIndex < pendingDocuments.length - 1) {
      setSelectedId(pendingDocuments[selectedIndex + 1].id);
    }
  };
  const previewUrl = selectedDocument ? `/api/documents/${selectedDocument.id}/download?inline=1` : null;

  return (
    <div className="space-y-4">
      <section className="space-y-4" aria-labelledby="document-inbox-pending-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="document-inbox-pending-heading" className="font-semibold">Por revisar</h3>
            <p className="mt-1 text-sm text-muted-foreground">Abre cada PDF, corrige su clasificación si hace falta y confirma manualmente el expediente.</p>
          </div>
          <Badge variant="secondary" className="rounded-full">{pendingDocuments.length} pendientes</Badge>
        </div>
        {pendingDocuments.length === 0 ? (
          <EmptyState icon={FolderOpen} title="Sin PDFs pendientes" description="Los nuevos PDFs sin asociación aparecerán aquí para revisión." />
        ) : (
          <>
            <div role="group" aria-label="Seleccionar PDF para revisar" className="flex gap-2 overflow-x-auto pb-1">
              {pendingDocuments.map((document, index) => (
                <button
                  key={document.id}
                  type="button"
                  aria-pressed={document.id === selectedDocument?.id}
                  onClick={() => setSelectedId(document.id)}
                  className={`min-w-48 max-w-64 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${document.id === selectedDocument?.id ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/50"}`}
                >
                  <span className="flex items-center gap-2"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium">{index + 1}</span><span className="truncate text-sm font-medium">{document.fileName}</span></span>
                  <span className="mt-1 block truncate pl-8 text-xs text-muted-foreground">Subido {formatDate(document.uploadedAt)}</span>
                </button>
              ))}
            </div>
            {selectedDocument ? (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.85fr)]">
                <section aria-label={`Vista previa de ${selectedDocument.fileName}`} className="min-w-0 overflow-hidden rounded-xl border bg-muted/20">
                  <header className="flex min-w-0 items-center justify-between gap-3 border-b bg-card px-4 py-3">
                    <div className="min-w-0"><p className="truncate text-sm font-medium">{selectedDocument.fileName}</p><p className="mt-0.5 text-xs text-muted-foreground">PDF · {formatDate(selectedDocument.uploadedAt)}</p></div>
                    {enabled || selectedDocument.filePath.startsWith("demo://") ? (
                      <Button asChild variant="outline" size="sm" className="shrink-0 gap-1.5"><Link href={`/api/documents/${selectedDocument.id}/download`} target="_blank" rel="noreferrer"><Download className="size-4" />Descargar</Link></Button>
                    ) : null}
                  </header>
                  <div className="h-[48vh] min-h-[320px] bg-muted/30 xl:h-[64vh]">
                    {previewUrl && (enabled || selectedDocument.filePath.startsWith("demo://")) ? (
                      <iframe src={previewUrl} title={`Vista previa de ${selectedDocument.fileName}`} className="h-full w-full border-0" />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"><Eye className="size-8 text-muted-foreground" /><p className="max-w-sm text-sm text-muted-foreground">La vista previa está deshabilitada para esta organización.</p></div>
                    )}
                  </div>
                </section>
                <aside className="space-y-4 rounded-xl border bg-card p-4">
                  <div><h4 className="font-semibold">Revisar documento</h4><p className="mt-1 truncate text-sm text-muted-foreground">{selectedDocument.fileName}</p></div>
                  {enabled ? <InboxReviewForm key={selectedDocument.id} document={selectedDocument} options={options} onDefer={deferToNext} canDefer={selectedIndex < pendingDocuments.length - 1} /> : (
                    <p className="rounded-lg border border-dashed bg-muted/30 px-3 py-3 text-sm text-muted-foreground">La clasificación y asociación están deshabilitadas para esta organización.</p>
                  )}
                </aside>
              </div>
            ) : null}
          </>
        )}
      </section>
      <details className="group overflow-hidden rounded-xl border border-border/70 bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 marker:content-none [&::-webkit-details-marker]:hidden">
          <span><span id="document-inbox-recent-heading" className="font-medium">Asociados recientemente</span><span className="ml-2 text-sm text-muted-foreground">{recentLinked.length}</span></span>
          <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-3 border-t p-4">
          <p className="text-sm text-muted-foreground">Los vínculos existentes se muestran sin cambiarse automáticamente.</p>
          {recentLinked.length === 0 ? <EmptyState icon={FileText} title="Sin PDFs asociados recientemente" description="Los archivos asociados aparecerán aquí después de su carga." /> : recentLinked.map((document) => <DocumentRow key={document.id} document={document} enabled={enabled} options={options} />)}
        </div>
      </details>
    </div>
  );
}

