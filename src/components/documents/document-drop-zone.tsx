"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { documentTypeOptions } from "@/lib/domain-options";
import { cn } from "@/lib/utils";

type Associations = {
  clientId?: string;
  policyId?: string;
  receiptId?: string;
  taskId?: string;
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
};

const ALLOWED_EXT = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".doc", ".docx"];
const MAX_BYTES = 10 * 1024 * 1024;

function uploadOne(
  file: File,
  documentType: string,
  associations: Associations,
  onProgress: (pct: number) => void,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const fd = new FormData();
    fd.append("files", file);
    fd.append("documentType", documentType);
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
        const json = JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 200 && xhr.status < 300) {
          const r = json.results?.[0];
          if (r && !r.ok) return resolve({ ok: false, error: r.error });
          return resolve({ ok: true });
        }
        const r = json.results?.[0];
        resolve({ ok: false, error: r?.error || json.error || "No se pudo subir." });
      } catch {
        resolve({ ok: false, error: "Respuesta no válida del servidor." });
      }
    };
    xhr.onerror = () => resolve({ ok: false, error: "Error de red al subir." });
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
}: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [documentType, setDocumentType] = useState<string>(defaultDocumentType);
  const [isDragging, setIsDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const addFiles = useCallback((files: FileList | File[]) => {
    const next: Item[] = [];
    for (const file of Array.from(files)) {
      const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
      if (!ALLOWED_EXT.includes(ext)) {
        toast.error(`${file.name}: tipo no permitido`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name}: supera 10 MB`);
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
    const queued = items.filter((it) => it.status === "queued" || it.status === "error");
    if (queued.length === 0) return;

    setBusy(true);
    let okCount = 0;
    let failCount = 0;

    await Promise.all(
      queued.map(async (it) => {
        setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, status: "uploading", error: undefined, progress: 0 } : p)));
        const res = await uploadOne(it.file, documentType, associations, (pct) => {
          setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, progress: pct } : p)));
        });
        if (res.ok) {
          okCount++;
          setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, status: "ok", progress: 100 } : p)));
        } else {
          failCount++;
          setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, status: "error", error: res.error } : p)));
        }
      }),
    );

    setBusy(false);

    if (okCount > 0) {
      toast.success(
        okCount === 1 ? "1 documento subido" : `${okCount} documentos subidos`,
      );
      onUploaded?.();
      router.refresh();
    }
    if (failCount > 0) {
      toast.error(
        failCount === 1 ? "1 documento falló" : `${failCount} documentos fallaron`,
      );
    }
  };

  const clearDone = () => setItems((prev) => prev.filter((it) => it.status !== "ok"));

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
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition-colors",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border bg-muted/30 hover:border-primary/60 hover:bg-muted/50",
        )}
      >
        <Upload className="size-6 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
          <p className="mt-1 text-xs text-muted-foreground">PDF, JPG, PNG, WebP o Word · máx. 10 MB c/u</p>
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
          <Select value={documentType} onValueChange={(v) => setDocumentType(v ?? "OTHER")}>
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

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-center gap-3 rounded-lg border bg-card/50 p-3 text-sm"
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
