"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { documentTypeOptions } from "@/lib/domain-options";
import { areDocumentFilesEnabled } from "@/lib/deployment";
import { cn } from "@/lib/utils";

type Associations = {
  clientId?: string;
  policyId?: string;
  endorsementId?: string;
  receiptId?: string;
  claimId?: string;
  quoteId?: string;
};

type Item = {
  id: string;
  file: File;
  progress: number;
  status: "queued" | "uploading" | "ok" | "error";
  error?: string;
};

type Props = {
  associations?: Associations;
  defaultDocumentType?: string;
  className?: string;
  title?: string;
  description?: string;
  onUploaded?: () => void;
  disabled?: boolean;
};

const ALLOWED_EXT = [".pdf"];
const MAX_BYTES = 15 * 1024 * 1024;

type BatchResult = {
  ok: boolean;
  rolledBack?: boolean;
  results: Array<{ ok: boolean; fileName: string; error?: string }>;
  error?: string;
};

type UploadResponse = {
  results?: Array<{ ok?: boolean; fileName?: string; error?: string }>;
  rolledBack?: boolean;
  error?: string;
};

function uploadBatch(
  files: File[],
  documentType: string,
  associations: Associations,
  onProgress: (pct: number) => void,
): Promise<BatchResult> {
  return new Promise((resolve) => {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    fd.append("documentType", documentType);
    fd.append("rollback", "1");
    fd.append("uploadConsent", "1");
    Object.entries(associations).forEach(([k, v]) => {
      if (v) fd.append(k, v);
    });

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/documents/upload");
    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) onProgress(Math.round((evt.loaded / evt.total) * 100));
    };
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText || "{}") as UploadResponse;
        const results: BatchResult["results"] = (json.results ?? []).map((r) => ({
          ok: !!r.ok,
          fileName: r.fileName ?? "archivo",
          error: r.error,
        }));
        if (xhr.status >= 200 && xhr.status < 300) {
          return resolve({ ok: true, results });
        }
        resolve({
          ok: false,
          rolledBack: !!json.rolledBack,
          results,
          error: json.error,
        });
      } catch {
        resolve({ ok: false, results: [], error: "Respuesta no válida del servidor." });
      }
    };
    xhr.onerror = () => resolve({ ok: false, results: [], error: "Error de red al subir." });
    xhr.send(fd);
  });
}

