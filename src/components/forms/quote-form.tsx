"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { createQuoteDefaults } from "@/lib/form-defaults";
import {
  policyTypeOptions,
  quoteStatusOptions,
  type SelectOption,
} from "@/lib/domain-options";
import { quoteSchema, type QuoteFormValues } from "@/lib/validations";
import type { MutationResult } from "@/lib/mutation-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { BrokerComparisonExtractionPanel } from "@/components/documents/broker-comparison-extraction-panel";
import {
  ControlledSelect,
  FormActions,
  FormErrorBanner,
  FormField,
  FormGrid,
  FormSection,
} from "@/components/forms/form-primitives";

type QuoteFormProps = {
  title: string;
  description: string;
  submitLabel: string;
  cancelHref: string;
  defaultValues: QuoteFormValues;
  clientOptions: SelectOption[];
  insurerOptions: SelectOption[];
  submitAction: (values: QuoteFormValues) => Promise<MutationResult>;
  brokerPdfIntakeEnabled?: boolean;
};

export function QuoteForm({
  title,
  description,
  submitLabel,
  cancelHref,
  defaultValues,
  clientOptions,
  insurerOptions,
  submitAction,
  brokerPdfIntakeEnabled = false,
}: QuoteFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [brokerPdf, setBrokerPdf] = useState<File | null>(null);
  const [uploadConsent, setUploadConsent] = useState(false);
  const [createdQuoteId, setCreatedQuoteId] = useState<string | null>(null);
  const [uploadedDocument, setUploadedDocument] = useState<{ id: string; fileName: string; version: number } | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<QuoteFormValues>({
    resolver: zodResolver(quoteSchema) as never,
    defaultValues,
  });

  async function onSubmit(values: QuoteFormValues) {
    if (!createdQuoteId && brokerPdf && !uploadConsent) {
      setError("root", { message: "Confirma que tienes autorización para subir y procesar este PDF." });
      return;
    }
    if (brokerPdf && ((brokerPdf.type && brokerPdf.type !== "application/pdf") || brokerPdf.size > 15 * 1024 * 1024)) {
      setError("root", { message: "Selecciona un PDF válido de hasta 15 MB." });
      return;
    }

    startTransition(async () => {
      setWorkflowError(null);
      let quoteId = createdQuoteId;
      if (!quoteId) {
        const result = await submitAction(values);

        if (!result.ok) {
          setError("root", { message: result.error });
          toast.error(result.error);
          return;
        }
        quoteId = result.id;
        setCreatedQuoteId(quoteId);
      }

      if (brokerPdf && quoteId) {
        try {
          const body = new FormData();
          body.append("file", brokerPdf);
          body.append("clientId", values.clientId);
          body.append("quoteId", quoteId);
          body.append("documentType", "QUOTE");
          body.append("uploadConsent", "1");
          const response = await fetch("/api/documents/upload", { method: "POST", body });
          const result = await response.json() as { document?: { id: string; fileName: string; version?: number }; error?: string };
          if (!response.ok || !result.document) throw new Error(result.error || "No se pudo guardar el PDF.");
          setUploadedDocument({ id: result.document.id, fileName: result.document.fileName, version: result.document.version ?? 1 });
          setBrokerPdf(null);
          toast.success("Cotización creada y PDF asociado correctamente.");
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : "No se pudo guardar el PDF.";
          setWorkflowError(`La cotización ya existe, pero el PDF no se guardó. Puedes reintentar la carga sin crear otra cotización. ${message}`);
          toast.error("La cotización se creó; falta guardar el PDF.");
          return;
        }
      }

      toast.success("Cotización creada exitosamente.");
      router.push(`/quotes/${quoteId}`);
    });
  }

  return (
    <Card className="border-border/70 bg-card/84 shadow-sm  backdrop-blur">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <FormErrorBanner message={errors.root?.message} />

          <FormGrid>
            <FormSection title="Información de la cotización" description="Datos básicos de la propuesta.">
              <FormField label="Cliente" error={errors.clientId?.message} hint="Campo obligatorio">
                <Controller
                  name="clientId"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      options={clientOptions}
                      placeholder="Selecciona cliente"
                      disabled={Boolean(createdQuoteId)}
                    />
                  )}
                />
              </FormField>

              <FormField label="Aseguradora" error={errors.insurerId?.message}>
                <Controller
                  name="insurerId"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value || ""}
                      onValueChange={field.onChange}
                      options={insurerOptions}
                      placeholder="Selecciona aseguradora (opcional)"
                      disabled={Boolean(createdQuoteId)}
                    />
                  )}
                />
              </FormField>

              <FormField label="Tipo de póliza" error={errors.policyType?.message} hint="Campo obligatorio">
                <Controller
                  name="policyType"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      options={policyTypeOptions}
                      placeholder="Selecciona tipo"
                      disabled={Boolean(createdQuoteId)}
                    />
                  )}
                />
              </FormField>

              <FormField label="Estado" error={errors.status?.message} hint="Campo obligatorio">
                <Controller
                  name="status"
                  control={control}
                  render={({ field }) => (
                    <ControlledSelect
                      value={field.value}
                      onValueChange={field.onChange}
                      options={quoteStatusOptions}
                      placeholder="Selecciona estado"
                      disabled={Boolean(createdQuoteId)}
                    />
                  )}
                />
              </FormField>
            </FormSection>

            <FormSection title="Fechas" description="Timeline de la cotización.">
              <FormField label="Fecha de solicitud" error={errors.requestedDate?.message} hint="Campo obligatorio">
                <Input autoFocus {...register("requestedDate")} type="date" disabled={Boolean(createdQuoteId)} />
              </FormField>

              <FormField label="Fecha de envío" error={errors.sentDate?.message}>
                <Input {...register("sentDate")} type="date" disabled={Boolean(createdQuoteId)} />
              </FormField>

              <FormField label="Válida hasta" error={errors.validUntil?.message}>
                <Input {...register("validUntil")} type="date" disabled={Boolean(createdQuoteId)} />
              </FormField>
            </FormSection>

            <FormSection title="Valores" description="Información económica.">
              <FormField label="Monto cotizado" error={errors.quotedAmount?.message}>
                <Input {...register("quotedAmount")} type="number" step="0.01" placeholder="0.00" disabled={Boolean(createdQuoteId)} />
              </FormField>
            </FormSection>

            <FormSection title="Descripción" description="Detalles adicionales de la cotización.">
              <FormField label="Notas" error={errors.notes?.message}>
                <Textarea {...register("notes")} rows={4} placeholder="Notas internas sobre la cotización..." disabled={Boolean(createdQuoteId)} />
              </FormField>
            </FormSection>

            {brokerPdfIntakeEnabled && !uploadedDocument ? (
              <FormSection title="Propuesta del corredor (opcional)" description="Crea la cotización y asocia el PDF en un solo paso. Los datos detectados quedarán como borrador para que los revises.">
                <div className="space-y-3">
                  <Label htmlFor="broker-comparison-pdf">PDF de cotización</Label>
                  <Input
                    id="broker-comparison-pdf"
                    type="file"
                    accept=".pdf,application/pdf"
                    disabled={Boolean(createdQuoteId)}
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      setBrokerPdf(file);
                      setWorkflowError(null);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">PDF de hasta 15 MB. Si compara varias aseguradoras, deja esos campos vacíos para revisarlos desde el documento.</p>
                  {brokerPdf ? <p className="text-xs">Archivo seleccionado: {brokerPdf.name}</p> : null}
                  <label className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Checkbox checked={uploadConsent} onCheckedChange={(checked) => setUploadConsent(checked === true)} disabled={Boolean(createdQuoteId)} />
                    <span>Confirmo que tengo autorización para subir este documento. Si solicito extraer datos, acepto su procesamiento por proveedores de IA aprobados. El PDF se guardará de forma privada en Documentos y quedará asociado a esta cotización; no hay antivirus externo por archivo.</span>
                  </label>
                </div>
              </FormSection>
            ) : null}
          </FormGrid>

          {workflowError ? <p role="alert" className="text-sm text-destructive">{workflowError}</p> : null}
          {createdQuoteId && !uploadedDocument ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="text-sm text-muted-foreground">La cotización ya está creada. {brokerPdf ? "Reintenta guardar el PDF sin crear otro registro." : "Selecciona el PDF para asociarlo."}</p>
              <a className="text-sm underline" href={`/quotes/${createdQuoteId}`}>Abrir cotización</a>
            </div>
          ) : null}
          {!uploadedDocument ? (
            <FormActions submitLabel={createdQuoteId ? "Reintentar carga del PDF" : brokerPdf ? "Crear cotización y subir PDF" : submitLabel} cancelHref={cancelHref} pending={isPending} />
          ) : null}
        </form>
        {uploadedDocument && createdQuoteId ? (
          <div className="mt-6 space-y-4 border-t pt-6">
            <div>
              <h3 className="font-semibold">PDF asociado a la cotización</h3>
              <p className="text-sm text-muted-foreground">Cotización <a className="underline" href={`/quotes/${createdQuoteId}`}>{createdQuoteId.slice(0, 8)}</a> · {uploadedDocument.fileName}</p>
            </div>
            <BrokerComparisonExtractionPanel
              documentId={uploadedDocument.id}
              fileName={uploadedDocument.fileName}
              enabled={brokerPdfIntakeEnabled}
              documentVersion={uploadedDocument.version}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export { createQuoteDefaults };
