"use client";

import { useRef, useState } from "react";
import { FileUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const POLICY_PDF_MAX_FILES = 8;
export const POLICY_PDF_MAX_BATCH_BYTES = 30 * 1024 * 1024;

type Props = {
  files: File[];
  onFilesChange: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
  label?: string;
};

function validatePdf(file: File) {
  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf" && file.type !== "application/octet-stream") {
    return "Solo se aceptan archivos PDF.";
  }
  if (file.size > 10 * 1024 * 1024) return "Supera el máximo individual de 10 MB.";
  return null;
}

export function PolicyPdfFilePicker({ files, onFilesChange, disabled = false, className, label = "Arrastra PDFs aquí o selecciónalos" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addFiles(input: FileList | File[]) {
    const incoming = Array.from(input);
    const next = [...files];
    const seen = new Set(next.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
    for (const file of incoming) {
      const validationError = validatePdf(file);
      if (validationError) {
        setError(`${file.name}: ${validationError}`);
        continue;
      }
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (seen.has(key)) {
        setError(`${file.name}: ya está en la cola.`);
        continue;
      }
      if (next.length >= POLICY_PDF_MAX_FILES) {
        setError(`Puedes analizar hasta ${POLICY_PDF_MAX_FILES} PDFs por lote.`);
        break;
      }
      if (next.reduce((total, item) => total + item.size, 0) + file.size > POLICY_PDF_MAX_BATCH_BYTES) {
        setError("El lote supera el máximo total de 30 MB.");
        break;
      }
      seen.add(key);
      next.push(file);
    }
    if (next.length !== files.length) {
      setError(null);
      onFilesChange(next);
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(event) => {
          if (!disabled && (event.key === "Enter" || event.key === " ")) inputRef.current?.click();
        }}
        onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); if (!disabled) addFiles(event.dataTransfer.files); }}
        className={cn("cursor-pointer rounded-2xl border-2 border-dashed p-4 text-center transition-colors", dragging ? "border-primary bg-primary/5" : "border-border bg-muted/20 hover:border-primary/60", disabled && "cursor-not-allowed opacity-60")}
      >
        <FileUp className="mx-auto size-5 text-muted-foreground" />
        <p className="mt-2 text-sm font-medium">{label}</p>
        <p className="mt-1 text-xs text-muted-foreground">Selector tradicional o arrastre · hasta {POLICY_PDF_MAX_FILES} archivos · 10 MB c/u</p>
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" disabled={disabled} onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      {files.length > 0 ? (
        <ul className="space-y-1">
          {files.map((file, index) => (
            <li key={`${file.name}-${file.size}-${file.lastModified}`} className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-xs">
              <span className="min-w-0 flex-1 truncate">{index + 1}. {file.name}</span>
              <span className="text-muted-foreground">{(file.size / (1024 * 1024)).toFixed(1)} MB</span>
              <Button type="button" variant="ghost" size="icon" className="size-6 rounded-full" disabled={disabled} onClick={() => onFilesChange(files.filter((_, fileIndex) => fileIndex !== index))} aria-label={`Eliminar ${file.name}`}>
                <X className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
