"use client";

import { useState } from "react";
import { Upload, FileText, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { documentTypeOptions } from "@/lib/domain-options";
import { areDocumentFilesEnabled } from "@/lib/deployment";
import { cn } from "@/lib/utils";

interface UploadFormProps {
  onSuccess?: (document: UploadDocument) => void;
  onError?: (error: string) => void;
  associations?: {
    clientId?: string;
    policyId?: string;
    endorsementId?: string;
    receiptId?: string;
    claimId?: string;
    quoteId?: string;
  };
  className?: string;
  disabled?: boolean;
}

const ALLOWED_TYPES = ["application/pdf"];
const MAX_BYTES = 15 * 1024 * 1024;

type UploadDocument = {
  id: string;
  fileName: string;
  documentType: string;
  uploadedAt: string | Date;
  mimeType: string;
};

type UploadResponseResult = {
  ok?: boolean;
  document?: UploadDocument;
  fileName?: string;
  error?: string;
};

export function UploadForm({
  onSuccess,
  onError,
  associations = {},
  className,
  disabled = !areDocumentFilesEnabled(),
}: UploadFormProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadConsent, setUploadConsent] = useState(false);
  const [formData, setFormData] = useState<{
    documentType: string;
    notes: string;
    clientId?: string;
    policyId?: string;
    endorsementId?: string;
    receiptId?: string;
    claimId?: string;
    quoteId?: string;
  }>({
    documentType: "",
    notes: "",
    ...associations,
  });

  if (disabled) {
    return (
      <Card className={cn("w-full max-w-2xl", className)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="size-5" />
            Subir documentos
          </CardTitle>
          <CardDescription>
            La carga de archivos está desactivada en la demo publicada. Esta pantalla queda solo como metadata.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
            En esta versión no se subirán PDFs ni archivos al servidor.
          </div>
        </CardContent>
      </Card>
    );
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    const valid: File[] = [];
    for (const f of selected) {
      if (!ALLOWED_TYPES.includes(f.type)) {
        setError(`${f.name}: solo se aceptan PDFs.`);
        return;
      }
      if (f.size > MAX_BYTES) {
        setError(`${f.name}: el archivo supera 15 MB.`);
        return;
      }
      valid.push(f);
    }
    setFiles(valid);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (files.length === 0) {
      setError("Selecciona al menos un archivo.");
      return;
    }
    if (!formData.documentType) {
      setError("Selecciona el tipo de documento.");
      return;
    }
    if (!uploadConsent) {
      setError("Confirma tu autorización, el procesamiento por proveedores de IA aprobados, la retención del original por 48 horas y el riesgo de que no hay antivirus externo por archivo.");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const formDataToSend = new FormData();
      for (const f of files) formDataToSend.append("files", f);
      Object.entries(formData).forEach(([key, value]) => {
        if (value) formDataToSend.append(key, value);
      });
      formDataToSend.append("uploadConsent", "1");

      const response = await fetch("/api/documents/upload", {
        method: "POST",
        body: formDataToSend,
      });

      const result = (await response.json()) as {
        results?: UploadResponseResult[];
        document?: UploadDocument;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(result.error || "No se pudo subir.");
      }

      // Multi or single response shapes both supported.
      const docs = result.results
        ? result.results.filter((r) => r.ok && r.document).map((r) => r.document as UploadDocument)
        : result.document
          ? [result.document]
          : [];
      docs.forEach((d) => onSuccess?.(d));

      setFiles([]);
      setUploadConsent(false);
      setFormData({ documentType: "", notes: "", ...associations });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "No se pudo subir.";
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className={cn("w-full max-w-2xl", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="size-5" />
          Subir documentos
        </CardTitle>
        <CardDescription>
          Solo PDF validado. Máximo 15 MB y 100 páginas por archivo. En DEMO, los originales se purgan según la política de retención.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3">
            <div className="flex items-center gap-2 text-red-800">
              <AlertCircle className="size-4" />
              <span className="text-sm">{error}</span>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="file">Archivos</Label>
            <Input
              id="file"
              type="file"
              multiple
              onChange={handleFileChange}
              accept=".pdf,application/pdf"
              disabled={uploading}
            />
            {files.length > 0 && (
              <ul className="space-y-1 text-sm text-muted-foreground">
                {files.map((f) => (
                  <li key={f.name} className="flex items-center gap-2">
                    <FileText className="size-4" />
                    {f.name} <span className="text-xs">({(f.size / 1024).toFixed(0)} KB)</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <Checkbox checked={uploadConsent} onCheckedChange={(checked) => setUploadConsent(checked === true)} disabled={uploading} />
            <span>Confirmo que tengo autorización, acepto el procesamiento por proveedores de IA aprobados y entiendo que el original se conserva hasta 48 horas (sin antivirus externo por archivo).</span>
          </label>

          <div className="space-y-2">
            <Label htmlFor="documentType">Tipo de documento</Label>
            <Select
              items={Object.fromEntries(documentTypeOptions.map((option) => [option.value, option.label]))}
              value={formData.documentType}
              onValueChange={(value) => setFormData((prev) => ({ ...prev, documentType: value || "" }))}
              disabled={uploading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona el tipo" />
              </SelectTrigger>
              <SelectContent>
                {documentTypeOptions.map((option: { value: string; label: string }) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notas (opcional)</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Agrega notas sobre estos documentos..."
              disabled={uploading}
              rows={3}
            />
          </div>

          <Button type="submit" disabled={uploading || files.length === 0} className="w-full">
            {uploading
              ? "Subiendo..."
              : files.length > 1
                ? `Subir ${files.length} documentos`
                : "Subir documento"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
