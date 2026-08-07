"use client";

import { useState } from "react";
import { Eye, Download, FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { areDocumentFilesEnabled } from "@/lib/deployment";

type Props = {
  documentId: string;
  fileName: string;
  mimeType: string;
  triggerSize?: "sm" | "default";
  triggerLabel?: string;
  disabled?: boolean;
};

export function DocumentPreviewDialog({
  documentId,
  fileName,
  mimeType,
  triggerSize = "sm",
  triggerLabel = "Vista previa",
  disabled = !areDocumentFilesEnabled(),
}: Props) {
  const [open, setOpen] = useState(false);
  const inlineUrl = `/api/documents/${documentId}/download?inline=1`;
  const downloadUrl = `/api/documents/${documentId}/download`;
  const isPdf = mimeType === "application/pdf";
  const isImage = mimeType.startsWith("image/");

  if (disabled) {
    return (
      <Button variant="outline" size={triggerSize} className="gap-1.5" disabled aria-label={`Vista previa de ${fileName} deshabilitada`}>
        <Eye className="size-4" />
        {triggerLabel}
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size={triggerSize} className="gap-1.5" aria-label={`Vista previa de ${fileName}`} />
        }
      >
        <Eye className="size-4" />
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="truncate">{fileName}</DialogTitle>
          <DialogDescription>{mimeType}</DialogDescription>
        </DialogHeader>

        <div className="h-[70vh] overflow-auto rounded-md border bg-muted/20">
          {isPdf && open ? (
            <iframe
              src={inlineUrl}
              title={fileName}
              className="h-full w-full"
            />
          ) : isImage ? (
            <div className="flex h-full items-center justify-center p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={inlineUrl}
                alt={fileName}
                className="max-h-full max-w-full rounded"
              />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <FileText className="size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Sin vista previa disponible para este tipo de archivo.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <a href={downloadUrl} target="_blank" rel="noreferrer">
              <Download className="size-4" />
              Descargar
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
