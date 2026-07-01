"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, FileUp, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ControlledSelect } from "@/components/forms/form-primitives";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { reconstructPdfTextFromTextContent } from "@/lib/pdf-text-reconstruction";
import {
  normalizePdfPaymentFrequencyLabel,
  type PolicyPdfCapturePreview,
} from "@/lib/policy-pdf-capture.shared";

type PreviewResponse = {
  success?: boolean;
  preview?: PolicyPdfCapturePreview;
  error?: string;
};

type ConfirmResponse = {
  success?: boolean;
  redirectTo?: string;
  message?: string;
  error?: string;
};

const MAX_PDF_BYTES = 10 * 1024 * 1024;

async function extractPdfTextFromFile(file: File) {
  const pdfjs = await import("pdfjs-dist/webpack.mjs");
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await loadingTask.promise;

  try {
    const pageTexts: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = reconstructPdfTextFromTextContent(textContent);
      if (pageText.trim()) {
        pageTexts.push(pageText);
      }
    }
    return pageTexts.join("\n");
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

async function readJsonResponse<T>(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const body = await response.text();
    const message = body.includes("<!DOCTYPE")
      ? "El servidor devolvió HTML inesperado. Recarga la página e inténtalo de nuevo."
      : "El servidor devolvió una respuesta inesperada. Recarga la página e inténtalo de nuevo.";
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export function PolicyPdfCapturePanel() {
  const router = useRouter();
  const [isConfirming, setIsConfirming] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [preview, setPreview] = useState<PolicyPdfCapturePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [selectedInsurerId, setSelectedInsurerId] = useState<string>("");
  const [selectedSourcePolicyId, setSelectedSourcePolicyId] = useState<string>("");

  const previewSummary = useMemo(() => {
    if (!preview) return null;
    return [
      preview.draft.policyNumber || "Sin número",
      preview.draft.clientName || "Sin cliente",
      preview.draft.insurerName || "Sin aseguradora",
      normalizePdfPaymentFrequencyLabel(preview.draft.paymentFrequency),
      preview.draft.serialNumber || "Sin serie",
    ];
  }, [preview]);

  async function analyzeFile() {
    if (!file) {
      setError("Selecciona un PDF para analizar.");
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setError("El PDF supera el tamaño máximo de 10 MB.");
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setPreview(null);

    try {
      const extractedText = await extractPdfTextFromFile(file);
      if (!extractedText.trim()) {
        throw new Error("El PDF no tiene texto extraíble. Puede ser una imagen, un escaneo o un archivo sin capa de texto.");
      }

      const response = await fetch("/api/policies/capture/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: extractedText,
          fileName: file.name,
        }),
      });

      const result = await readJsonResponse<PreviewResponse>(response);
      if (!response.ok || !result.preview) {
        throw new Error(result.error || "No se pudo analizar el PDF.");
      }

      setPreview(result.preview);
      setSelectedClientId(result.preview.suggestions.clientId ?? "");
      setSelectedInsurerId(result.preview.suggestions.insurerId ?? "");
      setSelectedSourcePolicyId(result.preview.suggestions.sourcePolicyId ?? "");
      toast.success("PDF analizado. Revisa la sugerencia y confirma.");
    } catch (analysisError) {
      const message = analysisError instanceof Error ? analysisError.message : "No se pudo analizar el PDF.";
      setError(message);
      toast.error(message);
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function confirmCapture() {
    if (!preview) {
      setError("Primero analiza el PDF.");
      return;
    }
    if (!selectedClientId) {
      setError("Selecciona el cliente sugerido.");
      return;
    }
    if (!selectedInsurerId) {
      setError("Selecciona la aseguradora sugerida.");
      return;
    }
    if (!selectedSourcePolicyId) {
      setError("Selecciona la póliza que se está renovando.");
      return;
    }

    setError(null);
    setIsConfirming(true);
    try {
      const response = await fetch("/api/policies/capture/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: preview.draft,
          clientId: selectedClientId,
          insurerId: selectedInsurerId,
          sourcePolicyId: selectedSourcePolicyId,
        }),
      });

      const result = await readJsonResponse<ConfirmResponse>(response);
      if (!response.ok || !result.success || !result.redirectTo) {
        throw new Error(result.error || "No se pudo confirmar la captura.");
      }

      toast.success(result.message || "Póliza capturada.");
      router.push(result.redirectTo);
      router.refresh();
    } catch (confirmError) {
      const message = confirmError instanceof Error ? confirmError.message : "No se pudo confirmar la captura.";
      setError(message);
      toast.error(message);
    } finally {
      setIsConfirming(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
      <Card className="border-border/70 bg-card/90 shadow-sm">
        <CardHeader className="border-b border-border/70">
          <CardTitle className="flex items-center gap-2">
            <FileUp className="size-5" />
            PDF de carátula
          </CardTitle>
          <CardDescription>
            Sube la carátula, revisa la propuesta y confirma la renovación antes de crear la póliza.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-5">
          {error ? (
            <div className="flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <p>{error}</p>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="pdf-file">Carátula PDF</Label>
            <Input
              id="pdf-file"
              type="file"
              accept="application/pdf"
              onChange={(event) => {
                const nextFile = event.target.files?.[0] ?? null;
                setFile(nextFile);
                setPreview(null);
                setError(null);
              }}
              disabled={isAnalyzing || isConfirming}
            />
            {file ? <p className="text-xs text-muted-foreground">{file.name}</p> : null}
          </div>

          <div className="flex gap-2">
            <Button type="button" onClick={analyzeFile} disabled={!file || isAnalyzing || isConfirming} className="rounded-full">
              {isAnalyzing ? (
                <>
                  <RefreshCw className="mr-2 size-4 animate-spin" />
                  Analizando...
                </>
              ) : (
                <>
                  <FileUp className="mr-2 size-4" />
                  Analizar PDF
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-full bg-card/70"
              onClick={() => {
                setFile(null);
                setPreview(null);
                setError(null);
                setSelectedClientId("");
                setSelectedInsurerId("");
                setSelectedSourcePolicyId("");
              }}
              disabled={isAnalyzing || isConfirming}
            >
              Limpiar
            </Button>
          </div>

          <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            El PDF no se adjunta como documento. Solo se usa para capturar y proponer la póliza nueva.
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/90 shadow-sm">
        <CardHeader className="border-b border-border/70">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5" />
            Confirmación de renovación
          </CardTitle>
          <CardDescription>
            El sistema propone la póliza origen y la nueva vigencia. Revisa y confirma para crearla y marcar la anterior como renovada.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 p-5">
          {!preview ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              Sube un PDF para ver aquí la propuesta de captura.
            </div>
          ) : (
            <>
              {preview.warnings.length > 0 ? (
                <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                  {preview.warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              ) : null}

              {preview.aiReview ? (
                <div className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-100">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">Revisión asistida por IA</p>
                    <Badge variant="outline" className="rounded-full border-sky-200 text-sky-700 dark:border-sky-800 dark:text-sky-200">
                      Revisor
                    </Badge>
                  </div>
                  <p>{preview.aiReview.summary}</p>
                  {preview.aiReview.warnings.length > 0 ? (
                    <div className="space-y-1">
                      <p className="font-medium">Observaciones</p>
                      <ul className="list-disc space-y-1 pl-5">
                        {preview.aiReview.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {preview.aiReview.suggestions.length > 0 ? (
                    <div className="space-y-1">
                      <p className="font-medium">Sugerencias</p>
                      <ul className="list-disc space-y-1 pl-5">
                        {preview.aiReview.suggestions.map((suggestion) => (
                          <li key={suggestion}>{suggestion}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Nueva póliza</p>
                  <p className="mt-1 text-lg font-semibold">{preview.draft.policyNumber || "Sin detectar"}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {preview.draft.clientName || "Sin cliente"} · {preview.draft.insurerName || "Sin aseguradora"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Serie: {preview.draft.serialNumber ?? "Sin detectar"}
                  </p>
                </div>
                <div className="rounded-2xl border bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Póliza renovada</p>
                  <p className="mt-1 text-lg font-semibold">
                    {preview.sourcePolicyOptions.find((option) => option.id === selectedSourcePolicyId)?.policyNumber ??
                      preview.draft.sourcePolicyNumber ??
                      "Sin sugerencia"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {preview.sourcePolicyOptions.find((option) => option.id === selectedSourcePolicyId)?.label ??
                      "Confirma cuál vigencia anterior se renueva."}
                  </p>
                </div>
              </div>

              {previewSummary ? (
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="rounded-full">
                    {previewSummary[0]}
                  </Badge>
                  <Badge variant="secondary" className="rounded-full">
                    {previewSummary[1]}
                  </Badge>
                  <Badge variant="secondary" className="rounded-full">
                    {previewSummary[2]}
                  </Badge>
                  <Badge variant="secondary" className="rounded-full">
                    {previewSummary[3]}
                  </Badge>
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Cliente</Label>
                  <ControlledSelect
                    value={selectedClientId}
                    onValueChange={setSelectedClientId}
                    options={preview.clientOptions}
                    placeholder="Selecciona un cliente"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Aseguradora</Label>
                  <ControlledSelect
                    value={selectedInsurerId}
                    onValueChange={setSelectedInsurerId}
                    options={preview.insurerOptions}
                    placeholder="Selecciona una aseguradora"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Póliza renovada</Label>
                <ControlledSelect
                  value={selectedSourcePolicyId}
                  onValueChange={setSelectedSourcePolicyId}
                  options={preview.sourcePolicyOptions}
                  placeholder="Selecciona la póliza origen"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Vigencia" value={`${formatDate(preview.draft.startDate)} · ${formatDate(preview.draft.endDate)}`} />
                <Field label="Prima" value={formatCurrency(preview.draft.premiumAmount, preview.draft.currency)} />
                <Field label="Frecuencia" value={normalizePdfPaymentFrequencyLabel(preview.draft.paymentFrequency)} />
                <Field label="Plan" value={preview.draft.paymentPlan ?? "Sin capturar"} />
                <Field label="Solicitud" value={preview.draft.requestNumber ?? "Sin capturar"} />
                <Field label="Emisión" value={preview.draft.issueDate ? formatDate(preview.draft.issueDate) : "Sin capturar"} />
                <Field label="Serie" value={preview.draft.serialNumber ?? "Sin capturar"} />
              </div>

              <Button type="button" className="w-full rounded-full" onClick={confirmCapture} disabled={isConfirming}>
                {isConfirming ? "Confirmando..." : "Crear póliza y marcar como renovada"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-muted/30 p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}
