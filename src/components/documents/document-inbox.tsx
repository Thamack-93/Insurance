"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Download, FileText, FolderOpen, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  quoteId: string | null;
  client: { fullName: string } | null;
  policy: { policyNumber: string } | null;
  endorsement: { endorsementNumber: string } | null;
  receipt: { receiptNumber: string } | null;
  task: { folio: string; title: string } | null;
  claim: { folio: string } | null;
  quote: { id: string; policyType: string } | null;
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
  return !document.clientId && !document.policyId && !document.endorsementId && !document.receiptId && !document.taskId && !document.claimId && !document.quoteId;
}

function associationLabel(document: DocumentInboxItem) {
  return document.policy?.policyNumber ?? document.endorsement?.endorsementNumber ?? document.receipt?.receiptNumber ?? document.task?.folio ?? document.claim?.folio ?? document.quote?.id ?? document.client?.fullName ?? "Sin asociación";
}

function InboxReviewForm({ document, options }: { document: DocumentInboxItem; options: DocumentInboxOptions }) {
  const [state, formAction, pending] = useActionState<DocumentInboxActionState | null, FormData>(associateInboxDocument, null);
  const groups = associationOptions(options);

  return (
    <form action={formAction} className="grid gap-3 rounded-lg border bg-muted/20 p-3 md:grid-cols-[minmax(150px,1fr)_minmax(220px,2fr)_auto] md:items-end">
      <input type="hidden" name="documentId" value={document.id} />
      <div className="space-y-1">
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
      <div className="space-y-1">
        <Label htmlFor={`document-association-${document.id}`}>Asociar a</Label>
        <select
          id={`document-association-${document.id}`}
          name="associationRef"
          required
          defaultValue=""
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
      <Button type="submit" size="sm" disabled={pending || groups.length === 0}>
        {pending ? "Guardando…" : "Confirmar asociación"}
      </Button>
      {state && !state.ok ? <p role="alert" className="text-sm text-destructive md:col-span-3">{state.error}</p> : null}
      {state?.ok ? <p role="status" className="text-sm text-emerald-700 md:col-span-3">{state.message}</p> : null}
      {groups.length === 0 ? <p className="text-sm text-muted-foreground md:col-span-3">No hay expedientes disponibles para asociar.</p> : null}
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
        <InboxReviewForm document={document} options={options} />
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
  const pendingIds = new Set(pendingDocuments.map((document) => document.id));
  const recentLinked = recentDocuments.filter((document) => !pendingIds.has(document.id));

  return (
    <div className="space-y-5">
      <section className="space-y-3" aria-labelledby="document-inbox-pending-heading">
        <div>
          <h3 id="document-inbox-pending-heading" className="font-medium">PDFs sin expediente</h3>
          <p className="text-sm text-muted-foreground">Revisa el archivo, elige su clasificación y confirma manualmente una asociación.</p>
        </div>
        {pendingDocuments.length === 0 ? (
          <EmptyState icon={FolderOpen} title="Sin PDFs pendientes" description="Los nuevos PDFs sin asociación aparecerán aquí para revisión." />
        ) : (
          <div className="space-y-3">{pendingDocuments.map((document) => <DocumentRow key={document.id} document={document} enabled={enabled} options={options} />)}</div>
        )}
      </section>
      <section className="space-y-3" aria-labelledby="document-inbox-recent-heading">
        <div>
          <h3 id="document-inbox-recent-heading" className="font-medium">PDFs recientes ya asociados</h3>
          <p className="text-sm text-muted-foreground">Subidas de los últimos siete días. Las relaciones existentes se muestran sin cambiarse automáticamente.</p>
        </div>
        {recentLinked.length === 0 ? (
          <EmptyState icon={FileText} title="Sin PDFs asociados recientemente" description="Los archivos asociados aparecerán aquí después de su carga." />
        ) : (
          <div className="space-y-3">{recentLinked.map((document) => <DocumentRow key={document.id} document={document} enabled={enabled} options={options} />)}</div>
        )}
      </section>
    </div>
  );
}

