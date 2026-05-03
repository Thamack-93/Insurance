"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
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
import { Textarea } from "@/components/ui/textarea";
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
}: QuoteFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
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
    startTransition(async () => {
      const result = await submitAction(values);

      if (!result.ok) {
        setError("root", { message: result.error });
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      router.push("/quotes");
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
                    />
                  )}
                />
              </FormField>
            </FormSection>

            <FormSection title="Fechas" description="Timeline de la cotización.">
              <FormField label="Fecha de solicitud" error={errors.requestedDate?.message} hint="Campo obligatorio">
                <Input autoFocus {...register("requestedDate")} type="date" />
              </FormField>

              <FormField label="Fecha de envío" error={errors.sentDate?.message}>
                <Input {...register("sentDate")} type="date" />
              </FormField>

              <FormField label="Válida hasta" error={errors.validUntil?.message}>
                <Input {...register("validUntil")} type="date" />
              </FormField>
            </FormSection>

            <FormSection title="Valores" description="Información económica.">
              <FormField label="Monto cotizado" error={errors.quotedAmount?.message}>
                <Input {...register("quotedAmount")} type="number" step="0.01" placeholder="0.00" />
              </FormField>
            </FormSection>

            <FormSection title="Descripción" description="Detalles adicionales de la cotización.">
              <FormField label="Notas" error={errors.notes?.message}>
                <Textarea {...register("notes")} rows={4} placeholder="Notas internas sobre la cotización..." />
              </FormField>
            </FormSection>
          </FormGrid>

          <FormActions submitLabel={submitLabel} cancelHref={cancelHref} pending={isPending} />
        </form>
      </CardContent>
    </Card>
  );
}

export { createQuoteDefaults };
