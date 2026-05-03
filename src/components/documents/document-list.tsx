import Link from "next/link";
import { Download, FileText, FileImage, FileType2, File as FileIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-states/empty-state";
import { formatDate } from "@/lib/dates";
import { DocumentPreviewDialog } from "@/components/documents/document-preview-dialog";

export type DocumentListItem = {
  id: string;
  fileName: string;
  documentType: string;
  mimeType: string;
  uploadedAt: Date;
  associationLabel?: string;
};

function FileTypeIcon({ mimeType }: { mimeType: string }) {
  if (mimeType === "application/pdf") return <FileType2 className="size-4 text-rose-600" />;
  if (mimeType.startsWith("image/")) return <FileImage className="size-4 text-blue-600" />;
  if (mimeType.includes("word")) return <FileText className="size-4 text-sky-700" />;
  return <FileIcon className="size-4 text-muted-foreground" />;
}

function Thumbnail({ doc }: { doc: DocumentListItem }) {
  if (doc.mimeType.startsWith("image/")) {
    return (
      <div className="size-10 shrink-0 overflow-hidden rounded-md border bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/documents/${doc.id}/download?inline=1`}
          alt=""
          loading="lazy"
          className="size-full object-cover"
        />
      </div>
    );
  }
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted">
      <FileTypeIcon mimeType={doc.mimeType} />
    </div>
  );
}

export function DocumentList({
  documents,
  showAssociation = false,
  emptyTitle = "Sin documentos",
  emptyDescription = "Arrastra archivos al área de carga para empezar.",
}: {
  documents: DocumentListItem[];
  showAssociation?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (documents.length === 0) {
    return (
      <div className="p-4">
        <EmptyState icon={FileText} title={emptyTitle} description={emptyDescription} />
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/40">
          <TableHead>Archivo</TableHead>
          <TableHead>Tipo</TableHead>
          {showAssociation && <TableHead>Asociación</TableHead>}
          <TableHead>Fecha</TableHead>
          <TableHead className="text-right">Acciones</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {documents.map((doc) => (
          <TableRow key={doc.id}>
            <TableCell className="font-medium">
              <div className="flex items-center gap-3">
                <Thumbnail doc={doc} />
                <span className="truncate">{doc.fileName}</span>
              </div>
            </TableCell>
            <TableCell>{doc.documentType}</TableCell>
            {showAssociation && (
              <TableCell className="text-sm text-muted-foreground">
                {doc.associationLabel ?? "—"}
              </TableCell>
            )}
            <TableCell>{formatDate(doc.uploadedAt)}</TableCell>
            <TableCell className="text-right">
              <div className="inline-flex items-center justify-end gap-2">
                <DocumentPreviewDialog
                  documentId={doc.id}
                  fileName={doc.fileName}
                  mimeType={doc.mimeType}
                />
                <Button asChild variant="ghost" size="sm" className="size-8 p-0" aria-label={`Descargar ${doc.fileName}`}>
                  <Link href={`/api/documents/${doc.id}/download`} target="_blank">
                    <Download className="size-4" />
                  </Link>
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