export function DocumentDropZone({
  associations = {},
  defaultDocumentType = "OTHER",
  className,
  title = "Subir documentos",
  description = "Arrastra y suelta uno o varios archivos, o haz clic para elegirlos.",
  onUploaded,
  disabled = !areDocumentFilesEnabled(),
}: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [documentType, setDocumentType] = useState<string>(defaultDocumentType);
  const [isDragging, setIsDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadConsent, setUploadConsent] = useState(false);

  const addFiles = useCallback((files: FileList | File[]) => {
    const next: Item[] = [];
    for (const file of Array.from(files)) {
      const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
      if (!ALLOWED_EXT.includes(ext)) {
        toast.error(`${file.name}: solo se aceptan PDFs`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name}: supera 15 MB`);
        continue;
      }
      next.push({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        progress: 0,
        status: "queued",
      });
    }
    if (next.length) setItems((prev) => [...prev, ...next]);
  }, []);

  const removeItem = (id: string) => setItems((prev) => prev.filter((it) => it.id !== id));

  const startUpload = async () => {
    if (!documentType) {
      toast.error("Selecciona el tipo de documento.");
      return;
    }
    if (!uploadConsent) {
      toast.error("Confirma tu autorización, el procesamiento por proveedores de IA aprobados, la retención del original por 48 horas y el riesgo de que no hay antivirus externo por archivo.");
      return;
    }
    const queued = items.filter((it) => it.status === "queued" || it.status === "error");
    if (queued.length === 0) return;

    setBusy(true);
    const queuedIds = new Set(queued.map((q) => q.id));
    setItems((prev) =>
      prev.map((p) =>
        queuedIds.has(p.id) ? { ...p, status: "uploading", error: undefined, progress: 0 } : p,
      ),
    );

    // Single batched request: backend rolls back successful files if any fails.
    const res = await uploadBatch(
      queued.map((q) => q.file),
      documentType,
      associations,
      (pct) => {
        setItems((prev) => prev.map((p) => (queuedIds.has(p.id) ? { ...p, progress: pct } : p)));
      },
    );

    const byName = new Map<string, { ok: boolean; error?: string }>();
    for (const r of res.results) byName.set(r.fileName, { ok: r.ok, error: r.error });

    let okCount = 0;
    let failCount = 0;
    setItems((prev) =>
      prev.map((p) => {
        if (!queuedIds.has(p.id)) return p;
        const r = byName.get(p.file.name);
        if (r?.ok) {
          okCount++;
          return { ...p, status: "ok", progress: 100 };
        }
        failCount++;
        return {
          ...p,
          status: "error",
          error: r?.error ?? res.error ?? "No se pudo subir.",
        };
      }),
    );

    setBusy(false);
    if (okCount > 0) setUploadConsent(false);

    if (res.rolledBack) {
      toast.error(
        "Se canceló todo el lote: ningún archivo se guardó porque al menos uno falló.",
      );
    } else {
      if (okCount > 0) {
        toast.success(okCount === 1 ? "1 documento subido" : `${okCount} documentos subidos`);
        onUploaded?.();
        router.refresh();
      }
      if (failCount > 0) {
        toast.error(failCount === 1 ? "1 documento falló" : `${failCount} documentos fallaron`);
      }
    }
  };

  const clearDone = () => setItems((prev) => prev.filter((it) => it.status !== "ok"));

  if (disabled) {
    return (
      <div className={cn("rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center", className)}>
        <Upload className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          La carga de archivos está deshabilitada en la demo publicada. Solo se mostrará metadata.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border bg-muted/30 hover:border-primary/60 hover:bg-muted/50",
        )}
      >
        <Upload className="size-6 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
          <p className="mt-1 text-xs text-muted-foreground">Solo PDF validado · máx. 15 MB y 100 páginas c/u</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ALLOWED_EXT.join(",")}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="dz-doctype" className="text-xs">Tipo de documento</Label>
          <Select
            items={Object.fromEntries(documentTypeOptions.map((option) => [option.value, option.label]))}
            value={documentType}
            onValueChange={(v) => setDocumentType(v ?? "OTHER")}
          >
            <SelectTrigger id="dz-doctype" className="h-9">
              <SelectValue placeholder="Tipo de documento" />
            </SelectTrigger>
            <SelectContent>
              {documentTypeOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={clearDone} disabled={busy || items.every((i) => i.status !== "ok")}>
          Limpiar listos
        </Button>
        <Button type="button" size="sm" onClick={startUpload} disabled={busy || items.length === 0}>
          {busy ? "Subiendo..." : `Subir ${items.filter((i) => i.status === "queued" || i.status === "error").length || ""}`.trim()}
        </Button>
      </div>

      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <Checkbox checked={uploadConsent} onCheckedChange={(checked) => setUploadConsent(checked === true)} disabled={busy} />
        <span>Confirmo que tengo autorización, acepto el procesamiento por proveedores de IA aprobados y entiendo que el original se conserva hasta 48 horas (sin antivirus externo por archivo).</span>
      </label>

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-center gap-3 rounded-md border bg-card/50 p-3 text-sm"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                {it.status === "uploading" && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                {it.status === "ok" && <CheckCircle2 className="size-4 text-emerald-600" />}
                {it.status === "error" && <AlertCircle className="size-4 text-rose-600" />}
                {it.status === "queued" && <Upload className="size-4 text-muted-foreground" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-medium text-foreground">{it.file.name}</p>
                  <p className="shrink-0 text-xs text-muted-foreground">
                    {(it.file.size / 1024).toFixed(0)} KB
                  </p>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full transition-all",
                      it.status === "error" ? "bg-rose-500" : it.status === "ok" ? "bg-emerald-500" : "bg-primary",
                    )}
                    style={{ width: `${it.status === "ok" ? 100 : it.progress}%` }}
                  />
                </div>
                {it.error && <p className="mt-1 text-xs text-rose-600">{it.error}</p>}
              </div>
              {it.status !== "uploading" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="size-8 p-0"
                  onClick={() => removeItem(it.id)}
                  aria-label="Quitar"
                >
                  <X className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
